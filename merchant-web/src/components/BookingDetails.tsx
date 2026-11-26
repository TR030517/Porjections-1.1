import OrderHoldNotice from '../../../src/components/OrderHoldNotice';
import { bookingContactDetails } from '../../../src/utils/bookingContact';
import ServiceDurationLabel from '../../../src/components/ServiceDurationLabel';
import { displayLabel } from '../utils/displayLabels';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Form, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { cancelBooking, getBooking, getBookingRescheduleSlots, getBookingSettlements, recordOfflineReceipt, recordOfflineRefund, rescheduleBooking, reverseOfflineReceipt, settlementAmountCents, type BookingDetail, type BookingRescheduleSlots, type BookingSettlements, type OfflineMethod, type SettlementEntry } from '../api/bookings';
import { completeBooking, confirmBooking } from '../api/merchant';
import { currentShopAllows, isCurrentShop, useShopId } from '../hooks/useShopId';
import { errorMessage, money } from '../utils/feedback';
import { shopLocal, shopUtc } from '../utils/reservationTime';
import { bookingSegmentTime, sortedBookingSegments } from '../utils/bookingSegments';
import { bookingItemResources, bookingItemServiceLabel, bookingLegacyResources, bookingServiceSummary } from '../../../src/utils/bookingReception';
import { bookingSettlementGuidance, isSimpleOfflineOrder } from '../../../src/utils/bookingSettlementGuidance';
import { useMerchantDraftProtection } from './MerchantDraftGuard';
import BookingOrderEmailStatus, { type OrderEmailRequest } from '../../../src/components/BookingOrderEmailStatus';
import client from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { bookingOperationActions, checkBookingOperationReceipt, reconcileBookingOperation, type BookingOperationAction, type BookingOperationAttempt } from '../api/bookingOperations';
import { therapistRequestLabel, therapistMoveNotice } from '../utils/therapistSelection';
const orderEmailRequest: OrderEmailRequest = async (path, options) => (await client.get(path, options)).data;

const modes = { ONLINE: '在线预付', PAY_AT_STORE: '到店付款', ZERO: '零金额结算' };
const methods: Record<OfflineMethod, string> = { CASH: '现金', EXTERNAL_TERMINAL: '外部收款终端', OTHER: '其他线下方式' };
const entryLabels = { RECEIPT: '收款记录', REFUND: '实际退款记录', REVERSAL: '收款冲正', ZERO: '零金额凭证' };
interface CollectionValues { amount: string; method: OfflineMethod; occurred: string; reason: string; }
interface CollectionEditor { kind: 'RECEIPT' | 'REFUND' | 'REVERSAL'; key: string; entry?: SettlementEntry; attempted: boolean; }
type BookingAction = 'confirm' | 'complete' | 'cancel';
type MoveTarget = { date: string; startTime: string };
type OrderAttempt = BookingOperationAttempt & { move?: MoveTarget; requiresCancelReason?: true };
const pendingWrites = new Map<string, string>();
function pendingOrderWrite(key: string) { try { return sessionStorage.getItem(key) ?? pendingWrites.get(key) ?? null; } catch { return pendingWrites.get(key) ?? null; } }
function saveOrderWrite(key: string, value: string) { pendingWrites.set(key, value); try { sessionStorage.setItem(key, value); } catch { /* Retain the attempt in memory. */ } }
function clearOrderWrite(key: string, value: string) {
  if (pendingOrderWrite(key) !== value) return;
  pendingWrites.delete(key);
  try { if (sessionStorage.getItem(key) === value) sessionStorage.removeItem(key); } catch { /* The in-memory marker has been resolved. */ }
}
function operationAttempt(marker: string | null): OrderAttempt | null {
  try {
    const value = marker && JSON.parse(marker);
    if (!(value?.version === 1 && typeof value.requestKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value.requestKey)
      && bookingOperationActions.includes(value.action))) return null;
    if (value.move !== undefined && (value.action !== 'RESCHEDULE' || !/^\d{4}-\d{2}-\d{2}$/.test(value.move?.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.move?.startTime))) return null;
    if (value.requiresCancelReason !== undefined && (value.action !== 'STATUS:CANCELLED' || value.requiresCancelReason !== true)) return null;
    return {
      requestKey: value.requestKey, action: value.action,
      ...(value.move ? { move: value.move } : {}),
      ...(value.requiresCancelReason ? { requiresCancelReason: true } : {}),
    };
  } catch { return null; }
}
function checkOperationRead(row: BookingDetail, attempt: OrderAttempt, cancelReason?: string) {
  checkBookingOperationReceipt(row, row.id, attempt.action.startsWith('STATUS:') ? { status: attempt.action.slice(7), cancelReason } : attempt.move ?? {});
  if (attempt.requiresCancelReason && !row.cancelReason) throw new Error('尚未核对到已保存的取消原因，请继续核对原操作结果。');
}
function occurredTime(value: string, timezone: string) { try { return `${shopLocal(value, timezone).replace('T', ' ')} · ${timezone}`; } catch { return `${value} (UTC)`; } }

