import { useEffect, useReducer } from 'react';
import { orderHoldPresentation, watchOrderHoldDeadline, type HoldSettlementEvidence } from '../utils/orderHold';

export interface OrderHoldNoticeProps {
  holdExpiresAt: unknown;
  settlements: HoldSettlementEvidence | null | undefined;
  formatDeadline: (value: string) => string;
  nowMs?: number;
}

/** Shared by both management backends. The deadline timer changes wording only. */
export default function OrderHoldNotice({ holdExpiresAt, settlements, formatDeadline, nowMs }: OrderHoldNoticeProps) {
  const [, refreshDisplay] = useReducer((value: number) => value + 1, 0);
  const view = orderHoldPresentation(holdExpiresAt, settlements, nowMs ?? Date.now());
  useEffect(() => {
    if (nowMs !== undefined) return;
    return watchOrderHoldDeadline(view.nextChangeAtMs, refreshDisplay);
  }, [view.nextChangeAtMs, nowMs]);
  if (view.state === 'NONE') return null;
  const active = view.state === 'ACTIVE_ACCEPTANCE' || view.state === 'ACTIVE_PAYMENT';
  let displayed = '';
  if (view.deadline) { try { displayed = formatDeadline(view.deadline); } catch { displayed = view.deadline + '（已保存时间）'; } }
  return <div role="note" aria-live="polite" data-order-hold-state={view.state} style={{ marginTop: 12, border: '1px solid', borderColor: active ? '#b9d9d6' : '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 12, lineHeight: '24px', background: active ? '#f1f9f8' : '#f8fafc', color: active ? '#236b68' : '#475569' }}>
    <p style={{ margin: 0 }}><span style={{ fontWeight: 600 }}>{view.label}</span>{view.deadline && <>{view.state === 'EXPIRED' ? ' · 已存截止：' : '：'}<time dateTime={view.deadline}>{displayed}</time></>}</p>
    <p style={{ margin: 0 }}>{view.message}</p>
  </div>;
}
