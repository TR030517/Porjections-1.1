import { displayLabel } from '../../utils/displayLabels';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { createAssistedBooking, getAssistedBookingServices, quoteAssistedBooking, searchAssistedCustomers, type AssistedBookingInput, type AssistedBookingQuote, type AssistedBookingService, type AssistedBookingSlots, type AssistedCustomer, type Booking, type BookingListFilters } from '../../api/merchant';
import { getBookingTherapists, getGuestBookingSlots, normalizeGuestContact, type BookingTherapist, type GuestBookingReceipt } from '../../api/bookings';
import { currentShopAllows, isCurrentShop, useShopId } from '../../hooks/useShopId';
import PageHeader from '../../components/PageHeader';
import BookingDetails, { BookingDetailsDrawer, bookingTime } from '../../components/BookingDetails';
import { money } from '../../utils/feedback';
import { useAuthStore } from '../../stores/authStore';
import { createBookingPageModel } from './model';
import BookingCalendar from './BookingCalendar';
import type { CalendarAssistedSelection } from './CalendarActionsPanel';
import { validDate } from './calendarModel';
import GuestAssistedBookingModal from './GuestAssistedBookingModal';
import { guestRecoveryKey } from './guestBookingModel';

const statuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'];
const paymentStatuses = ['UNPAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const paymentModes = [{ value: 'ONLINE', label: '在线预付' }, { value: 'PAY_AT_STORE', label: '到店付款' }, { value: 'ZERO', label: '零金额' }];
export default function BookingsPage() {
  const actorId = useAuthStore(state => state.merchant?.id);
  const { shopId, loading, can } = useShopId();
  if (!shopId) return <div className="merchant-page"><PageHeader title="预约订单" description="查看本店预约订单，款项与客人线下处理；历史账务仍可核对。" /><Card loading={loading}><Empty description={loading ? '正在加载授权门店…' : '请选择已授权门店。'} /></Card></div>;
  return <ShopBookings key={`${actorId}:${shopId}`} shopId={shopId} canManage={can('BOOKINGS_MANAGE')} />;
}

function ShopBookings({ shopId, canManage }: { shopId: string; canManage: boolean }) {
  const actorId = useAuthStore(state => state.merchant?.id);
  const navigate = useNavigate(), { can, shop } = useShopId();
  const model = useMemo(() => createBookingPageModel(shopId, () => actorId === useAuthStore.getState().merchant?.id && currentShopAllows(shopId, 'BOOKINGS_READ')), [actorId, shopId]);
  const { query, data, loading, error } = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [draft, setDraft] = useState<BookingListFilters>({});
  const [filterError, setFilterError] = useState('');
  const [workspace, setWorkspace] = useState<'calendar' | 'history'>('calendar');
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [createdReceipt, setCreatedReceipt] = useState<GuestBookingReceipt>();
  const [selected, setSelected] = useState<{ id: string; generation: number; calendar?: boolean }>();
  const selectedRef = useRef<typeof selected>(undefined), selectionGeneration = useRef(0);
  const calendarLockRef = useRef(false);
  const assistedActiveRef = useRef(false), assistedGeneration = useRef(0), activeAssistedGeneration = assistedGeneration.current;
  const openDetails = (id: string, calendar = false) => {
    if (selectedRef.current || assistedActiveRef.current || calendarLockRef.current || !isCurrentShop(shopId) || actorId !== useAuthStore.getState().merchant?.id) return;
    const next = { id, generation: ++selectionGeneration.current, calendar };
    selectedRef.current = next; setSelected(next);
  };
  const [assistedOpen, setAssistedOpen] = useState(false), [assistedSelection, setAssistedSelection] = useState<CalendarAssistedSelection>();
  const openAssisted = (selection?: CalendarAssistedSelection) => {
    if (assistedActiveRef.current || selectedRef.current || calendarLockRef.current || actorId !== useAuthStore.getState().merchant?.id || !currentShopAllows(shopId, 'BOOKINGS_MANAGE')) return;
    assistedActiveRef.current = true; assistedGeneration.current++; setAssistedSelection(selection); setAssistedOpen(true);
  };
  useEffect(() => {
    if (!canManage || assistedActiveRef.current) return;
    try { if (sessionStorage.getItem(guestRecoveryKey(String(actorId), shopId)) || sessionStorage.getItem(`massajoy2:assisted-booking:${actorId}:${shopId}`)) { assistedActiveRef.current = true; assistedGeneration.current++; setAssistedOpen(true); } }
    catch { /* Opening either entry still fails closed if recovery storage is unavailable. */ }
  }, [actorId, shopId, canManage]);
  const [calendarLocked, setCalendarLocked] = useState(false);
  const changeCalendarLock = useCallback((locked: boolean) => { calendarLockRef.current = locked; setCalendarLocked(locked); }, []);
  useEffect(() => { if (workspace === 'history') void model.load(); return () => model.dispose(); }, [model, workspace]);
  const apply = () => {
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) { setFilterError('开始日期不可晚于结束日期。'); return; }
    setFilterError('');
    void model.setFilters({ ...draft, search: draft.search?.trim() || undefined });
  };
  const setChoice = (key: 'status' | 'paymentStatus' | 'paymentMode', value?: string) => {
    setDraft(current => ({ ...current, [key]: value }));
    // Status changes apply to the submitted search/date range and always start at page one.
    setFilterError('');
    void model.setFilters({ status: query.status, paymentStatus: query.paymentStatus, paymentMode: query.paymentMode,
      search: query.search, startDate: query.startDate, endDate: query.endDate, [key]: value });
  };
  const DetailShell = selected?.calendar ? BookingDetailsDrawer : BookingDetails;
  const refreshViews = () => { if (calendarLockRef.current) return; if (workspace === 'history') void model.refresh(); setCalendarRevision(value => value + 1); };
  const description = canManage
    ? '查看本店订单与门店当地预约时间，可确认预约、改期或标记服务完成。到店付款由门店与顾客线下处理，历史账务可在详情和筛选中核对。'
    : '查看本店订单、门店当地预约时间和预约状态。可在详情和筛选中核对历史账务。';
  return <div className="merchant-page"><PageHeader title="预约订单" description={description} actions={<Space><Button icon={<ReloadOutlined />} disabled={!!selected || calendarLocked || assistedOpen} loading={workspace === 'history' && loading} onClick={refreshViews}>刷新</Button>{can('SHOP_SETTINGS_MANAGE') && <Button disabled={!!selected || calendarLocked || assistedOpen} onClick={() => { if (actorId === useAuthStore.getState().merchant?.id && currentShopAllows(shopId, 'SHOP_SETTINGS_MANAGE')) navigate(`/settings?shopId=${encodeURIComponent(shopId)}&focus=order-email`); }}>预约通知邮箱</Button>}{canManage && <Button type="primary" disabled={!!selected || calendarLocked || assistedOpen} onClick={() => openAssisted()}>新增预约</Button>}</Space>} />
    {createdReceipt && <Alert showIcon type="success" title={`预约申请已创建：${createdReceipt.result.bookingNo}`} description={'创建时为待接单、到店付款，尚未确认接单，也尚未收款。' + (canManage ? '请打开同一订单核对最新状态并单独确认接单。' : '可打开同一订单核对最新状态。')} action={<Button disabled={!!selected || assistedOpen || calendarLocked} onClick={() => openDetails(createdReceipt.result.bookingId, true)}>查看同一订单</Button>} />}
    <Space wrap><Button type={workspace === 'calendar' ? 'primary' : 'default'} disabled={!!selected || assistedOpen || calendarLocked} onClick={() => setWorkspace('calendar')}>预约日历</Button><Button type={workspace === 'history' ? 'primary' : 'default'} disabled={!!selected || assistedOpen || calendarLocked} onClick={() => setWorkspace('history')}>历史订单与财务列表</Button></Space>
    {workspace === 'calendar' && <BookingCalendar shopId={shopId} shopName={shop?.name ?? '当前门店'} timezone={shop?.timezone} disabled={!!selected || assistedOpen} revision={calendarRevision} onOpenBooking={id => openDetails(id, true)} onActionLockChange={changeCalendarLock} onAssisted={openAssisted} />}
    {workspace === 'history' && <div><Card><form onSubmit={event => { event.preventDefault(); apply(); }}><div className="merchant-filter-bar">
      <Input aria-label="查询门店预约" placeholder="订单编号、顾客或服务" maxLength={100} allowClear disabled={!!selected} value={draft.search ?? ''} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} />
      <Select aria-label="预约状态" disabled={!!selected} allowClear placeholder="全部预约状态" value={query.status} onChange={value => setChoice('status', value)} options={statuses.map(value => ({ value, label: displayLabel(value) }))} />
      <details><summary style={{ cursor: 'pointer', fontSize: 13 }}>历史财务筛选{query.paymentStatus || query.paymentMode ? '（已筛选）' : ''}</summary><Space wrap><Select aria-label="付款状态" disabled={!!selected} allowClear placeholder="全部付款状态" value={query.paymentStatus} onChange={value => setChoice('paymentStatus', value)} options={paymentStatuses.map(value => ({ value, label: displayLabel(value) }))} />
      <Select aria-label="付款方式" disabled={!!selected} allowClear placeholder="全部付款方式" value={query.paymentMode} onChange={value => setChoice('paymentMode', value)} options={paymentModes} /></Space></details>
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>预约开始日期<Input aria-label="预约开始日期" type="date" disabled={!!selected} value={draft.startDate ?? ''} onChange={event => setDraft(current => ({ ...current, startDate: event.target.value || undefined }))} /></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>预约结束日期<Input aria-label="预约结束日期" type="date" disabled={!!selected} value={draft.endDate ?? ''} onChange={event => setDraft(current => ({ ...current, endDate: event.target.value || undefined }))} /></label>
      <Button htmlType="submit" type="primary" disabled={!!selected} icon={<SearchOutlined />}>查询</Button>
      <Button disabled={!!selected} onClick={() => { setDraft({}); setFilterError(''); void model.setFilters({}); }}>重置</Button>
    </div></form>{filterError && <Alert type="error" showIcon title={filterError} style={{ marginTop: 12 }} />}</Card>
    {error && <Alert type="error" showIcon title={error} />}
    <Table<Booking> rowKey="id" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 1450 }} pagination={{
      current: query.page, pageSize: query.pageSize, total: data?.total ?? 0, disabled: !!selected || loading,
      showSizeChanger: true, pageSizeOptions: [25, 50, 100], showTotal: total => `${total}条匹配预约`,
      onChange: (page, pageSize) => void model.setPage(page, pageSize),
    }} columns={[
      { title: '预约', dataIndex: 'bookingNo', render: (value, row) => <Button type="link" disabled={!!selected} onClick={() => openDetails(row.id)}>{value || `#${row.id}`}</Button> },
      { title: '预约联系人', dataIndex: 'customerName', render: (value, row) => <div>{value}<div style={{ fontSize: 12, color: '#64748b' }}>{row.contact && typeof row.contact === 'object' && 'recorded' in row.contact && row.contact.recorded === true ? '下单时记录' : '历史订单未记录当次联系人'}</div></div> }, { title: '服务／规格', dataIndex: 'service', width: 300, render: value => <div style={{ minWidth: 220, maxWidth: 320, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{value}</div> },
      { title: '门店当地预约时间', render: (_, row) => bookingTime(row), width: 300 },
      { title: '订单总额', render: (_, row) => money(row.totalCents, row.currency) }, { title: '实收记录', render: (_, row) => money(row.paidCents, row.currency) }, { title: '退款记录', render: (_, row) => money(row.refundedCents, row.currency) },
      { title: '状态', render: (_, row) => <Space direction="vertical" size={4}><Tag>{displayLabel(row.status)}</Tag><Tag>{displayLabel(row.paymentStatus)}</Tag></Space> },
      { title: '操作', render: (_, row) => <Button disabled={!!selected} onClick={() => openDetails(row.id)}>查看详情</Button> },
    ]} /></div>}
    {selected && <DetailShell key={selected.generation} id={selected.id} shopId={shopId} onClose={() => {
      if (selectedRef.current !== selected || actorId !== useAuthStore.getState().merchant?.id || !isCurrentShop(shopId)) return;
      selectedRef.current = undefined; setSelected(undefined);
    }} onUpdated={() => { if (selectedRef.current === selected && actorId === useAuthStore.getState().merchant?.id && isCurrentShop(shopId)) refreshViews(); }} />}
    {assistedOpen && <AssistedBookingModal key={`${actorId}:${shopId}:${activeAssistedGeneration}`} shopId={shopId} shopName={shop?.name} initialSelection={assistedSelection} initialTimezone={shop?.timezone ?? undefined} onClose={() => {
      if (!assistedActiveRef.current || assistedGeneration.current !== activeAssistedGeneration || actorId !== useAuthStore.getState().merchant?.id || !isCurrentShop(shopId)) return;
      assistedActiveRef.current = false; setAssistedOpen(false);
    }} onCreated={(receipt, showDetails = true) => {
      if (!assistedActiveRef.current || assistedGeneration.current !== activeAssistedGeneration || actorId !== useAuthStore.getState().merchant?.id || !currentShopAllows(shopId, 'BOOKINGS_MANAGE')) return;
      assistedActiveRef.current = false; setAssistedOpen(false); refreshViews(); if (receipt) { setCreatedReceipt(receipt); if (showDetails) openDetails(receipt.result.bookingId, true); }
    }} />}
  </div>;
}

