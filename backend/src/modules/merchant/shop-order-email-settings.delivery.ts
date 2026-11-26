import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { customerOrderEmail } from '../../common/booking-order-email';
import { orderEmailConfig, resendOrderEmailTransport, type OrderEmailTransport } from '../notifications/order-email-delivery';

export const SHOP_ORDER_EMAIL_VERIFICATION_TRANSPORT = Symbol('SHOP_ORDER_EMAIL_VERIFICATION_TRANSPORT');
/** Deliberately separate from booking-order task IDs and customer sign-in codes. */
const localVerificationTransport: OrderEmailTransport = async (message, key, signal) => {
  if (orderEmailConfig().provider !== 'local' || signal.aborted) return { status: 422, acceptedId: null };
  const id = key.slice('shop-order-email-verification/'.length);
  if (!key.startsWith('shop-order-email-verification/') || !/^[a-f0-9-]{36}$/i.test(id)) return { status: 422, acceptedId: null };
  const directory = resolve(process.env.ORDER_EMAIL_VERIFICATION_CAPTURE_DIR?.trim() || join('.local', 'order-email-verification-capture'));
  await mkdir(directory, { recursive: true });
  const target = join(directory, id + '.json'), temporary = join(directory, '.' + randomUUID() + '.tmp');
  const content = { ...message, purpose: 'SHOP_ORDER_EMAIL_VERIFICATION', challengeId: id,
    idempotencyKey: key, deliveryMode: 'LOCAL_CAPTURE', externalDelivery: false, capturedAt: new Date().toISOString() };
  try {
    await writeFile(temporary, JSON.stringify(content, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (signal.aborted) return { status: 422, acceptedId: null };
    try { await link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = JSON.parse(await readFile(target, 'utf8'));
      if (previous.purpose !== content.purpose || previous.challengeId !== id || previous.externalDelivery !== false
        || previous.idempotencyKey !== key || previous.recipient !== message.recipient || previous.subject !== message.subject || previous.text !== message.text)
        return { status: 409, acceptedId: null };
    }
    return { status: 200, acceptedId: 'local-verification-' + id };
  } finally { await unlink(temporary).catch(() => undefined); }
};

@Injectable()
export class ShopOrderEmailVerificationDelivery {
  constructor(@Optional() @Inject(SHOP_ORDER_EMAIL_VERIFICATION_TRANSPORT) private readonly transport: OrderEmailTransport = resendOrderEmailTransport) {}
  config() { return orderEmailConfig(); }
  async send(email: string, code: string, challengeId: string, timeoutMs = 10000): Promise<'SENT' | 'FAILED' | 'UNKNOWN'> {
    const config = this.config();
    if (!config.enabled || !customerOrderEmail(email) || !/^\d{6}$/.test(code) || !/^[a-f0-9-]{36}$/i.test(challengeId)) return 'FAILED';
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const message = { recipient: email, subject: 'Verify your Massajoy booking notification email',
      text: `Your Massajoy booking notification verification code is ${code}. It expires in 10 minutes. Enter it only in the store email settings where you requested this change. This code does not sign you in, change your login email, or confirm any booking. If you did not request this change, ignore this email.` };
    try {
      const transport = config.provider === 'local' ? localVerificationTransport : this.transport;
      const result = await Promise.race([transport(message, 'shop-order-email-verification/' + challengeId, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('ACCEPTANCE_UNKNOWN')); }, timeoutMs);
      })]);
      if (result.status >= 200 && result.status < 300 && result.acceptedId) return 'SENT';
      if (result.status >= 500 || result.status >= 200 && result.status < 300) return 'UNKNOWN';
      return 'FAILED';
    } catch { return 'UNKNOWN'; }
    finally { if (timer) clearTimeout(timer); }
  }
}
