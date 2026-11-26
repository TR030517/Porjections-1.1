import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { customerOrderEmail } from '../../common/booking-order-email';

export function orderEmailConfig(env: NodeJS.ProcessEnv = process.env) {
  const local = env.ORDER_EMAIL_ENABLED === 'true' && env.ORDER_EMAIL_PROVIDER === 'local'
    && env.ORDER_EMAIL_LOCAL_CAPTURE === 'true' && env.NODE_ENV !== 'production';
  const resend = env.ORDER_EMAIL_ENABLED === 'true' && env.ORDER_EMAIL_PROVIDER === 'resend'
    && !!env.ORDER_EMAIL_API_KEY?.trim() && !!customerOrderEmail(env.ORDER_EMAIL_FROM?.trim());
  const enabled = !!(local || resend);
  return { enabled, provider: local ? 'local' : resend ? 'resend' : null,
    deliveryMode: local ? 'LOCAL_CAPTURE' : resend ? 'PROVIDER' : null,
    ...(enabled ? {} : { reasonCode: 'ORDER_EMAIL_NOT_CONFIGURED' }), acceptanceIsDelivery: false };
}
export interface OrderEmailMessage { recipient: string; subject: string; text: string; }
export type OrderEmailResult =
  | { status: 'ACCEPTED'; code: null; accepted: 1 }
  | { status: 'FAILED'; code: 'ORDER_EMAIL_RATE_LIMITED' | 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN'; accepted: 0 }
  | { status: 'BLOCKED'; code: 'ORDER_EMAIL_NOT_CONFIGURED' | 'ORDER_EMAIL_PROVIDER_REJECTED'; accepted: 0 };
export type OrderEmailTransport = (message: OrderEmailMessage, key: string, signal: AbortSignal) => Promise<{ status: number; acceptedId: string | null }>;
export const ORDER_EMAIL_TRANSPORT = Symbol('ORDER_EMAIL_TRANSPORT');

/** Local acceptance is a reviewable file, never an external email delivery. */
export const localOrderEmailTransport: OrderEmailTransport = async (message, key, signal) => {
  const config = orderEmailConfig();
  if (!config.enabled || config.provider !== 'local' || signal.aborted) return { status: 422, acceptedId: null };
  const id = key.startsWith('booking-order/') ? key.slice('booking-order/'.length) : '';
  if (!/^[a-f0-9-]{36}$/i.test(id)) return { status: 422, acceptedId: null };
  const directory = resolve(process.env.ORDER_EMAIL_LOCAL_CAPTURE_DIR?.trim() || join('.local', 'order-email-capture'));
  await mkdir(directory, { recursive: true });
  const target = join(directory, id + '.json'), temporary = join(directory, '.' + randomUUID() + '.tmp');
  const content = { recipient: message.recipient, subject: message.subject, text: message.text,
    deliveryMode: 'LOCAL_CAPTURE', externalDelivery: false, outboxId: id,
    idempotencyKey: key, capturedAt: new Date().toISOString() };
  try {
    await writeFile(temporary, JSON.stringify(content, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (signal.aborted) return { status: 422, acceptedId: null };
    try { await link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // An existing durable key may only acknowledge the exact same message.
      const previous = JSON.parse(await readFile(target, 'utf8'));
      if (previous.deliveryMode !== 'LOCAL_CAPTURE' || previous.externalDelivery !== false || previous.idempotencyKey !== key || previous.outboxId !== id || previous.recipient !== message.recipient
        || previous.subject !== message.subject || previous.text !== message.text) return { status: 409, acceptedId: null };
    }
    return { status: 200, acceptedId: 'local-' + id };
  } finally { await unlink(temporary).catch(() => undefined); }
};

/** One bounded request to a fixed provider. No recipient, payload or provider diagnostic logging. */
export const resendOrderEmailTransport: OrderEmailTransport = async (message, key, signal) => {
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal,
    headers: { Authorization: 'Bearer ' + process.env.ORDER_EMAIL_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ from: process.env.ORDER_EMAIL_FROM!.trim(), to: [message.recipient], subject: message.subject, text: message.text }) });
  if (!response.ok) { await response.body?.cancel(); return { status: response.status, acceptedId: null }; }
  const raw = await response.text();
  if (raw.length > 10000) return { status: response.status, acceptedId: null };
  try { const value: unknown = JSON.parse(raw); return { status: response.status, acceptedId: value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ? value.id : null }; }
  catch { return { status: response.status, acceptedId: null }; }
};

@Injectable()
export class OrderEmailDelivery {
  constructor(@Optional() @Inject(ORDER_EMAIL_TRANSPORT) private readonly transport: OrderEmailTransport = resendOrderEmailTransport) {}
  config() { return orderEmailConfig(); }
  async send(message: OrderEmailMessage, outboxId: string, timeoutMs = 10000): Promise<OrderEmailResult> {
    const config = this.config();
    if (!config.enabled) return { status: 'BLOCKED', code: 'ORDER_EMAIL_NOT_CONFIGURED', accepted: 0 };
    if (!customerOrderEmail(message.recipient) || !/^[a-f0-9-]{36}$/i.test(outboxId) || !message.subject || message.subject.length > 200 || /[\r\n\u0000]/.test(message.subject) || !message.text || message.text.length > 30000) {
      return { status: 'BLOCKED', code: 'ORDER_EMAIL_PROVIDER_REJECTED', accepted: 0 };
    }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const transport = config.provider === 'local' ? localOrderEmailTransport : this.transport;
      const result = await Promise.race([transport(message, 'booking-order/' + outboxId, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('ORDER_EMAIL_ACCEPTANCE_UNKNOWN')); }, timeoutMs);
      })]);
      if (result.status >= 200 && result.status < 300 && result.acceptedId) return { status: 'ACCEPTED', code: null, accepted: 1 };
      // An explicit rate rejection is safe to retry with the same durable key.
      if (result.status === 429) return { status: 'FAILED', code: 'ORDER_EMAIL_RATE_LIMITED', accepted: 0 };
      // Network/timeout/5xx or malformed success may already have been accepted.
      // Do not rely on a provider's finite idempotency retention to resend later.
      if (result.status >= 500 || result.status >= 200 && result.status < 300) return { status: 'FAILED', code: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN', accepted: 0 };
      return { status: 'BLOCKED', code: 'ORDER_EMAIL_PROVIDER_REJECTED', accepted: 0 };
    } catch { return { status: 'FAILED', code: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN', accepted: 0 }; }
    finally { if (timer) clearTimeout(timer); }
  }
}
