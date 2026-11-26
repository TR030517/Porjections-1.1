import { useEffect, useRef, useState } from 'react';
import { bookingOrderEmailMessage, bookingOrderEmailReasonMessage, OrderEmailReadFence, orderEmailPath, readBookingOrderEmail, type BookingOrderEmailView } from '../utils/bookingOrderEmail';
import './BookingOrderEmailStatus.css';
export type OrderEmailRequest = (path: string, options: { signal: AbortSignal }) => Promise<unknown>;

export default function BookingOrderEmailStatus({ bookingId, apiRequest, scopeKey = '', revision = 0, onReviewStoreEmail, storeEmailActionDisabled = false }: {
  bookingId: string; apiRequest: OrderEmailRequest; scopeKey?: string; revision?: number;
  onReviewStoreEmail?: () => void; storeEmailActionDisabled?: boolean;
}) {
  const fence = useRef(new OrderEmailReadFence()), mounted = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [value, setValue] = useState<{ scope: string; view: BookingOrderEmailView } | null>(null), [loading, setLoading] = useState(true);
  const scope = scopeKey + ':' + bookingId;
  fence.current.setScope(scope);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; fence.current.invalidate(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(), ticket = fence.current.begin(); setValue(null); setLoading(true);
    const current = () => mounted.current && !controller.signal.aborted && fence.current.current(ticket);
    void Promise.resolve().then(() => apiRequest(orderEmailPath(bookingId), { signal: controller.signal })).then(raw => {
      const view = readBookingOrderEmail(raw, bookingId); if (current()) setValue({ scope, view });
    }).catch(() => { if (current()) setValue(null); }).finally(() => { if (current()) setLoading(false); });
    return () => { controller.abort(); fence.current.invalidate(); };
  }, [bookingId, scope, apiRequest, revision, refresh]);
  const view = value?.scope === scope ? value.view : undefined;
  const customerReason = loading ? undefined : bookingOrderEmailReasonMessage(view?.statusReasonCode, view?.status, 'CUSTOMER', view?.localCapture);
  const storeReason = loading ? undefined : bookingOrderEmailReasonMessage(view?.storeStatusReasonCode, view?.storeStatus, 'SHOP', view?.localCapture);
  const canReviewStoreEmail = !!storeReason && (view?.storeStatusReasonCode === 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE' || view?.storeStatusReasonCode === 'ORDER_EMAIL_STORE_RECIPIENT_CHANGED');
  return <section aria-label="订单邮件通知" className="booking-order-email-status">
    <div aria-label="顾客订单邮件"><p className="booking-order-email-status__title">顾客订单邮件</p><p role="status" className="booking-order-email-status__message">{loading ? '正在读取邮件状态…' : bookingOrderEmailMessage(view?.status, view?.workerEnabled, view?.localCapture)}</p>
      {customerReason && <p role="status" className="booking-order-email-status__message">处理说明：{customerReason}</p>}</div>
    <div aria-label="门店收单邮件" className="booking-order-email-status__store"><p className="booking-order-email-status__title">门店收单邮件</p><p role="status" className="booking-order-email-status__message">{loading ? '正在读取门店邮件状态…' : view && view.storeStatus === undefined ? '此服务尚未提供门店邮件状态，请核对服务版本；不能据此判断门店已经收到订单。' : bookingOrderEmailMessage(view?.storeStatus, view?.workerEnabled, view?.localCapture, 'SHOP')}</p>
      {storeReason && <p role="status" className="booking-order-email-status__message">处理说明：{storeReason}</p>}
      {canReviewStoreEmail && onReviewStoreEmail && <button type="button" disabled={storeEmailActionDisabled} onClick={onReviewStoreEmail} className="booking-order-email-status__refresh">核对门店收单邮箱</button>}</div>
    <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="booking-order-email-status__refresh">重新读取邮件状态</button>
  </section>;
}
