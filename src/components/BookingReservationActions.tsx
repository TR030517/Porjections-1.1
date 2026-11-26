import OrderHoldNotice from './OrderHoldNotice';
import ServiceDurationLabel from './ServiceDurationLabel';
import BookingReceptionDetails, { BookingResourceNames } from './BookingReceptionDetails';
import { bookingItemServiceLabel } from '../utils/bookingReception';
import BookingSettlementGuidance from './BookingSettlementGuidance';
import BookingOrderEmailStatus, { type OrderEmailRequest } from './BookingOrderEmailStatus';
import { isSimpleOfflineOrder } from '../utils/bookingSettlementGuidance';
import { normalizeSavedBooking } from '../utils/serviceDuration';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, RefreshCw, Wallet } from 'lucide-react';
import { apiRequest, ApiError, subscribeSession } from '../api/session';
import { getBookingSettlements, recordOfflineReceipt, recordOfflineRefund, reverseOfflineReceipt, settlementAmountCents, type BookingSettlements, type OfflineMethod, type SettlementEntry } from '../api/bookingSettlements';
import { localReservationTime, reservationUtc } from '../utils/reservationForm';
import { useConfirmation } from './Confirmation';
import { getBookingRescheduleSlots, rescheduleBooking, updateBookingStatus } from '../api/bookingDetails';
import { reconcileBookingOperation, type BookingOperationAction } from '../api/bookingOperations';
import type { BookingDetail, BookingRescheduleSlots } from '../types/bookingDetails';
import { bookingSegmentTime, sortedBookingSegments } from '../utils/bookingSegments';
import { useAuthStore } from '../stores/authStore';
import { useBusinessScope } from './store/businessScope';
const orderEmailRequest: OrderEmailRequest = (path, options) => apiRequest(path, options);
interface EntryEditor { kind: 'RECEIPT' | 'REFUND' | 'REVERSAL'; key: string; entry?: SettlementEntry; attempted: boolean; }
const inputClass = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400';
const primary = 'rounded-lg bg-[#287C7C] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40';
const secondary = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 disabled:opacity-40';
const methodLabels: Record<OfflineMethod, string> = { CASH: '现金', EXTERNAL_TERMINAL: '外部终端', OTHER: '其他线下方式' };
const entryLabels = { RECEIPT: '收款登记', REFUND: '实际退款登记', REVERSAL: '收款冲正', ZERO: '零额结算凭证' };
const modeLabels = { ONLINE: '在线预付', PAY_AT_STORE: '到店付款', ZERO: '零额结算' };
const bookingStatusLabels: Record<string, string> = { PENDING: '待确认', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消', REFUNDING: '退款中', REFUNDED: '已退款' };
const paymentStatusLabels: Record<string, string> = { UNPAID: '未支付', PAID: '已支付', PARTIALLY_REFUNDED: '部分退款', REFUNDED: '已退款' };
const money = (cents: number | undefined | null, currency: string) => Number.isSafeInteger(cents) && currency ? `${currency.toUpperCase()} ${(cents! / 100).toFixed(2)}` : '未提供';
interface PendingOrderOperation { actorId: string; shopId: string; requestKey: string; action: BookingOperationAction; }
// Keep legacy unkeyed markers frozen. Only the exact submitting identity/key can
// ask the server to establish the result and seal an unexecuted old command.
const unresolvedOrders = new Map<string, PendingOrderOperation | null>();
const unresolvedStorageKey = 'massajoy.admin.unresolved-booking-operations.v1';
const operationStorageKey = 'massajoy.admin.booking-operation-attempts.v2';
function storedUnresolved() {
  try { const value: unknown = JSON.parse(window.sessionStorage.getItem(unresolvedStorageKey) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}
function storedOperations(): Record<string, PendingOrderOperation> {
  try { const value: unknown = JSON.parse(window.sessionStorage.getItem(operationStorageKey) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, PendingOrderOperation> : {}; }
  catch { return {}; }
}
function pendingOrderOperation(key: string): PendingOrderOperation | null | undefined {
  if (unresolvedOrders.has(key)) return unresolvedOrders.get(key);
  if (!storedUnresolved().includes(key)) return undefined;
  const value = storedOperations()[key];
  const valid = value && /^\d+$/.test(value.actorId) && /^\d+$/.test(value.shopId)
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value.requestKey)
    && ['STATUS:CONFIRMED', 'STATUS:COMPLETED', 'STATUS:CANCELLED', 'RESCHEDULE', 'OFFLINE:RECEIPT', 'OFFLINE:REFUND', 'OFFLINE:REVERSAL'].includes(value.action);
  unresolvedOrders.set(key, valid ? value : null);
  return valid ? value : null;
}
function orderUnresolved(key: string) { return pendingOrderOperation(key) !== undefined; }
function rememberOperation(key: string, operation: PendingOrderOperation) {
  unresolvedOrders.set(key, operation);
  try {
    window.sessionStorage.setItem(unresolvedStorageKey, JSON.stringify([...new Set([...storedUnresolved(), key])]));
    window.sessionStorage.setItem(operationStorageKey, JSON.stringify({ ...storedOperations(), [key]: operation }));
  } catch { /* Retain the in-memory guard when browser storage is unavailable. */ }
}
function sameOperation(a: PendingOrderOperation | null | undefined, b: PendingOrderOperation) {
  return a?.actorId === b.actorId && a.shopId === b.shopId && a.requestKey === b.requestKey && a.action === b.action;
}
function clearOperation(key: string, operation: PendingOrderOperation) {
  if (!sameOperation(pendingOrderOperation(key), operation)) return false;
  unresolvedOrders.delete(key);
  try {
    window.sessionStorage.setItem(unresolvedStorageKey, JSON.stringify(storedUnresolved().filter(value => value !== key)));
    const saved = storedOperations(); delete saved[key];
    window.sessionStorage.setItem(operationStorageKey, JSON.stringify(saved));
  } catch { /* A retained storage marker remains conservative on reopening. */ }
  return !orderUnresolved(key);
}
const uncertainWrite = (error: unknown) => !(error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408);
function occurredLabel(value: string, timezone: string) {
  try { return localReservationTime(value, timezone).replace('T', ' ') + ' · ' + timezone; }
  catch { return value + '（UTC）'; }
}

export default function BookingReservationActions({ bookingId, scopeKey = '', expectedShopId, onUpdated, onSnapshot, onBusyChange, onDirtyChange, onUnknownChange }: { bookingId: string; scopeKey?: string; expectedShopId?: string; onUpdated: (booking: BookingDetail) => void; onSnapshot?: (booking: BookingDetail) => void; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void; onUnknownChange?: (unknown: boolean) => void }) {
  const { user } = useAuthStore();
  const business = useBusinessScope(expectedShopId);
  const confirm = useConfirmation();
  const actor = user?.role === 'ADMIN' ? String(user.id) : null;
  const identity = JSON.stringify([actor, scopeKey, bookingId, expectedShopId]);
  const orderKey = JSON.stringify([expectedShopId ?? null, bookingId]);
  const mounted = useRef(true), lock = useRef<symbol | null>(null), live = useRef({ identity, actor, generation: 0 });
  if (live.current.identity !== identity) { live.current = { identity, actor, generation: live.current.generation + 1 }; lock.current = null; }
  const generation = live.current.generation;
  const current = () => mounted.current && actor !== null && actor === live.current.actor && identity === live.current.identity && generation === live.current.generation;
  const capture = () => { const scoped = business.capture(); return () => current() && scoped(); };
  useLayoutEffect(() => subscribeSession(next => { const nextActor = next?.role === 'ADMIN' ? String(next.id) : null; if (live.current.actor !== nextActor) { live.current.actor = nextActor; live.current.generation++; lock.current = null; } }), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [booking, setBooking] = useState<BookingDetail | null>(null), [settlements, setSettlements] = useState<BookingSettlements | null>(null);
  const [loading, setLoading] = useState(true), [reload, setReload] = useState(0), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [date, setDate] = useState(''), [time, setTime] = useState('');
  const [slotsReload, setSlotsReload] = useState(0);
  const [slotPage, setSlotPage] = useState<BookingRescheduleSlots | null>(null), [slotsLoading, setSlotsLoading] = useState(false), [slotsError, setSlotsError] = useState('');
  const [editor, setEditor] = useState<EntryEditor | null>(null), [amount, setAmount] = useState(''), [method, setMethod] = useState<OfflineMethod>('CASH'), [occurred, setOccurred] = useState(''), [reason, setReason] = useState('');
  const [cancelDraft, setCancelDraft] = useState('');
  const [unknown, setUnknown] = useState(() => orderUnresolved(orderKey));
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const frozen = unknown || orderUnresolved(orderKey), blocked = saving || frozen || needsRefresh;
  const latestView = useRef({ booking, settlements, editor, date, time });
  latestView.current = { booking, settlements, editor, date, time };
  const liveView = () => latestView.current.booking === booking && latestView.current.settlements === settlements && latestView.current.editor === editor && latestView.current.date === date && latestView.current.time === time;
  const edit = (change: () => void) => { if (!blocked && !lock.current && current() && liveView()) change(); };
  const timeDirty = !!booking && (date !== (booking.localDate ?? '') || time !== (booking.localStartTime ?? ''));
  const dirty = timeDirty || editor !== null;
  const hasCancelDraft = cancelDraft !== '';
  const leaveDirty = dirty || hasCancelDraft;
  useEffect(() => { onDirtyChange(leaveDirty); }, [leaveDirty, onDirtyChange]);
  useEffect(() => { onUnknownChange?.(frozen); }, [frozen, onUnknownChange]);
  useEffect(() => { setSaving(false); onBusyChange(false); setUnknown(orderUnresolved(orderKey)); setCancelDraft(''); setNeedsRefresh(false); }, [identity]);
  useEffect(() => {
    if (!leaveDirty && !frozen) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [leaveDirty, frozen]);
  function checked(detail: BookingDetail, summary: BookingSettlements) {
    const detailShop = (detail as BookingDetail & { shopId?: string }).shopId;
    if (!detail || String(detail.id) !== bookingId || String(summary.bookingId) !== bookingId
      || expectedShopId !== undefined && String(summary.shopId) !== expectedShopId
      || detailShop !== undefined && String(detailShop) !== String(summary.shopId)) throw new Error('预约详情或所属门店不匹配，请重新加载。');
    if (detail.status !== summary.status || detail.paymentStatus !== summary.paymentStatus || detail.currency?.toUpperCase() !== summary.currency.toUpperCase()
      || detail.totalCents !== summary.totalCents || detail.paidCents !== summary.paidCents || detail.refundedCents !== summary.refundedCents) throw new Error('订单与流水快照不一致，请重新读取核对。');
    return normalizeSavedBooking(detail);
  }
  async function read(signal?: AbortSignal) {
    const [detail, summary] = await Promise.all([apiRequest<BookingDetail>('/bookings/' + encodeURIComponent(bookingId), { signal }), getBookingSettlements(bookingId, signal)]);
    return { detail: checked(detail, summary), summary };
  }
  function show(value: Awaited<ReturnType<typeof read>>, preserveDraft = false) {
    setBooking(value.detail); setSettlements(value.summary);
    if (!preserveDraft) { setEditor(null); setDate(value.detail.localDate ?? ''); setTime(value.detail.localStartTime ?? ''); }
    if (value.detail.status === 'CANCELLED') setCancelDraft('');
  }
  useEffect(() => {
    const valid = capture();
    const controller = new AbortController(); setLoading(true); setError(''); setBooking(null); setSettlements(null); setEditor(null); setNotice('');
    if (actor === null) { setLoading(false); return () => controller.abort(); }
    read(controller.signal).then(value => {
      if (controller.signal.aborted || !valid()) return;
      show(value); setNeedsRefresh(false); onSnapshot?.(value.detail);
    }).catch(e => { if (!controller.signal.aborted && valid()) setError(e instanceof Error ? e.message : '预约或收款资料加载失败'); })
      .finally(() => { if (!controller.signal.aborted && valid()) setLoading(false); });
    return () => controller.abort();
  }, [identity, reload]);
  const timezone = booking?.timezone || 'UTC';
  const simpleOffline = isSimpleOfflineOrder({ ...booking, ...settlements });
  const canMove = booking && settlements && new Date(booking.startTime) > new Date()
    && (settlements.status === 'CONFIRMED' && (settlements.paymentStatus === 'PAID' || settlements.paymentMode === 'PAY_AT_STORE' || settlements.paymentMode === 'ZERO')
      || settlements.status === 'PENDING' && settlements.paymentStatus === 'UNPAID' && (!booking.holdExpiresAt || new Date(booking.holdExpiresAt) > new Date()));
  useEffect(() => {
    const valid = capture();
    const controller = new AbortController(); setSlotPage(null); setSlotsError('');
    if (!canMove || !booking || booking.id !== bookingId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setSlotsLoading(false); return; }
    setSlotsLoading(true);
    getBookingRescheduleSlots(bookingId, date, controller.signal).then(value => { if (!controller.signal.aborted && valid()) { if (value.timezone !== booking.timezone) throw new Error('改期时段的门店时区不匹配，请重新读取。'); setSlotPage(value); } })
      .catch(e => { if (!controller.signal.aborted && valid()) setSlotsError(e instanceof Error ? e.message : '改期时段读取失败'); })
      .finally(() => { if (!controller.signal.aborted && valid()) setSlotsLoading(false); });
    return () => controller.abort();
  }, [identity, booking, canMove, date, slotsReload]);
  const validMoveTime = !slotsLoading && slotPage?.date === date && slotPage.slots.some(slot => slot.available && slot.time === time);
  function begin(allowReadOnly = false) {
    if (lock.current || !current() || !liveView() || !allowReadOnly && (orderUnresolved(orderKey) || needsRefresh)) return null;
    const valid = capture(); if (!valid()) return null;
    const token = Symbol(); lock.current = token; setSaving(true); onBusyChange(true);
    return { token, valid };
  }
  function finish(ticket: NonNullable<ReturnType<typeof begin>>) {
    if (lock.current !== ticket.token) return;
    lock.current = null;
    if (ticket.valid()) { setSaving(false); onBusyChange(false); }
  }
  function receiptIdentity(value: unknown) {
    const receipt = value as BookingDetail & { shopId?: string };
    if (!receipt || String(receipt.id) !== bookingId || expectedShopId !== undefined && receipt.shopId !== undefined && String(receipt.shopId) !== expectedShopId) throw new Error('操作回执与当前订单不匹配。');
    return receipt;
  }
  async function run(operation: (requestKey: string) => Promise<unknown>, action: BookingOperationAction, text: string, validate: (value: unknown) => void, question?: Parameters<typeof confirm>[0], beforeSubmit?: () => void) {
    if (!booking) return;
    const ticket = begin(); if (!ticket) return;
    let dispatched = false;
    let attempt: PendingOrderOperation | undefined;
    setError(''); setNotice('');
    try {
      if (question && !await confirm(question) || !ticket.valid() || !liveView()) return;
      beforeSubmit?.();
      attempt = { actorId: actor!, shopId: String(settlements!.shopId), requestKey: crypto.randomUUID(), action };
      rememberOperation(orderKey, attempt); dispatched = true;
      const receipt = await operation(attempt.requestKey); validate(receipt);
      clearOperation(orderKey, attempt);
      if (!ticket.valid()) return;
      if (action === 'STATUS:CANCELLED') setCancelDraft('');
      setEditor(null); setNotice('操作已保存，正在核对最新结果…');
      try {
        const value = await read(); if (!ticket.valid()) return;
        show(value); setNotice(text); onUpdated(value.detail);
      } catch (e) {
        if (ticket.valid()) { setBooking(null); setSettlements(null); setNotice('操作已保存。'); setError('操作已保存，但最新资料读取失败。请重新加载核对，不要重复登记。' + (e instanceof Error ? e.message : '')); }
      }
    } catch (e) {
      const uncertain = dispatched && uncertainWrite(e);
      if (!uncertain && attempt) clearOperation(orderKey, attempt);
      if (ticket.valid()) {
        setUnknown(orderUnresolved(orderKey));
        if (e instanceof ApiError && e.code === 'BOOKING_STATUS_CHANGED') setNeedsRefresh(true);
        setError((uncertain ? '提交结果未确认，已暂停本订单的所有修改。请核对原操作结果，不要重新提交。' : '') + (e instanceof Error ? e.message : '操作失败'));
      }
    } finally { finish(ticket); }
  }
  async function reconcile() {
    const ticket = begin(true); if (!ticket) return;
    setError('');
    try {
      const value = await read(); if (!ticket.valid()) return;
      show(value, dirty); onUpdated(value.detail);
      setNotice('已读取当前订单与流水。读取成功不能证明原请求已经结束；本订单仍保持只读，请勿重试原操作。');
    } catch (e) { if (ticket.valid()) setError('只读核对失败，继续保留原操作与只读状态。' + (e instanceof Error ? e.message : '')); }
    finally { finish(ticket); }
  }
  async function resolveOperation() {
    const attempt = pendingOrderOperation(orderKey);
    if (!attempt || attempt.actorId !== actor || expectedShopId !== undefined && attempt.shopId !== expectedShopId) return;
    const ticket = begin(true); if (!ticket) return;
    setError('');
    try {
      if (!await confirm({ title: '核对原操作结果', message: '查询原操作是否已经执行；如果尚未执行，系统将使这条旧请求失效，防止它稍后再次生效。不会重试原操作。', confirmLabel: '核对并恢复操作' }) || !ticket.valid() || !sameOperation(pendingOrderOperation(orderKey), attempt)) return;
      const result = await reconcileBookingOperation(bookingId, attempt.shopId, attempt.requestKey, attempt.action);
      if (!ticket.valid() || !sameOperation(pendingOrderOperation(orderKey), attempt)) return;
      const value = await read();
      if (!ticket.valid() || !sameOperation(pendingOrderOperation(orderKey), attempt)) return;
      if (!clearOperation(orderKey, attempt)) throw new Error('原操作标记仍被保留，请继续核对。');
      show(value); setUnknown(false); onUpdated(value.detail);
      setNotice(result.outcome === 'COMMITTED' ? '已确认原操作执行完成，并已核对最新订单。可以继续操作。' : '已确认原操作未执行，旧请求已失效。已核对最新订单，可以继续操作。');
    } catch (e) { if (ticket.valid()) { setUnknown(true); setError('原操作结果尚未完成核对，继续保留草稿与只读状态。' + (e instanceof Error ? e.message : '')); } }
    finally { finish(ticket); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!booking || blocked || lock.current || editor || !timeDirty || !validMoveTime || !current()) return;
    await run(key => rescheduleBooking(booking.id, { date, startTime: time }, key), 'RESCHEDULE', '改期已保存，原报价保持不变。', value => {
      const receipt = receiptIdentity(value);
      if (receipt.localDate !== date || receipt.localStartTime !== time) throw new Error('改期回执与提交的门店日期时间不匹配。');
    });
  }
  async function transition(status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED') {
    if (!booking || !settlements || blocked || lock.current || dirty || !current() || !settlements.allowedActions[status === 'CONFIRMED' ? 'confirm' : status === 'COMPLETED' ? 'complete' : 'cancel']) return;
    const label = status === 'CONFIRMED' ? '接受预约' : status === 'COMPLETED' ? '完成服务' : '取消预约';
    const message = status === 'CANCELLED' ? '取消后释放预约资源。若已收款，请先按付款方式处理退款。' : status === 'COMPLETED' ? '请确认服务已经结束。服务完成不会增加收款，清理缓冲保留至结束。' : settlements.paymentMode === 'PAY_AT_STORE' ? '确认预约后保留实际资源，款项与顾客线下处理；此操作不代表已经收钱。' : '请确认按预约时段提供服务。预约状态和收款记录分别保留。';
    const cancelling = status === 'CANCELLED';
    const contact = booking.contact;
    const guestAssisted = contact !== null && typeof contact === 'object' && 'source' in contact && contact.source === 'GUEST_ASSISTED';
    let cancelReason = cancelDraft;
    await run(key => updateBookingStatus(booking.id, status === 'CANCELLED' ? { status, cancelReason } : { status }, key), `STATUS:${status}`, label + '已保存。', value => {
      const receipt = receiptIdentity(value);
      if (receipt.status !== status) throw new Error('操作回执与提交的预约状态不匹配。');
      if (cancelling && receipt.cancelReason !== cancelReason) throw new Error('操作回执与提交的取消原因不匹配。');
    }, {
      title: label,
      message,
      confirmLabel: cancelling ? '确认取消预约' : label,
      tone: cancelling ? 'danger' : 'primary',
      reason: cancelling ? {
        label: '取消原因（必填）',
        description: guestAssisted
          ? '最多 500 字。取消原因将记录在订单中，供有权限的工作人员查看。如需通知顾客，请拨打订单中的联系电话。请避免填写内部或敏感信息。'
          : '最多 500 字。顾客和有权限的门店人员可在订单详情中读取，请避免填写内部或敏感信息。',
        initialValue: cancelDraft,
        maxLength: 500,
        onConfirm: value => { cancelReason = value; },
      } : undefined,
    }, cancelling ? () => {
      setCancelDraft(cancelReason);
      onDirtyChange(true);
    } : undefined);
  }
  function openEntry(kind: EntryEditor['kind'], entry?: SettlementEntry) {
    if (!booking || !settlements || dirty || blocked || lock.current || !current()) return;
    if (kind === 'RECEIPT' && !settlements.allowedActions.recordReceipt || kind === 'REFUND' && !settlements.allowedActions.recordRefund || kind === 'REVERSAL' && (!entry?.canReverse || !settlements.entries.some(row => row.id === entry.id && row.canReverse))) return;
    try { setOccurred(localReservationTime(new Date().toISOString(), timezone)); }
    catch { setError('预约时区无效，请先修正时区再登记发生时间。'); return; }
    setEditor({ kind, entry, key: crypto.randomUUID(), attempted: false });
    setAmount(((kind === 'REFUND' ? settlements.netPaidCents : kind === 'REVERSAL' ? entry!.amountCents : settlements.amountDueCents) / 100).toFixed(2));
    setMethod('CASH'); setReason(''); setError(''); setNotice('');
  }
  async function closeEntry() {
    if (!editor || blocked) return;
    const ticket = begin(); if (!ticket) return;
    try {
      if (!await confirm({ title: editor.attempted ? '重新核对流水' : '放弃本次登记', message: editor.attempted ? '将关闭当前登记并重新读取服务端流水。请先核对原操作是否已记录，再开始新登记。' : '当前填写尚未提交，是否放弃？', confirmLabel: editor.attempted ? '重新核对' : '放弃填写' }) || !ticket.valid() || !liveView()) return;
      const attempted = editor.attempted; setEditor(null); if (attempted) setReload(value => value + 1);
    } finally { finish(ticket); }
  }
  async function submitEntry(event: React.FormEvent) {
    event.preventDefault(); if (!booking || !settlements || !editor || blocked || lock.current || !current()) return;
    const trimmed = reason.trim();
    try {
      if (trimmed.length < 5 || trimmed.length > 500) throw new Error('请填写 5–500 字的真实原因。');
      const cents = editor.kind === 'REVERSAL' ? editor.entry!.amountCents : settlementAmountCents(amount);
      if (editor.kind === 'RECEIPT' && cents > settlements.amountDueCents) throw new Error('登记金额不能超过当前服务端剩余应收。');
      if (editor.kind === 'REFUND' && cents !== settlements.netPaidCents) throw new Error('本次须登记当前剩余净实收的全额退款，请重新加载核对金额。');
      const occurredAt = editor.kind === 'REVERSAL' ? undefined : reservationUtc(occurred, timezone);
      if (occurredAt && (+new Date(occurredAt) < Date.now() - 31 * 86400000 || +new Date(occurredAt) > Date.now() + 5 * 60000)) throw new Error('发生时间须在过去 31 天内，且不能晚于当前时间 5 分钟。');
      const message = editor.kind === 'REVERSAL' ? `冲正原收款 ${money(cents, settlements.currency)}，仅纠正账目，不会把钱退给顾客。真实退款请使用“已实际退还款项登记”。` : editor.kind === 'REFUND' ? `请确认已通过${methodLabels[method]}实际退还 ${money(cents, settlements.currency)}。系统只记录事实，不会发送退款或银行转账。` : `请确认已通过${methodLabels[method]}实际收到 ${money(cents, settlements.currency)}。系统只登记实收，不会向顾客扣款或发起银行转账。`;
      const payload = { requestKey: editor.key, amountCents: cents, method, occurredAt: occurredAt!, reason: trimmed };
      await run(key => editor.kind === 'REVERSAL' ? reverseOfflineReceipt(booking.id, editor.entry!.id, { requestKey: editor.key, reason: trimmed }, key) : editor.kind === 'REFUND' ? recordOfflineRefund(booking.id, payload, key) : recordOfflineReceipt(booking.id, payload, key), `OFFLINE:${editor.kind}`, entryLabels[editor.kind] + '已保存，并已核对最新余额。', value => {
        const receipt = value as BookingSettlements;
        if (String(receipt.bookingId) !== bookingId || String(receipt.shopId) !== String(settlements.shopId)) throw new Error('账本回执与当前订单所属门店不匹配。');
      }, { title: entryLabels[editor.kind], message, confirmLabel: editor.kind === 'REFUND' ? '已实际退还，确认登记' : editor.kind === 'REVERSAL' ? '确认账目冲正' : '已实际收到，确认登记', tone: editor.kind === 'RECEIPT' ? 'primary' : 'danger' }, () => setEditor(value => value ? { ...value, attempted: true } : value));
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : '登记内容无效'); }
  }
  function refreshOrder() {
    if (loading || saving || frozen || dirty || lock.current || !current() || !liveView()) return;
    setReload(value => value + 1);
  }
  return <section aria-label="预约明细与经营操作" className="mx-5 mb-6 rounded-xl border border-[#E5EAF0] bg-[#F5F7FA] p-4 sm:mx-6 sm:p-5">
    <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-[#287C7C]" />订单与预约</h3><button type="button" aria-label="刷新订单及预约详情" title={dirty ? '请先保存或放弃当前编辑' : '读取最新订单与预约状态'} disabled={loading || saving || frozen || dirty} onClick={refreshOrder} className="flex items-center gap-1.5 p-2 text-sm text-[#287C7C] disabled:opacity-40"><RefreshCw className="h-4 w-4" />{needsRefresh && '刷新订单'}</button></div>
    {loading ? <p className="mt-3 text-sm text-slate-500">正在读取最新订单与预约资料…</p> : booking && settlements && <><BookingReceptionDetails booking={booking} /><div className="mt-3"><BookingOrderEmailStatus key={`${booking.id}:${booking.status}:${booking.startTime}`} bookingId={booking.id} apiRequest={orderEmailRequest} scopeKey={String(user?.id ?? '')} revision={reload} /></div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center gap-2"><Wallet className="h-4 w-4 text-[#48A1A1]" /><h4 className="text-sm font-semibold text-slate-800">{simpleOffline ? '预约订单 · 线下处理' : modeLabels[settlements.paymentMode]}</h4><span className="text-xs text-slate-500">{bookingStatusLabels[settlements.status] ?? '预约状态待核对'}{!simpleOffline && <> · {paymentStatusLabels[settlements.paymentStatus] ?? '支付状态待核对'}</>}</span></div><dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">{(simpleOffline ? [['订单总额', settlements.totalCents]] : [['应付金额', settlements.totalCents], ['累计实收', settlements.paidCents], ['已实际退款', settlements.refundedCents], ['当前净实收', settlements.netPaidCents], ['剩余应收', settlements.amountDueCents]]).map(([label, value]) => <div key={String(label)}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-800">{money(Number(value), settlements.currency)}</dd></div>)}</dl>
        {!simpleOffline && <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">{[['服务原价', booking.priceCents], ['优惠抵扣', booking.discountCents], ['平台服务费', booking.platformFeeCents], ['小费（独立金额）', booking.tipCents]].map(([label, cents]) => <div key={String(label)}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-800">{money(typeof cents === 'number' ? cents : undefined, booking.currency)}</dd></div>)}</dl>}<BookingSettlementGuidance settlements={{ ...booking, ...settlements }} />
        <details className="mt-3"><summary className="cursor-pointer text-xs text-slate-600">可选线下账本 · 仅登记已实际发生的收退</summary><div className="mt-3 flex flex-wrap gap-2">{settlements.allowedActions.recordReceipt && <button type="button" disabled={blocked || dirty} className={primary} onClick={() => openEntry('RECEIPT')}>登记已收到款项</button>}{settlements.allowedActions.recordRefund && <button type="button" disabled={blocked || dirty} className={secondary} onClick={() => openEntry('REFUND')}>登记已实际退还款项</button>}</div></details>
      </div>
      {editor && <form onSubmit={submitEntry} className="mt-4 space-y-4 rounded-xl border border-teal-200 bg-white p-4"><h4 className="text-sm font-semibold text-slate-800">{entryLabels[editor.kind]}</h4><p className="text-xs leading-6 text-slate-500">{editor.kind === 'REVERSAL' ? '整条冲正错误登记，不是实际退款。原记录和关联冲正都会保留。' : editor.kind === 'REFUND' ? '仅记录已实际退回的当前全部净实收。此操作不会调用外部退款渠道。' : '请在实际收到款项后登记，支持部分收款。请勿将支付意向记为实收。'}</p><fieldset disabled={blocked} className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs text-slate-600"><span>金额（{settlements.currency.toUpperCase()}）</span><input required inputMode="decimal" value={amount} readOnly={editor.kind !== 'RECEIPT'} onChange={e => edit(() => setAmount(e.target.value))} className={inputClass} /></label>{editor.kind !== 'REVERSAL' && <><label className="space-y-1 text-xs text-slate-600"><span>{editor.kind === 'REFUND' ? '实际退款方式' : '实际收款方式'}</span><select value={method} onChange={e => edit(() => setMethod(e.target.value as OfflineMethod))} className={inputClass}>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="space-y-1 text-xs text-slate-600 sm:col-span-2"><span>实际发生时间（{timezone}）</span><input required type="datetime-local" step="60" value={occurred} onChange={e => edit(() => setOccurred(e.target.value))} className={inputClass} /><span className="block leading-5">过去31天内，保存为UTC；夏令时中不存在或重复的分钟不接受。</span></label></>}<label className="space-y-1 text-xs text-slate-600 sm:col-span-2"><span>真实原因（5–500字）</span><textarea required minLength={5} maxLength={500} rows={3} value={reason} onChange={e => edit(() => setReason(e.target.value))} className={inputClass} /></label></fieldset><div className="flex flex-wrap gap-2"><button type="submit" disabled={blocked} className={primary}>{saving ? '正在登记…' : '核对并确认登记'}</button><button type="button" disabled={blocked} onClick={() => void closeEntry()} className={secondary}>{editor.attempted ? '关闭并重新核对流水' : '放弃填写'}</button></div></form>}
      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-medium text-slate-700">线下与零额结算流水（{settlements.entries.length}）</summary>{settlements.entries.length ? <ul className="mt-3 divide-y divide-slate-100">{settlements.entries.map(entry => <li key={entry.id} className="space-y-1 py-3 text-xs leading-6 text-slate-600"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{entryLabels[entry.kind]} · {money(entry.amountCents, settlements.currency)}</p>{entry.canReverse && <button type="button" disabled={blocked || dirty} onClick={() => openEntry('REVERSAL', entry)} className="rounded-lg px-3 py-2 text-sm text-red-700 disabled:opacity-40">冲正错误收款</button>}</div><p>{entry.method ? methodLabels[entry.method] : '无外部资金流转'} · {occurredLabel(entry.occurredAt, timezone)}</p><p className="break-all">记录 #{entry.id}{entry.referenceEntryId ? ` · 关联原记录 #${entry.referenceEntryId}` : ''}</p><p className="whitespace-pre-wrap break-words">{entry.reason}</p></li>)}</ul> : <p className="mt-3 text-xs text-slate-500">暂无线下或零额结算凭证。在线付款不在此冒充线下流水。</p>}</details>
      {!!booking.addOns?.length&&<section className="mt-4 rounded-xl border border-teal-100 bg-teal-50/40 p-4"><h4 className="text-sm font-semibold text-slate-800">附加项目（服务端快照）</h4><p className="mt-1 text-xs text-slate-600">主服务 {money(booking.mainSubtotalCents,booking.currency)} · 附加项目 {money(booking.addOnSubtotalCents,booking.currency)}；不增加时长，使用下单时已保存的价格。</p><ul className="mt-2 space-y-2">{booking.addOns.map(row=><li key={row.id} className="text-sm text-slate-700">参与者 {row.participantIndex} · 主服务第 {row.sequence} 段 · {row.name} · {money(row.lineTotalCents,row.currency)}</li>)}</ul></section>}
      {booking.items.length ? <section className="mt-4"><h4 className="text-sm font-semibold text-slate-800">全部服务段（服务端快照）</h4><p className="mt-2 text-xs text-slate-500"><ServiceDurationLabel total kind={booking.durationKind} minutes={booking.reservedDurationMin ?? booking.durationMin!} /></p><ul className="mt-3 space-y-2">{sortedBookingSegments(booking.items).map(item => <li key={item.id} className="rounded-lg border border-slate-100 bg-white p-3 text-sm leading-6 text-slate-700"><p className="font-medium">参与者 {item.participantIndex} · 第 {item.sequence ?? '未提供'} 段 · {bookingItemServiceLabel(item)}</p><p className="text-xs text-slate-500"><ServiceDurationLabel kind={item.durationKind} minutes={item.reservedDurationMin ?? item.durationMin} /></p><p className="mt-1 break-words text-xs text-slate-600">{bookingSegmentTime(item, booking.timezone)}</p><p className="text-xs text-slate-600">本段账单金额 {money(item.priceCentsSnapshot, item.currency ?? booking.currency)} · 原始报价 {money(item.quotedUnitPriceCents, item.currency ?? booking.currency)}（{item.priceBasisSnapshot === 'PER_BOOKING' ? '整单价，本段按服务端分摊' : item.priceBasisSnapshot === 'PER_PERSON' ? '每人价' : '价格口径快照未提供'}）</p><BookingResourceNames item={item} booking={booking} /></li>)}</ul></section> : <p className="mt-3 text-xs leading-6 text-slate-500">历史预约尚无逐人资源明细，系统保留原占用约束。</p>}
      <p className="mt-3 text-xs leading-6 text-slate-500">预约时区：{booking.timezone ?? '未配置，发生时间按UTC填写'}。</p>
      <OrderHoldNotice key={'hold:' + booking.id} holdExpiresAt={booking.holdExpiresAt} settlements={settlements} formatDeadline={value => occurredLabel(value, timezone)} />
      <div className="mt-4 flex flex-wrap gap-2">{settlements.allowedActions.confirm && <button type="button" disabled={blocked || dirty} onClick={() => void transition('CONFIRMED')} className={primary}>{settlements.paymentMode === 'PAY_AT_STORE' ? '确认订单预约' : '确认预约'}</button>}{settlements.allowedActions.complete && <button type="button" disabled={blocked || dirty} onClick={() => void transition('COMPLETED')} className={primary}>确认完成服务</button>}{settlements.allowedActions.cancel && <button type="button" disabled={blocked || dirty} onClick={() => void transition('CANCELLED')} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-700 disabled:opacity-40">取消预约</button>}</div>
      {canMove && !editor && <form onSubmit={save} className="mt-4 space-y-3 border-t border-slate-200 pt-4"><p className="text-xs leading-5 text-slate-500">时段按本订单所有服务段的历史快照读取，原订单金额、项目类型、预约预留块和资源策略保持不变；冲突保留原预约。组合行程整体平移，各段技师按原资源策略重新核验。</p>{slotsError && <p role="alert" className="text-xs leading-6 text-red-700">{slotsError}<button type="button" disabled={blocked || slotsLoading} className="ml-2 underline" onClick={() => edit(() => setSlotsReload(value => value + 1))}>重试读取时段</button></p>}{slotPage?.date === date && !slotPage.slots.some(slot => slot.available) && <p className="text-xs text-slate-500">该日期没有能容纳完整行程的可用起点，请选择其他日期。</p>}<div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs text-slate-600"><span>新预约日期</span><input required type="date" disabled={blocked} value={date} onChange={e => edit(() => { setDate(e.target.value); setTime(''); })} className={inputClass} /></label><label className="space-y-1 text-xs text-slate-600"><span>新开始时间</span><select required disabled={blocked || slotsLoading || !slotPage} value={time} onChange={e => edit(() => setTime(e.target.value))} className={inputClass}><option value="">{slotsLoading ? '正在读取预约快照时段…' : '请选择可用起点'}</option>{slotPage?.date === date && slotPage.slots.map(slot => <option key={slot.time} value={slot.time} disabled={!slot.available}>{slot.time}{slot.available ? '' : ' · 不可用'}</option>)}</select></label></div><div className="flex gap-2"><button type="submit" disabled={blocked || !timeDirty || !validMoveTime} className={primary}>{saving ? '正在改期…' : '保存改期'}</button>{timeDirty && <button type="button" disabled={blocked} className={secondary} onClick={() => edit(() => { setDate(booking.localDate ?? ''); setTime(booking.localStartTime ?? ''); })}>还原时间</button>}</div></form>}
    </>}
    {hasCancelDraft && !saving && !frozen && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      {needsRefresh ? <>
        <p>已保留取消原因。请刷新订单并核对当前状态。</p>
        <p className="basis-full whitespace-pre-wrap break-words">{cancelDraft}</p>
      </> : <>
        <p>已保留取消原因，可再次尝试取消预约。</p>
        <button type="button" className={secondary} onClick={() => edit(() => setCancelDraft(''))}>清除取消原因草稿</button>
      </>}
    </div>}
    {frozen && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p>提交结果未确认。本订单暂时只读；仅刷新订单不能证明原请求已结束。核对原操作结果后，系统会保留已执行结果，或使尚未执行的旧请求失效，再核对最新订单。</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={saving || loading} onClick={() => void reconcile()} className={secondary}>只读核对订单及流水</button>{pendingOrderOperation(orderKey)?.actorId === actor && <button type="button" disabled={saving || loading} onClick={() => void resolveOperation()} className={secondary}>核对原操作结果</button>}</div>{pendingOrderOperation(orderKey) === null ? <p className="mt-2 text-xs">此为旧版无操作编号记录，暂不能自动解除只读，请联系管理员核对。</p> : pendingOrderOperation(orderKey)?.actorId !== actor && <p className="mt-2 text-xs">请使用提交原操作的管理员账号核对结果；切换账号不会解除原操作保护。</p>}</div>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-teal-700">{notice}</p>}
  </section>;
}