export function bookingTime(row: { timezone?: string | null; localDate?: string | null; localStartTime?: string | null; localEndTime?: string | null; startTime: string; endTime: string }): string {
  if (row.timezone) {
    try {
      const start = shopLocal(row.startTime, row.timezone), end = shopLocal(row.endTime, row.timezone);
      return `${start.replace('T', ' ')}–${start.slice(0, 10) === end.slice(0, 10) ? end.slice(11) : end.replace('T', ' ')} · ${row.timezone}`;
    } catch { /* Show explicit UTC when the saved shop zone is unavailable. */ }
  }
  const start = new Date(row.startTime), end = new Date(row.endTime);
  return Number.isFinite(+start) && Number.isFinite(+end) ? `${start.toISOString().slice(0, 16).replace('T', ' ')}–${start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10) ? end.toISOString().slice(11, 16) : end.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '时间不可用';
}

export function BookingSettlementGuidanceView({ settlements, canManageBooking, canRecordSettlement }: {
  settlements: unknown;
  canManageBooking?: boolean;
  canRecordSettlement?: boolean;
}) {
  const guidance = bookingSettlementGuidance(settlements, { canManageBooking, canRecordSettlement });
  return <><Typography.Title level={5}>订单处理说明</Typography.Title><Typography.Text strong>{guidance.title}</Typography.Text><Typography.Paragraph type="secondary">{guidance.message}</Typography.Paragraph></>;
}

interface BookingDetailsProps { id: string; shopId: string; onClose: () => void; onUpdated: () => void; presentation?: 'modal' | 'drawer' }
export function BookingDetailsDrawer(props: Omit<BookingDetailsProps, 'presentation'>) { return <BookingDetails {...props} presentation="drawer" />; }
export default function BookingDetails({ id, shopId, onClose, onUpdated, presentation = 'modal' }: BookingDetailsProps) {
  const actorId = useAuthStore(state => state.merchant?.id);
  const actorRole = useAuthStore(state => state.merchant?.role);
  const outcomeKey = `massajoy2:booking-outcome:${actorId}:${shopId}:${id}`;
  const draftScope = useRef(outcomeKey);
  const { can } = useShopId();
  const canManageBooking = can('BOOKINGS_MANAGE');
  const [booking, setBooking] = useState<BookingDetail | null>(null), [settlements, setSettlements] = useState<BookingSettlements | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [moving, setMoving] = useState(false), [dirty, setDirty] = useState(false), [reload, setReload] = useState(0);
  const [form] = Form.useForm<{ date: string; startTime: string }>();
  const moveDate = Form.useWatch('date', form) ?? '';
  const [slotPage, setSlotPage] = useState<BookingRescheduleSlots | null>(null), [slotsLoading, setSlotsLoading] = useState(false), [slotsError, setSlotsError] = useState(''), [slotsReload, setSlotsReload] = useState(0);
  const moveGeneration = useRef(0), moveVersion = moveGeneration.current;
  const [, setMoveRevision] = useState(0);
  const [collectionForm] = Form.useForm<CollectionValues>();
  const [collection, setCollection] = useState<CollectionEditor | null>(null);
  const [unresolved, setUnresolved] = useState<{ checked: boolean } | null>(null);
  const unresolvedRef = useRef(unresolved); unresolvedRef.current = unresolved;
  const [modal, modalContext] = Modal.useModal();
  const cancellationGuidanceId = useId();
  const scopeKey = `${actorId}:${actorRole}:${shopId}:${id}`;
  const navigate = useNavigate(), mounted = useRef(true), operationLock = useRef(false), scope = useRef({ key: scopeKey, version: 0 });
  if (scope.current.key !== scopeKey) { scope.current = { key: scopeKey, version: scope.current.version + 1 }; operationLock.current = false; }
  const version = scope.current.version;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => {
    const actor = useAuthStore.getState().merchant;
    return mounted.current && version === scope.current.version && actorId === actor?.id && actorRole === actor?.role && isCurrentShop(shopId);
  };
  const actionState = useRef({ actorId, booking, settlements, loading, busy, moving, dirty, collection, moveDate, slotPage, slotsLoading });
  actionState.current = { actorId, booking, settlements, loading, busy, moving, dirty, collection, moveDate, slotPage, slotsLoading };
  const canConfirm = (action: BookingAction, held = false) => {
    const latest = actionState.current;
    return current() && actorId === useAuthStore.getState().merchant?.id && latest.actorId === actorId
      && currentShopAllows(shopId, 'BOOKINGS_MANAGE') && !unresolvedRef.current && (held || !operationLock.current)
      && !latest.loading && (held || !latest.busy) && !latest.moving && !latest.collection
      && latest.booking?.id === id && latest.booking.shopId === shopId
      && latest.settlements?.bookingId === id && latest.settlements.shopId === shopId
      && latest.settlements.allowedActions[action];
  };
  useMerchantDraftProtection(shopId, dirty || !!collection || !!unresolved, busy,
    () => operationLock.current || collection?.attempted === true);
  useEffect(() => { unresolvedRef.current = pendingOrderWrite(outcomeKey) ? { checked: false } : null; setUnresolved(unresolvedRef.current); setBusy(false); }, [outcomeKey, actorRole]);
  useEffect(() => {
    if (unresolvedRef.current) { unresolvedRef.current = { checked: false }; setUnresolved(unresolvedRef.current); }
    const preserveDraft = !!unresolvedRef.current && draftScope.current === outcomeKey;
    draftScope.current = outcomeKey;
    const controller = new AbortController(); setLoading(true); setError(''); setNotice(''); setBooking(null); setSettlements(null);
    if (!preserveDraft) { setCollection(null); setMoving(false); setDirty(false); }
    readOrder(controller.signal).then(({ row, summary }) => { if (!controller.signal.aborted && current()) { setBooking(row); setSettlements(summary); if (unresolvedRef.current) { unresolvedRef.current = { checked: true }; setUnresolved(unresolvedRef.current); } } }).catch(e => { if (!controller.signal.aborted && current()) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted && current()) setLoading(false); });
    return () => controller.abort();
  }, [id, shopId, actorId, actorRole, reload]);
  const close = async () => {
    if (busy || operationLock.current || !current()) return;
    if (unresolvedRef.current) {
      if (!await modal.confirm({ title: '离开尚未确认结果的订单？', content: '原请求仍可能完成。离开不会撤销或重试该操作，请在再次操作前核对订单。', okText: '离开订单', cancelText: '继续核对' }) || !current() || operationLock.current) return;
      onClose(); return;
    }
    if ((dirty || collection) && !await modal.confirm({ title: collection ? '关闭结算编辑窗口？' : '放弃尚未保存的新时间？', content: collection?.attempted ? '本次已尝试提交。请重新打开并核对服务器账本后，再登记新操作。' : '尚未保存的输入将被放弃。', okText: '关闭', cancelText: '继续编辑' })) return;
    if (current() && !operationLock.current) onClose();
  };
  async function readOrder(signal?: AbortSignal) {
    const [row, summary] = await Promise.all([getBooking(id, shopId, signal), getBookingSettlements(id, shopId, signal)]);
    if (row.status !== summary.status || row.paymentStatus !== summary.paymentStatus || row.currency.toUpperCase() !== summary.currency.toUpperCase()
      || row.totalCents !== summary.totalCents || row.paidCents !== summary.paidCents || row.refundedCents !== summary.refundedCents) throw new Error('订单与流水快照不一致，请重新核对。');
    return { row, summary };
  }
  const act = async (operation: (key: string) => Promise<unknown>, text: string, action: BookingOperationAction, held = false, details: { move?: MoveTarget; cancelReason?: string } = {}) => {
    if ((!held && operationLock.current) || unresolvedRef.current || !current()) return;
    operationLock.current = true; setBusy(true); setError(''); setNotice('');
    const key = crypto.randomUUID();
    const submitted: OrderAttempt = {
      requestKey: key, action,
      ...(details.move ? { move: { ...details.move } } : {}),
      ...(details.cancelReason !== undefined ? { requiresCancelReason: true } : {}),
    };
    const attempt = JSON.stringify({ version: 1, ...submitted }); saveOrderWrite(outcomeKey, attempt);
    let acknowledged = false;
    try {
      await operation(key); acknowledged = true; if (!current()) return;
      const { row, summary } = await readOrder();
      checkOperationRead(row, submitted, details.cancelReason);
      if (!current() || pendingOrderWrite(outcomeKey) !== attempt) return;
      clearOrderWrite(outcomeKey, attempt);
      setBooking(row); setSettlements(summary); setMoving(false); setDirty(false); setCollection(null); setNotice(text); onUpdated();
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const unknown = acknowledged || !(typeof status === 'number' && status >= 400 && status < 500 && status !== 408);
      if (!unknown) clearOrderWrite(outcomeKey, attempt);
      if (current()) {
        if (unknown) { unresolvedRef.current = { checked: false }; setUnresolved(unresolvedRef.current); }
        setError((acknowledged ? '操作回执已返回，但尚未核对到一致的最新订单。请核对原操作结果；不要重复提交。' : '') + errorMessage(e));
      }
    }
    finally { if (current()) { operationLock.current = false; setBusy(false); } }
  };
  const confirm = async (action: BookingAction) => {
    if (!canConfirm(action)) return;
    const confirmedSnapshot = actionState.current.settlements;
    operationLock.current = true; setBusy(true);
    try {
      const text = action === 'cancel' ? '取消该预约并释放资源？此操作不会退款。' : action === 'complete' ? '完成该服务？此操作不会登记收款，清理缓冲时段仍保留至结束。' : settlements?.paymentMode === 'PAY_AT_STORE' ? '确认该订单预约？资源将继续保留，款项与顾客线下处理。确认预约不代表已经收款。' : '确认该预约？';
      const needsCancelReason = action === 'cancel' && actorRole === 'ADMIN';
      const isGuestBooking = actionState.current.booking?.bookingSource === 'ASSISTED_GUEST';
      let cancelReason: string | undefined;
      const confirmation = modal.confirm({
        title: text,
        okText: action === 'cancel' ? '取消预约' : action === 'complete' ? '完成服务' : '确认预约',
        okButtonProps: { danger: action === 'cancel', disabled: needsCancelReason },
        ...(needsCancelReason ? {
          content: <>
            <label>{isGuestBooking ? '取消原因' : '取消原因（顾客可见）'}
              <Input.TextArea required rows={3} maxLength={500} aria-describedby={isGuestBooking ? cancellationGuidanceId : undefined} onChange={event => {
                cancelReason = event.target.value.trim();
                confirmation.update({ okButtonProps: { danger: true, disabled: !cancelReason || cancelReason.length > 500 } });
              }} />
            </label>
            {isGuestBooking && <Typography.Paragraph id={cancellationGuidanceId} type="secondary">
              取消原因将记录在订单中，供有权限的工作人员查看。如需通知顾客，请拨打订单中的联系电话。
            </Typography.Paragraph>}
          </>,
        } : {}),
      });
      if (!await confirmation || !current()) return;
      if (needsCancelReason && (!cancelReason || cancelReason.length > 500)) return;
      if (!canConfirm(action, true) || actionState.current.settlements !== confirmedSnapshot) {
        setError('订单状态或当前操作权限已变化，请刷新订单详情后重新核对。');
        return;
      }
      await act(
        key => action === 'cancel' ? cancelBooking(id, key, cancelReason) : action === 'complete' ? completeBooking(id, key) : confirmBooking(id, key),
        '预约已更新。',
        action === 'cancel' ? 'STATUS:CANCELLED' : action === 'complete' ? 'STATUS:COMPLETED' : 'STATUS:CONFIRMED',
        true, { cancelReason },
      );
    } finally { if (current()) { operationLock.current = false; setBusy(false); } }
  };
  const finishReconciliation = async () => {
    if (!current() || operationLock.current || !unresolvedRef.current?.checked) return;
    operationLock.current = true; setBusy(true);
    try {
      if (!await modal.confirm({ title: '结束本次核对并关闭订单？', content: '已展示目前可读取的订单状态，但原请求仍可能稍后完成。结束核对不会撤销或重试原操作；本浏览器会话内重新打开仍为只读。', okText: '结束核对', cancelText: '继续核对' }) || !current()) return;
      onClose();
    } finally { if (current()) { operationLock.current = false; setBusy(false); } }
  };
  const recoverOperation = async () => {
    const marker = pendingOrderWrite(outcomeKey), attempt = operationAttempt(marker);
    if (!current() || operationLock.current || !unresolvedRef.current || !marker || !attempt) return;
    operationLock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (!await modal.confirm({ title: '核对原操作并恢复订单？', content: '如果原操作已经保存，将读取其结果；如果尚未执行，将停止该编号的迟到请求。不会重试原操作，核对成功后可重新操作。', okText: '核对并恢复', cancelText: '继续只读' }) || !current() || pendingOrderWrite(outcomeKey) !== marker) return;
      const result = await reconcileBookingOperation(id, shopId, attempt);
      if (!current() || pendingOrderWrite(outcomeKey) !== marker) return;
      const { row, summary } = await readOrder();
      if (!current() || pendingOrderWrite(outcomeKey) !== marker) return;
      if (result.outcome === 'COMMITTED') checkOperationRead(row, attempt);
      clearOrderWrite(outcomeKey, marker);
      unresolvedRef.current = null; setUnresolved(null); setBooking(row); setSettlements(summary);
      setMoving(false); setDirty(false); setCollection(null); form.resetFields(); collectionForm.resetFields();
      setNotice(result.outcome === 'COMMITTED' ? '原操作已保存，已读取最新订单，可以继续处理。' : '原操作未执行，已停止该编号的迟到请求，可以重新操作。');
      onUpdated();
    } catch (e) { if (current()) setError(errorMessage(e)); }
    finally { if (current()) { operationLock.current = false; setBusy(false); } }
  };
  const blocked = busy || !!unresolved;
  const active = booking && settlements && ['PENDING', 'CONFIRMED'].includes(settlements.status);
  const canMove = can('BOOKINGS_MANAGE') && active && +new Date(booking.startTime) > Date.now() && (settlements.status === 'CONFIRMED' && (settlements.paymentStatus === 'PAID' || settlements.paymentMode === 'PAY_AT_STORE' || settlements.paymentMode === 'ZERO') || settlements.status === 'PENDING' && settlements.paymentStatus === 'UNPAID' && (!booking.holdExpiresAt || +new Date(booking.holdExpiresAt) > Date.now()));
  useEffect(() => {
    const controller = new AbortController(); setSlotPage(null); setSlotsError('');
    if (!canMove || !moving || !booking || booking.id !== id || booking.shopId !== shopId || !/^\d{4}-\d{2}-\d{2}$/.test(moveDate ?? '')) { setSlotsLoading(false); return; }
    setSlotsLoading(true);
    getBookingRescheduleSlots(id, moveDate, controller.signal).then(value => { if (!controller.signal.aborted && current()) { if (value.timezone !== booking.timezone) throw new Error('改期时段的门店时区不匹配，请重新读取。'); setSlotPage(value); } })
      .catch(e => { if (!controller.signal.aborted && current()) setSlotsError(errorMessage(e)); })
      .finally(() => { if (!controller.signal.aborted && current()) setSlotsLoading(false); });
    return () => controller.abort();
  }, [id, shopId, actorId, actorRole, booking?.timezone, canMove, moving, moveDate, slotsReload]);
  const submitMove = (values: { date: string; startTime: string }) => {
    const latest = actionState.current;
    if (!current() || moveVersion !== moveGeneration.current || operationLock.current || unresolvedRef.current || actorId !== useAuthStore.getState().merchant?.id || latest.actorId !== actorId) return;
    if (!currentShopAllows(shopId, 'BOOKINGS_MANAGE')) { setError('当前账号的预约管理权限已变化，请核对门店权限。'); return; }
    if (latest.loading || latest.busy || !latest.moving || latest.collection
      || latest.booking?.id !== id || latest.booking.shopId !== shopId
      || latest.settlements?.bookingId !== id || latest.settlements.shopId !== shopId
      || latest.slotsLoading || values.date !== form.getFieldValue('date') || values.startTime !== form.getFieldValue('startTime')
      || values.date !== latest.moveDate || latest.slotPage?.date !== values.date || latest.slotPage.timezone !== latest.booking.timezone
      || !latest.slotPage.slots.some(slot => slot.available && slot.time === values.startTime)) {
      setError('请从原预约行程当前日期的可用时段中选择开始时间。'); return;
    }
    const target = { date: values.date, startTime: values.startTime };
    void act(key => rescheduleBooking(id, target, key), '预约已改期。', 'RESCHEDULE', false, { move: target });
  };
  const canEditMove = () => current() && moveVersion === moveGeneration.current && !operationLock.current && !unresolvedRef.current
    && !actionState.current.loading && !actionState.current.busy && actionState.current.moving
    && actionState.current.booking?.id === id && actionState.current.booking.shopId === shopId;
  const timezone = booking?.timezone || 'UTC';
  const simpleOffline = isSimpleOfflineOrder({ ...booking, ...settlements });
  const canCollect = (kind: CollectionEditor['kind'], entry?: SettlementEntry, editor: CollectionEditor | null = null, held = false) => {
    const latest = actionState.current;
    return current() && latest.actorId === actorId && currentShopAllows(shopId, kind === 'RECEIPT' ? 'SETTLEMENT_RECORD' : 'REFUNDS_MANAGE')
      && !unresolvedRef.current && (held || !operationLock.current) && !latest.loading && (held || !latest.busy)
      && !latest.moving && !latest.dirty && latest.collection === editor
      && latest.booking === booking && latest.booking?.id === id && latest.booking.shopId === shopId
      && latest.settlements === settlements && latest.settlements?.bookingId === id && latest.settlements.shopId === shopId
      && (kind === 'REVERSAL' ? entry?.kind === 'RECEIPT' && entry.canReverse && latest.settlements.entries.includes(entry)
        : latest.settlements.allowedActions[kind === 'RECEIPT' ? 'recordReceipt' : 'recordRefund']);
  };
  const openCollection = (kind: CollectionEditor['kind'], entry?: SettlementEntry) => {
    if (!settlements || !canCollect(kind, entry)) return;
    try {
      collectionForm.resetFields();
      collectionForm.setFieldsValue({ amount: ((kind === 'REFUND' ? settlements.netPaidCents : kind === 'REVERSAL' ? entry!.amountCents : settlements.amountDueCents) / 100).toFixed(2), method: 'CASH', occurred: shopLocal(new Date().toISOString(), timezone), reason: '' });
      setCollection({ kind, entry, key: crypto.randomUUID(), attempted: false }); setError(''); setNotice('');
    } catch (e) { setError(errorMessage(e)); }
  };
  const closeCollection = async () => {
    if (!collection || busy || operationLock.current || unresolvedRef.current) return;
    if (!await modal.confirm({ title: collection.attempted ? '刷新服务器账本？' : '放弃本次登记草稿？', content: collection.attempted ? '请先核对此前尝试的操作是否已登记，再开始新操作。' : '当前输入尚未提交。', okText: collection.attempted ? '刷新账本' : '放弃', cancelText: '继续编辑' }) || !current()) return;
    const attempted = collection.attempted; setCollection(null); if (attempted) setReload(value => value + 1);
  };
  const submitCollection = async (values: CollectionValues) => {
    if (!collection || !settlements || !canCollect(collection.kind, collection.entry, collection)) return;
    const editor = collection;
    try {
      const reason = values.reason.trim(); if (reason.length < 5 || reason.length > 500) throw new Error('请填写5至500字的真实原因。');
      const amountCents = collection.kind === 'REVERSAL' ? collection.entry!.amountCents : settlementAmountCents(values.amount);
      if (collection.kind === 'RECEIPT' && amountCents > settlements.amountDueCents) throw new Error('收款金额不可超过服务器显示的待收金额。');
      if (collection.kind === 'REFUND' && amountCents !== settlements.netPaidCents) throw new Error('请登记全部剩余净收款，刷新后核对金额。');
      const occurredAt = collection.kind === 'REVERSAL' ? undefined : shopUtc(values.occurred, timezone);
      if (occurredAt && (+new Date(occurredAt) < Date.now() - 31 * 86400000 || +new Date(occurredAt) > Date.now() + 5 * 60000)) throw new Error('实际发生时间须在过去31天内，且不得晚于当前时间5分钟。');
      const content = collection.kind === 'REVERSAL' ? `冲正整笔${money(amountCents, settlements.currency)}收款记录？此操作仅更正账本，不会向顾客退款。` : collection.kind === 'REFUND' ? `确认${money(amountCents, settlements.currency)}已通过以下方式实际退还：${methods[values.method]}。此操作仅登记实际发生的退款，不会发起退款或银行转账。` : `确认${money(amountCents, settlements.currency)}已通过以下方式实际收取：${methods[values.method]}。此操作仅登记实际发生的收款，不会向顾客扣款或转移资金。`;
      operationLock.current = true; setBusy(true);
      if (!await modal.confirm({ title: entryLabels[collection.kind], content, okText: collection.kind === 'REFUND' ? '已实际退还·登记' : collection.kind === 'REVERSAL' ? '冲正账本记录' : '已实际收到·登记', okButtonProps: { danger: collection.kind !== 'RECEIPT' } }) || !current()) return;
      if (!canCollect(editor.kind, editor.entry, editor, true)) { setError('账本草稿或当前操作权限已变化，请重新核对。'); return; }
      setCollection(value => value ? { ...value, attempted: true } : value);
      const payload = { requestKey: collection.key, amountCents, method: values.method, occurredAt: occurredAt!, reason };
      await act(key => collection.kind === 'REVERSAL' ? reverseOfflineReceipt(id, shopId, collection.entry!.id, { requestKey: collection.key, reason }, key) : collection.kind === 'REFUND' ? recordOfflineRefund(id, shopId, payload, key) : recordOfflineReceipt(id, shopId, payload, key), '记录已保存，余额已从服务器刷新。', collection.kind === 'REVERSAL' ? 'OFFLINE:REVERSAL' : collection.kind === 'REFUND' ? 'OFFLINE:REFUND' : 'OFFLINE:RECEIPT', true);
    } catch (e) { if (current()) setError(errorMessage(e)); }
    finally { if (current()) { operationLock.current = false; setBusy(false); } }
  };
  const customer = bookingContactDetails(booking);
  const legacyResources = bookingLegacyResources(booking);
  const reviewStoreEmail = () => {
    if (busy || operationLock.current || unresolvedRef.current || !current() || !currentShopAllows(shopId, 'SHOP_SETTINGS_MANAGE') || booking?.id !== id || booking.shopId !== shopId) return;
    navigate(`/settings?${new URLSearchParams({ shopId, focus: 'order-email' })}`);
  };
  // Both shells share this one content/action layer, including dirty/unknown-result guards.
  const content = <>
    {modalContext}<div className="merchant-modal-stack">
      {error && <Alert type="error" showIcon title={error} />}{notice && <Alert type="success" showIcon title={notice} />}
      {unresolved && <Alert type="warning" showIcon title="本次操作结果尚未确认，已暂停其他变更。" description="刷新可查看目前状态，但不会撤销或重试原操作。请核对原操作结果后恢复处理；旧版无操作编号的记录继续只读。" action={<Space wrap>{operationAttempt(pendingOrderWrite(outcomeKey)) && <Button disabled={busy || loading} onClick={() => void recoverOperation()}>核对原操作结果</Button>}<Button disabled={busy || loading || !unresolved.checked} onClick={() => void finishReconciliation()}>结束本次核对</Button></Space>} />}
      <Space wrap><Button loading={loading} disabled={busy || !unresolved && (dirty || !!collection)} onClick={() => { if (!operationLock.current && current() && (unresolvedRef.current || !actionState.current.dirty && !actionState.current.collection)) setReload(v => v + 1); }}>刷新订单详情</Button>{can('OWNER_ONLY') && <Button disabled={blocked || dirty || !!collection} onClick={() => { if (operationLock.current || unresolvedRef.current || !current()) return; onClose(); navigate(`/after-sales?bookingId=${encodeURIComponent(id)}`); }}>相关售后工单</Button>}</Space>
      {loading ? <Typography.Paragraph>正在加载订单与预约详情…</Typography.Paragraph> : booking && settlements && <>
        <Space wrap><Tag>{displayLabel(settlements.status)}</Tag>{!simpleOffline && <Tag>{displayLabel(settlements.paymentStatus)}</Tag>}<Tag color="cyan">{simpleOffline ? '预约订单 · 线下处理' : modes[settlements.paymentMode]}</Tag></Space>
        <Descriptions column={{ xs: 1, sm: 2 }} items={[
          ...(settlements.status === 'CANCELLED' ? [{
            key: 'cancelReason', label: '取消原因', span: 2,
            children: booking.cancelReason ? <span className="merchant-wrap">{booking.cancelReason}</span> : '未记录取消原因',
          }] : []),
          { key: 'contactBasis', label: '联系人来源', children: customer.label, span: 2 },
          { key: 'customer', label: '预约联系人', children: customer.name },
          { key: 'phone', label: '联系电话', children: customer.phone ? <Typography.Text copyable={{ text: customer.phone }}>{customer.phoneHref ? <a href={customer.phoneHref}>{customer.phone}</a> : customer.phone}</Typography.Text> : '联系电话未提供' },
          { key: 'email', label: '联系邮箱', children: customer.email ?? (customer.recorded ? '未填写邮箱' : '历史订单未记录联系邮箱'), span: 2 },
          { key: 'time', label: '门店当地时间', children: bookingTime(booking), span: 2 },
          { key: 'therapistRequest', label: '原技师请求', children: booking.reservationKind === 'PLAN' ? '逐段保存，详见下方服务段' : therapistRequestLabel(booking), span: 2 },
          { key: 'service', label: booking.reservationKind === 'PLAN' ? '行程' : '服务', children: bookingServiceSummary(booking) }, { key: 'duration', label: '预约预留总跨度', children: <ServiceDurationLabel total kind={booking.durationKind} minutes={booking.reservedDurationMin ?? booking.durationMin} /> },
          ...(!simpleOffline ? [{ key: 'subtotal', label: '主服务与附加项目小计', children: money(booking.priceCents, booking.currency) }, { key: 'discount', label: '主服务优惠券折扣', children: money(booking.discountCents, booking.currency) },
          { key: 'platformFee', label: '平台费用', children: money(booking.platformFeeCents, booking.currency) }, { key: 'tip', label: '小费（单独金额）', children: money(booking.tipCents, booking.currency) },
          ] : []), { key: 'total', label: '订单总额', children: money(settlements.totalCents, settlements.currency) }, ...(!simpleOffline ? [{ key: 'paid', label: '实际已收', children: money(settlements.paidCents, settlements.currency) },
          { key: 'refunded', label: '实际已退', children: money(settlements.refundedCents, settlements.currency) }, { key: 'net', label: '净收款', children: money(settlements.netPaidCents, settlements.currency) },
          { key: 'due', label: '待收余额', children: <strong>{money(settlements.amountDueCents, settlements.currency)}</strong> }] : []),
          ...(booking.holdExpiresAt == null ? [] : [{ key: 'hold', label: '临时保留记录', span: 2, children: <OrderHoldNotice key={'hold:' + id} holdExpiresAt={booking.holdExpiresAt} settlements={settlements} formatDeadline={value => occurredTime(value, timezone)} /> }]),
        ]} />
        <BookingOrderEmailStatus key={`${id}:${booking.status}:${booking.startTime}`} bookingId={id} apiRequest={orderEmailRequest} scopeKey={`${actorId}:${shopId}`} revision={reload} onReviewStoreEmail={can('SHOP_SETTINGS_MANAGE') && booking.id === id && booking.shopId === shopId ? reviewStoreEmail : undefined} storeEmailActionDisabled={blocked} /><section className="merchant-inset"><BookingSettlementGuidanceView settlements={{ ...booking, ...settlements }} canManageBooking={canManageBooking} canRecordSettlement={can('SETTLEMENT_RECORD') || can('REFUNDS_MANAGE')} /><details><summary>可选线下账本 · 仅登记已实际发生的收退</summary><Space wrap>{can('SETTLEMENT_RECORD') && settlements.allowedActions.recordReceipt && <Button type="primary" disabled={blocked || dirty || moving || !!collection} onClick={() => openCollection('RECEIPT')}>登记已实际收到的款项</Button>}{can('REFUNDS_MANAGE') && settlements.allowedActions.recordRefund && <Button disabled={blocked || dirty || moving || !!collection} onClick={() => openCollection('REFUND')}>登记已实际退还的款项</Button>}</Space></details></section>
        {collection && <section className="merchant-inset"><Typography.Title level={5}>{entryLabels[collection.kind]}</Typography.Title><Alert type={collection.kind === 'RECEIPT' ? 'info' : 'warning'} showIcon title={collection.kind === 'REVERSAL' ? '冲正仅更正收款账本，不代表退款。' : collection.kind === 'REFUND' ? '请在实际退还全部净收款后再登记。' : '请在实际收到付款后再登记收款。'} description={collection.kind === 'REVERSAL' ? '原收款记录仍会与冲正关联；如已退还资金，请登记实际退款。' : '此操作不会发起顾客扣款、退款请求或银行转账。'} /><Form form={collectionForm} layout="vertical" disabled={blocked} onFinish={values => void submitCollection(values)} style={{ marginTop: 16 }}><div className="merchant-form-grid"><Form.Item name="amount" label={`金额（${settlements.currency.toUpperCase()}）`} rules={[{ required: true }]}><Input inputMode="decimal" readOnly={collection.kind !== 'RECEIPT'} /></Form.Item>{collection.kind !== 'REVERSAL' && <Form.Item name="method" label={collection.kind === 'REFUND' ? '实际退款方式' : '实际收款方式'} rules={[{ required: true }]}><Select options={Object.entries(methods).map(([value, label]) => ({ value, label }))} /></Form.Item>}</div>{collection.kind !== 'REVERSAL' && <Form.Item name="occurred" label={`实际发生时间（${timezone}）`} rules={[{ required: true }]} extra="须在过去31天内，按UTC保存；夏令时跳过或重复的时间将被拒绝。"><Input type="datetime-local" step={60} /></Form.Item>}<Form.Item name="reason" label="真实原因（5至500字）" rules={[{ required: true }, { validator: (_, value: string) => typeof value === 'string' && value.trim().length >= 5 && value.trim().length <= 500 ? Promise.resolve() : Promise.reject(new Error('请填写5至500字的真实原因。')) }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item><Space wrap><Button type="primary" htmlType="submit" loading={busy}>核对并登记</Button><Button disabled={blocked} onClick={() => void closeCollection()}>{collection.attempted ? '关闭并核对账本' : '放弃草稿'}</Button></Space></Form></section>}
        <Collapse items={[{ key: 'ledger', label: `线下／零金额账本（${settlements.entries.length}）`, children: settlements.entries.length ? <div className="merchant-resource-list">{settlements.entries.map(entry => <article className="merchant-resource-row" key={entry.id}><div><strong>{entryLabels[entry.kind]} · {money(entry.amountCents, settlements.currency)}</strong><p className="merchant-secondary">{entry.method ? methods[entry.method] : '无外部资金流转'} · {occurredTime(entry.occurredAt, timezone)}</p><p className="merchant-secondary merchant-wrap">记录编号 #{entry.id}{entry.referenceEntryId ? ` · 原记录编号 #${entry.referenceEntryId}` : ''}</p><p className="merchant-wrap">{entry.reason}</p></div>{can('REFUNDS_MANAGE') && entry.canReverse && <Button danger disabled={blocked || dirty || moving || !!collection} onClick={() => openCollection('REVERSAL', entry)}>冲正错误收款记录</Button>}</article>)}</div> : <Typography.Paragraph type="secondary">暂无线下或零金额记录。线上付款不会显示为线下收款。</Typography.Paragraph> }]} />
        {booking.addOns.length>0&&<section><Typography.Title level={5}>附加项目 · 已保存价格</Typography.Title><Typography.Paragraph type="secondary">主服务 {money(booking.mainSubtotalCents,booking.currency)}，附加项目 {money(booking.addOnSubtotalCents,booking.currency)}；加项不增加时长，调价或停用不改变本订单。</Typography.Paragraph><div className="merchant-resource-list">{booking.addOns.map(row=><article className="merchant-resource-row" key={row.id}><div><strong>顾客 {row.participantIndex} · 主服务段 {row.sequence} · {row.name}</strong><p>{money(row.lineTotalCents,row.currency)} · 不增加预约时长</p></div></article>)}</div></section>}
        {booking.items.length > 0 ? <section><Typography.Title level={5}>全部服务段·已保存快照</Typography.Title><div className="merchant-resource-list">{sortedBookingSegments(booking.items).map(item => {
          const resources = bookingItemResources(item, booking.reception);
          return <article className="merchant-resource-row" key={item.id}><div><strong>顾客 {item.participantIndex} · 服务段 {item.sequence ?? '未提供'} · {bookingItemServiceLabel(item)}</strong><p><ServiceDurationLabel kind={item.durationKind} minutes={item.reservedDurationMin ?? item.durationMin} /></p><p className="merchant-secondary">{bookingSegmentTime(item, booking.timezone)}</p><p>服务段分摊金额 {money(item.priceCentsSnapshot, item.currency ?? booking.currency)} · 原报价 {money(item.quotedUnitPriceCents, item.currency ?? booking.currency)} ({item.priceBasisSnapshot === 'PER_BOOKING' ? '按整单计价；服务器分摊金额另列' : item.priceBasisSnapshot === 'PER_PERSON' ? '按人计价' : '未提供计价口径快照'})</p>{booking.reservationKind === 'PLAN' && <p>原技师请求：{therapistRequestLabel(item)}</p>}<p className="merchant-secondary">{resources.therapists.length ? '实际安排技师 ' + resources.therapists.map(row => row.label).join('、') : '未提供技师分配'}{resources.room ? ' · 场地 ' + resources.room.label : ''} · 清理缓冲：员工 {item.staffBufferMin}／场地 {item.roomBufferMin} 分钟{typeof item.preparationMin === 'number' ? ' · 下一服务段前准备时间' + item.preparationMin + '分钟' : ''}</p></div></article>;
        })}</div></section> : <section className="merchant-inset"><Typography.Title level={5}>历史预约资源</Typography.Title><Typography.Paragraph>{legacyResources.therapists.length ? '技师 ' + legacyResources.therapists.map(row => row.label).join('、') : '未提供技师分配'}</Typography.Paragraph><Typography.Paragraph type="secondary">该历史预约未保存逐人服务段，保留原预约时间与资源约束。</Typography.Paragraph></section>}
        {booking.notes && <div><strong>顾客备注</strong><p className="merchant-wrap">{booking.notes}</p></div>}
        <Space wrap>
          {can('BOOKINGS_MANAGE') && settlements.allowedActions.confirm && <Button type="primary" disabled={blocked || moving || !!collection} onClick={() => void confirm('confirm')}>{settlements.paymentMode === 'PAY_AT_STORE' ? '确认订单预约' : '确认预约'}</Button>}
          {can('BOOKINGS_MANAGE') && settlements.allowedActions.complete && <Button type="primary" disabled={blocked || moving || !!collection} onClick={() => void confirm('complete')}>完成服务</Button>}
          {canMove && <Button disabled={blocked || moving || !!collection} onClick={() => { if (operationLock.current || unresolvedRef.current || !current() || actionState.current.booking !== booking || actionState.current.settlements !== settlements || !currentShopAllows(shopId, 'BOOKINGS_MANAGE') || +new Date(booking.startTime) <= Date.now()) return; moveGeneration.current++; form.setFieldsValue({ date: booking.localDate || '', startTime: booking.localStartTime || '' }); setMoving(true); }}>改期</Button>}
          {can('BOOKINGS_MANAGE') && settlements.allowedActions.cancel && <Button danger disabled={blocked || moving || !!collection} onClick={() => void confirm('cancel')}>取消预约</Button>}
        </Space>
        {moving && <section className="merchant-inset"><Typography.Title level={5}>调整预约时间</Typography.Title><Alert type="info" showIcon title={therapistMoveNotice(booking)} /><Typography.Paragraph type="secondary">请输入新时间，时区为 {booking.timezone || '门店时区'}。可用开始时间已覆盖全部已保存服务段。原项目类型、预约预留块、原订单金额及资源规则保持不变。整段行程将一并移动；如有冲突，原预约将完整保留。</Typography.Paragraph>{slotsError && <Alert type="error" showIcon title={slotsError} action={<Button disabled={blocked || slotsLoading} onClick={() => setSlotsReload(value => value + 1)}>重新查询时段</Button>} />}{slotPage?.date === moveDate && !slotPage.slots.some(slot => slot.available) && <Typography.Paragraph type="secondary">该日没有可容纳已保存行程的开始时间，请选择其他日期。</Typography.Paragraph>}<Form form={form} layout="vertical" disabled={blocked || !can('BOOKINGS_MANAGE')} onValuesChange={changed => { if (!canEditMove() || !currentShopAllows(shopId, 'BOOKINGS_MANAGE')) return; moveGeneration.current++; setMoveRevision(moveGeneration.current); setDirty(true); if (Object.hasOwn(changed, 'date')) form.setFieldValue('startTime', ''); }} onFinish={submitMove}><div className="merchant-form-grid"><Form.Item name="date" label="新的门店当地日期" rules={[{ required: true }]}><Input type="date" /></Form.Item><Form.Item name="startTime" label="新的门店当地开始时间" rules={[{ required: true }]}><Select loading={slotsLoading} disabled={blocked || slotsLoading || !slotPage || slotPage.date !== moveDate} placeholder="请选择可用开始时间" options={slotPage?.date === moveDate ? slotPage.slots.map(slot => ({ value: slot.time, label: slot.time + (slot.available ? '' : ' · 不可用'), disabled: !slot.available })) : []} /></Form.Item></div><Space><Button type="primary" htmlType="submit" loading={busy} disabled={!dirty || slotsLoading || !slotPage || slotPage.date !== moveDate || !slotPage.slots.some(slot => slot.available)}>核对资源并保存</Button><Button disabled={blocked} onClick={() => { if (!canEditMove()) return; moveGeneration.current++; setMoving(false); setDirty(false); }}>保留原时间</Button></Space></Form></section>}
        {canManageBooking && <Typography.Paragraph type="secondary">提交预约变更时，服务器会重新核验归属、付款状态、有效期、退款请求与资源冲突。</Typography.Paragraph>}
      </>}
    </div>
  </>;
  const title = booking?.bookingNo ? `订单${booking.bookingNo}` : `订单编号 #${id}`;
  return presentation === 'drawer'
    ? <Drawer open title={title} size="large" styles={{ wrapper: { width: 'min(800px, 100vw)' } }} onClose={() => void close()} closable={!busy} maskClosable={false} destroyOnHidden>{content}</Drawer>
    : <Modal open title={title} width={800} footer={null} onCancel={() => void close()} closable={!busy} maskClosable={false} destroyOnHidden>{content}</Modal>;
}
