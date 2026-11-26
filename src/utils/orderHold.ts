export interface HoldSettlementEvidence {
  status?: unknown;
  paymentStatus?: unknown;
  paidCents?: unknown;
  refundedCents?: unknown;
  paymentMode?: unknown;
}
export interface OrderHoldPresentation {
  state: 'NONE' | 'ACTIVE_ACCEPTANCE' | 'ACTIVE_PAYMENT' | 'EXPIRED' | 'HISTORY' | 'INVALID';
  label: string;
  message: string;
  deadline: string | null;
  nextChangeAtMs: number | null;
}

/** Explicit timezone only. Reject impossible calendar dates rather than Date.parse rollover. */
export function holdDeadlineInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

/** Settlements are authoritative. A saved booking.status is deliberately not an input. */
export function orderHoldPresentation(holdExpiresAt: unknown, settlements: HoldSettlementEvidence | null | undefined, nowMs: number): OrderHoldPresentation {
  if (holdExpiresAt === undefined || holdExpiresAt === null) return { state: 'NONE', label: '', message: '', deadline: null, nextChangeAtMs: null };
  const expires = holdDeadlineInstant(holdExpiresAt);
  if (expires === null) return { state: 'INVALID', label: '临时预留期限无法核对', message: '请刷新核对预约资料。', deadline: null, nextChangeAtMs: null };
  const deadline = holdExpiresAt as string, mode = settlements?.paymentMode;
  const historyLabel = mode === 'PAY_AT_STORE' ? '原待接受截止（历史）' : mode === 'ONLINE' ? '原付款保留截止（历史）' : '原临时保留截止（历史）';
  const eligible = settlements?.status === 'PENDING' && settlements.paymentStatus === 'UNPAID' && settlements.paidCents === 0
    && (settlements.refundedCents === undefined || settlements.refundedCents === 0) && (mode === 'ONLINE' || mode === 'PAY_AT_STORE');
  if (!eligible || !Number.isFinite(nowMs)) return { state: 'HISTORY', label: historyLabel, message: '历史记录，不表示当前资源占用；预约状态以服务器为准。', deadline, nextChangeAtMs: null };
  if (expires <= nowMs) return { state: 'EXPIRED', label: '临时预留期限已到，请刷新核对预约结果', message: '此为页面到期提示，实际预约与资源状态以服务器为准。', deadline, nextChangeAtMs: null };
  return { state: mode === 'PAY_AT_STORE' ? 'ACTIVE_ACCEPTANCE' : 'ACTIVE_PAYMENT', label: mode === 'PAY_AT_STORE' ? '待接受截止' : '付款临时保留截止', message: '预约结果以当前服务端状态为准。', deadline, nextChangeAtMs: expires };
}

export interface OrderHoldClock {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}
const browserClock: OrderHoldClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};
export const HOLD_TIMER_MAX_DELAY_MS = 2_147_483_647;

/** One local display timer, re-armed only for long delays/clock rollback. Never performs I/O. */
export function watchOrderHoldDeadline(deadlineMs: number | null, onDeadline: () => void, clock: OrderHoldClock = browserClock): () => void {
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) return () => {};
  let stopped = false, handle: unknown, scheduled = false;
  const arm = () => {
    if (stopped) return;
    const remaining = deadlineMs - clock.now();
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) { onDeadline(); return; }
    scheduled = true;
    handle = clock.schedule(() => { scheduled = false; arm(); }, Math.min(remaining, HOLD_TIMER_MAX_DELAY_MS));
  };
  arm();
  return () => { stopped = true; if (scheduled) clock.cancel(handle); };
}