export function AssistedBookingModal({ shopId, shopName, onClose, onCreated, initialSelection, initialTimezone }: { shopId: string; shopName?: string; onClose: () => void; onCreated: (receipt?: GuestBookingReceipt, showDetails?: boolean) => void; initialSelection?: CalendarAssistedSelection; initialTimezone?: string }) {
  const actorId = useAuthStore(state => String(state.merchant?.id ?? ''));
  const storageKey = `massajoy2:assisted-booking:${actorId}:${shopId}`;
  const [guestMode, setGuestMode] = useState(() => { try { return !!sessionStorage.getItem(guestRecoveryKey(actorId, shopId)) && !sessionStorage.getItem(storageKey); } catch { return false; } });
  const [recoveryCorrupt, setRecoveryCorrupt] = useState(false);
  const [services, setServices] = useState<AssistedBookingService[]>([]), [customers, setCustomers] = useState<AssistedCustomer[]>([]);
  const [therapists, setTherapists] = useState<BookingTherapist[]>([]), [preferredIds, setPreferredIds] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState(''), [serviceId, setServiceId] = useState(''), [variantId, setVariantId] = useState('');
  const [contactName, setContactName] = useState(''), [contactPhone, setContactPhone] = useState(''), [contactEmail, setContactEmail] = useState('');
  const [search, setSearch] = useState(''), [date, setDate] = useState(() => initialSelection && validDate(initialSelection.date) ? initialSelection.date : ''), [startTime, setStartTime] = useState(''), [notes, setNotes] = useState('');
  const [prefillNotice, setPrefillNotice] = useState('');
  const preferredTime = useRef(initialSelection?.startTime);
  const [quote, setQuote] = useState<AssistedBookingQuote | null>(null), [slots, setSlots] = useState<AssistedBookingSlots | null>(null), [busy, setBusy] = useState(false), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const requestKey = useRef('');
  const [pendingAttempt, setPendingAttempt] = useState<(AssistedBookingInput & { requestKey: string; quoteHash: string; quoteExpiresAt: string }) | null>(null);
  const customerSearchRevision = useRef(0);
  const alive = useRef(false), generation = useRef(0), busyRef = useRef(false);
  const pendingRef = useRef(pendingAttempt); pendingRef.current = pendingAttempt;
  const liveQuote = useRef<{ value: AssistedBookingQuote; fingerprint: string } | null>(null);
  const current = () => alive.current && String(useAuthStore.getState().merchant?.id ?? '') === actorId && isCurrentShop(shopId);
  const canWrite = () => current() && currentShopAllows(shopId, 'BOOKINGS_MANAGE');
  useEffect(() => { alive.current = true; generation.current++; return () => { alive.current = false; generation.current++; customerSearchRevision.current++; }; }, []);
  const invalidateQuote = () => { liveQuote.current = null; setQuote(null); requestKey.current = ''; };
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) { setPendingAttempt(null); return; }
      const saved = JSON.parse(raw);
      const request = saved?.request;
      if (saved?.actorId !== actorId || saved?.shopId !== shopId || !/^[1-9]\d*$/.test(String(request?.customerId))
        || !/^[1-9]\d*$/.test(String(request?.serviceId)) || !/^\d{4}-\d{2}-\d{2}$/.test(request?.date)
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(request?.startTime) || !/^assisted:[\w-]{20,80}$/.test(request?.requestKey)
        || !/^[a-f0-9]{64}$/.test(request?.quoteHash) || typeof request?.quoteExpiresAt !== 'string') {
        setRecoveryCorrupt(true); setError('老客预约恢复标记损坏。为防止重复下单，已停止创建；请由管理员核对并恢复原请求标记。'); return;
      }
      if (request.contact !== undefined) {
        const contact = normalizeGuestContact(request.contact);
        if (!contact.email || Object.keys(request.contact).some(key => !['name', 'phone', 'email'].includes(key))) throw new Error('Invalid original contact');
      }
      requestKey.current = request.requestKey;
      pendingRef.current = request;
      setPendingAttempt(request);
      setQuote(null);
    } catch {
      setRecoveryCorrupt(true);
      setError('无法恢复上一次代客预约请求。请先检查本店预约订单，再决定是否重新创建。');
    }
  }, [actorId, shopId, storageKey]);
  useEffect(() => {
    const abort = new AbortController(), version = generation.current;
    void getAssistedBookingServices(shopId, abort.signal).then(result => {
      if (!abort.signal.aborted && current() && version === generation.current) setServices(result);
    }).catch(e => { if (!abort.signal.aborted && current() && version === generation.current) setError(e instanceof Error ? e.message : '无法加载本店可预约项目。'); });
    return () => abort.abort();
  }, [shopId, actorId]);
  const service = services.find(row => row.id === serviceId);
  const activeVariants = service?.variants ?? [];
  useEffect(() => {
    if (!serviceId || guestMode || pendingRef.current || recoveryCorrupt || !canWrite()) return;
    const abort = new AbortController();
    void getBookingTherapists(shopId, abort.signal).then(result => { if (!abort.signal.aborted && canWrite()) setTherapists(result); })
      .catch(reason => { if (!abort.signal.aborted && current()) setError(reason instanceof Error ? reason.message : '无法读取可选技师。'); });
    return () => abort.abort();
  }, [shopId, serviceId, guestMode, recoveryCorrupt, pendingAttempt]);
  useEffect(() => {
    if (guestMode || pendingRef.current || recoveryCorrupt) return;
    setSlots(null); setStartTime(''); invalidateQuote();
    setError('');
    if (!serviceId || !date || activeVariants.length > 0 && !variantId) return;
    const abort = new AbortController(), version = generation.current;
    void getGuestBookingSlots(shopId, { serviceId, date, variantId: variantId || undefined, preferredTherapistIds: preferredIds }, abort.signal)
      .then(result => {
        if (abort.signal.aborted || !current() || version !== generation.current) return;
        setSlots(result);
        // The calendar is only a preference. Select its time only after the
        // latest service/variant slots approve it in the same shop timezone.
        const preferred = preferredTime.current;
        if (preferred && date === initialSelection?.date) {
          preferredTime.current = undefined;
          if (canWrite() && (!initialTimezone || result.timezone === initialTimezone) && result.slots.some(slot => slot.available && slot.time === preferred)) { setStartTime(preferred); setPrefillNotice('已按最新可用时段带入日历所选时间；提交前仍需服务器核价。'); }
          else setPrefillNotice('日历所选时间目前不可用或门店时区已变化，请从最新时段中重新选择。');
        }
      })
      .catch(e => { if (!abort.signal.aborted && current() && version === generation.current) setError(e instanceof Error ? e.message : '无法加载可预约时段。'); });
    return () => abort.abort();
  }, [shopId, serviceId, variantId, date, activeVariants.length, preferredIds.join(','), guestMode, recoveryCorrupt, pendingAttempt]);
  const baseInput = (): AssistedBookingInput => ({ customerId, contact: { name: contactName, phone: contactPhone, email: contactEmail }, serviceId, ...(variantId ? { variantId } : {}), date, startTime, ...(preferredIds.length ? { preferredTherapistIds: preferredIds } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
  const reviewedInput = (input: AssistedBookingInput): AssistedBookingInput => {
    if (!input.contact?.email) throw new Error('请选择本店已验证邮箱客户并核对本次联系人。');
    const contact = normalizeGuestContact(input.contact);
    if (!contact.email) throw new Error('本次预约必须使用所选客户已验证的账号邮箱。');
    return { ...input, contact: { ...contact, email: contact.email } };
  };
  const committedReceipt = (booking: { id: string; bookingNo: string }, key: string): GuestBookingReceipt => ({ shopId, requestKey: key, outcome: 'COMMITTED', result: { bookingId: String(booking.id), bookingNo: booking.bookingNo } });
  const restoreExpiredAttempt = (error: unknown, original: NonNullable<typeof pendingAttempt>) => {
    const response = (error as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
    const proof = response?.data;
    // This proves only this exact expired quote cannot execute. It is not a
    // permanent fence for arbitrary commands reusing the same request key.
    if (response?.status !== 409 || proof?.code !== 'ASSISTED_QUOTE_EXPIRED_NOT_EXECUTED'
      || proof.shopId !== shopId || proof.requestKey !== original.requestKey || proof.quoteExpiresAt !== original.quoteExpiresAt
      || pendingRef.current !== original || !canWrite()) return false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (saved?.actorId !== actorId || saved?.shopId !== shopId || JSON.stringify(saved.request) !== JSON.stringify(original)) return false;
      sessionStorage.removeItem(storageKey);
    } catch { return false; }
    customerSearchRevision.current++; setSearching(false); preferredTime.current = undefined;
    setCustomers(original.contact ? [{ id: original.customerId, ...original.contact }] : []);
    setCustomerId(original.contact ? original.customerId : ''); setSearch('');
    setContactName(original.contact?.name ?? ''); setContactPhone(original.contact?.phone ?? ''); setContactEmail(original.contact?.email ?? '');
    setServiceId(original.serviceId); setVariantId(original.variantId ?? ''); setDate(original.date);
    setPreferredIds(original.preferredTherapistIds ?? []); setNotes(original.notes ?? '');
    setStartTime(''); setSlots(null); invalidateQuote();
    pendingRef.current = null; setPendingAttempt(null); setError('');
    setPrefillNotice('服务器已确认这次过期请求没有生成订单，原预约资料已恢复。请重新选择最新可用时段并核价；不会自动提交预约。');
    return true;
  };
  const liveInput = useRef<AssistedBookingInput>(baseInput()); liveInput.current = baseInput();
  const findCustomers = async () => {
    if (busyRef.current || pendingRef.current || recoveryCorrupt || guestMode || !canWrite()) return;
    const term = search.trim(), revision = ++customerSearchRevision.current;
    if (term.length < 2) { setError('请输入至少2个字符查找本店历史客户。'); return; }
    setSearching(true); setError('');
    try {
      const result = await searchAssistedCustomers(shopId, term);
      if (current() && revision === customerSearchRevision.current) setCustomers(result);
    } catch (e) {
      if (current() && revision === customerSearchRevision.current) setError(e instanceof Error ? e.message : '客户查询失败。');
    } finally { if (current() && revision === customerSearchRevision.current) setSearching(false); }
  };
  const makeQuote = async () => {
    if (busyRef.current || pendingRef.current || recoveryCorrupt || guestMode || !canWrite()) return;
    busyRef.current = true;
    const version = generation.current;
    invalidateQuote(); setBusy(true); setError('');
    try {
      const fingerprint = JSON.stringify(liveInput.current), input = reviewedInput(liveInput.current);
      if (!input.customerId || !input.serviceId || !input.date || !input.startTime) throw new Error('请选择客户、项目、日期和时间。');
      requestKey.current = '';
      const result = await quoteAssistedBooking(shopId, input);
      if (!current() || version !== generation.current) return;
      if (!canWrite()) { setError('当前门店预约管理权限已改变，请刷新权限后重新核价。'); return; }
      if (fingerprint !== JSON.stringify(liveInput.current)) { setError('预约信息在核价期间发生变化，请重新核对。'); return; }
      liveQuote.current = { value: result, fingerprint };
      setQuote(result);
    } catch (e) { if (current() && version === generation.current) setError(e instanceof Error ? e.message : '报价失败。'); }
    finally { if (current() && version === generation.current) { busyRef.current = false; setBusy(false); } }
  };
  const create = async (retry = false) => {
    if (busyRef.current || recoveryCorrupt || guestMode || !current()) return;
    if (!canWrite()) { setError('当前门店预约管理权限已改变，请刷新权限后再操作。'); return; }
    const version = generation.current;
    if (retry && pendingRef.current) {
      const original = pendingRef.current;
      busyRef.current = true; setBusy(true); setError('');
      try {
        const booking = await createAssistedBooking(shopId, original);
        if (!current() || version !== generation.current) return;
        sessionStorage.removeItem(storageKey); pendingRef.current = null; setPendingAttempt(null); onCreated(committedReceipt(booking, original.requestKey));
      }
      catch (e) {
        // Authorization and publication checks can reject a retry before the server
        // looks up its original result. A failed retry never resolves that result.
        if (current() && version === generation.current && !restoreExpiredAttempt(e, original)) setError((e instanceof Error ? e.message + ' ' : '') + '原请求结果仍未确认，防重复标记已保留。请返回本店订单核对，或处理当前问题后使用同一请求重试；不要另建第二单。');
      } finally { if (current() && version === generation.current) { busyRef.current = false; setBusy(false); } }
      return;
    }
    if (pendingRef.current || !liveQuote.current) return;
    const checkedQuote = liveQuote.current.value;
    if (liveQuote.current.fingerprint !== JSON.stringify(liveInput.current)) { invalidateQuote(); setError('预约信息已改变，请重新核价。'); return; }
    if (!Number.isFinite(Date.parse(checkedQuote.quoteExpiresAt)) || Date.parse(checkedQuote.quoteExpiresAt) <= Date.now()) { invalidateQuote(); setError('报价已过期，请重新核价。'); return; }
    const key = `assisted:${crypto.randomUUID()}`;
    let input: AssistedBookingInput;
    try { input = reviewedInput(liveInput.current); } catch (error) { invalidateQuote(); setError(error instanceof Error ? error.message : '请核对本次联系人。'); return; }
    const request = { ...input, requestKey: key, quoteHash: checkedQuote.quoteHash, quoteExpiresAt: checkedQuote.quoteExpiresAt };
    try { sessionStorage.setItem(storageKey, JSON.stringify({ actorId, shopId, request })); }
    catch { setError('浏览器无法保存本次请求的防重复标记，尚未发送预约。'); return; }
    requestKey.current = key; pendingRef.current = request; busyRef.current = true; setPendingAttempt(request); setBusy(true); setError('');
    try {
      const booking = await createAssistedBooking(shopId, request);
      if (!current() || version !== generation.current) return;
      sessionStorage.removeItem(storageKey); pendingRef.current = null; setPendingAttempt(null); onCreated(committedReceipt(booking, request.requestKey));
    }
    catch (e) {
      if (!current() || version !== generation.current) return;
      if (restoreExpiredAttempt(e, request)) return;
      setError((e instanceof Error ? e.message + ' ' : '') + '原请求结果仍未确认，防重复标记已保留。请使用同一请求重试，或返回本店订单核对；不要另建第二单。');
    } finally { if (current() && version === generation.current) { busyRef.current = false; setBusy(false); } }
  };
  const locked = busy || pendingAttempt !== null || recoveryCorrupt;
  if (guestMode) return <GuestAssistedBookingModal shopId={shopId} shopName={shopName} initialSelection={initialSelection} initialTimezone={initialTimezone} onClose={onClose} onExisting={() => { if (canWrite() && !pendingRef.current && !recoveryCorrupt) setGuestMode(false); }} onCreated={onCreated} />;
  return <Modal open title="代客新增预约" onCancel={() => { if (!locked) onClose(); }} footer={null} destroyOnHidden width={720} closable={!locked} maskClosable={!locked} keyboard={!locked}>
    <Space wrap style={{ marginBottom: 16 }}><Button type="primary" disabled>选择本店受权老客</Button><Button disabled={locked} onClick={() => { if (canWrite() && !busyRef.current && !pendingRef.current && !recoveryCorrupt) { customerSearchRevision.current++; setSearching(false); invalidateQuote(); setGuestMode(true); } }}>首次电话／到店客</Button></Space>
    <Alert type="info" showIcon title="仅为已有本店预约记录且邮箱已验证的顾客创建订单。" description="请先让顾客在客人端完成邮箱验证；订单以到店付款方式创建，不会在线扣款。" style={{ marginBottom: 16 }} />
    {pendingAttempt && <Alert type="warning" showIcon title="上次请求结果尚未确认" description="请用同一请求重试以查询原结果。期间已锁定客户、项目和时段，不能重新核价或提交另一单。" style={{ marginBottom: 16 }} />}
    {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
    {!pendingAttempt && prefillNotice && <Alert type="info" showIcon title={prefillNotice} style={{ marginBottom: 16 }} />}
    {pendingAttempt ? <Space><Button disabled={busy} onClick={onClose}>返回订单核对</Button><Button type="primary" loading={busy} onClick={() => void create(true)}>使用同一请求重试</Button></Space> : <div style={{ display: 'grid', gap: 14 }}>
      <Space.Compact style={{ width: '100%' }}><Input disabled={locked} placeholder="搜索本店历史客户姓名/邮箱/电话" value={search} onChange={e => { customerSearchRevision.current++; setSearching(false); setCustomers([]); setSearch(e.target.value); }} /><Button disabled={locked || searching || busy} loading={searching} onClick={() => void findCustomers()}>搜索客户</Button></Space.Compact>
      <Select disabled={locked} showSearch optionFilterProp="label" aria-label="选择已验证邮箱客户" value={customerId || undefined} placeholder="选择已验证邮箱客户" options={customers.map(row => ({ value: row.id, label: `${row.name || '未填写姓名'} · ${row.email}${row.phone ? ` · ${row.phone}` : ''}` }))} onChange={value => { const customer = customers.find(row => row.id === value); setCustomerId(value); setContactName(customer?.name ?? ''); setContactPhone(customer?.phone ?? ''); setContactEmail(customer?.email ?? ''); invalidateQuote(); }} />
      <section aria-label="核对本次预约联系人" style={{ display: 'grid', gap: 8 }}>
        <div>本次预约联系人（保存后不随账号资料变化）</div>
        <label>姓名<Input aria-label="本次预约联系人姓名" disabled={locked} maxLength={200} value={contactName} onChange={event => { setContactName(event.target.value); invalidateQuote(); }} /></label>
        <label>国际电话<Input aria-label="本次预约联系人电话" disabled={locked} value={contactPhone} onChange={event => { setContactPhone(event.target.value); invalidateQuote(); }} placeholder="+1 202 555 0123" /></label>
        <label>已验证账号邮箱<Input aria-label="已验证账号邮箱" readOnly value={contactEmail} /></label>
        <div style={{ fontSize: 12, color: '#667085' }}>邮箱来自所选已验证客户账号；需要变更时，请让顾客更新并验证账号邮箱后重新搜索。此处不会创建账号或改动账号资料。</div>
      </section>
      <Select disabled={locked} value={serviceId || undefined} placeholder="选择可预约服务" options={services.map(row => ({ value: row.id, label: `${row.name} · ${row.durationMin}分钟` }))} onChange={value => { setServiceId(value); setVariantId(''); setPreferredIds([]); setTherapists([]); invalidateQuote(); }} />
      {service?.hasVariants ? <Select disabled={locked} value={variantId || undefined} placeholder="选择服务规格" options={activeVariants.map(row => ({ value: row.id, label: `${row.name} · ${row.durationMin}分钟 · ${money(row.priceCents, 'usd')}` }))} onChange={value => { setVariantId(value); invalidateQuote(); }} /> : null}
      <Select mode="multiple" maxCount={2} disabled={locked || !serviceId} aria-label="老客指定技师" placeholder="技师无偏好，由系统分配" value={preferredIds} options={therapists.map(row => ({ value: row.id, label: row.name }))} onChange={value => { if (busyRef.current || pendingRef.current || !canWrite()) return; setPreferredIds(value); invalidateQuote(); }} />
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>预约日期（门店当地）<Input disabled={locked} type="date" value={date} onChange={e => { setDate(e.target.value); invalidateQuote(); }} /></label>
      {slots && <div style={{ fontSize: 12, color: '#667085' }}>门店时区：{slots.timezone} · 服务时长：{slots.durationMin} 分钟</div>}
      <Select disabled={locked || !slots} aria-label="可预约时段" value={startTime || undefined} placeholder={slots ? '选择有空档的时段' : '先选择项目、规格和日期'} loading={!!serviceId && !!date && !slots} options={(slots?.slots ?? []).filter(slot => slot.available).map(slot => ({ value: slot.time, label: slot.time }))} onChange={value => { setStartTime(value); invalidateQuote(); }} />
      <Input.TextArea disabled={locked} rows={2} maxLength={500} placeholder="备注（可选）" value={notes} onChange={e => { setNotes(e.target.value); invalidateQuote(); }} />
      {quote && <Alert type="success" showIcon title={`服务器核价：${money(quote.totalCents, quote.currency)} · 到店付款`} description={`${preferredIds.length ? `指定技师：${preferredIds.map(id => therapists.find(row => row.id === id)?.name ?? `#${id}`).join('、')}。` : '无技师偏好，由系统自动分配。'}创建后仍为待接单预约，需单独确认接单；不会在线扣款。`} />}
      <Space><Button disabled={locked} onClick={onClose}>取消</Button>{quote && <Button disabled={locked} onClick={() => void makeQuote()}>重新核价</Button>}{!quote ? <Button type="primary" loading={busy} disabled={locked || !slots || !startTime || !customerId || !serviceId} onClick={() => void makeQuote()}>核对预约</Button> : <Button type="primary" loading={busy} disabled={locked} onClick={() => void create()}>创建预约申请</Button>}</Space>
    </div>}
  </Modal>;
}
