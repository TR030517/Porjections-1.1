import { durationFieldLabel, durationHelp, readServiceDurationKind, serviceDurationLabel, SERVICE_DURATION_LABELS, type ServiceDurationKind } from '../../../../src/utils/serviceDuration';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { DEFAULT_SHOP_BOOKING_SETTINGS, getReservationConfig, removeResource, saveHours, savePolicy, saveResource, saveShopBookingSettings, saveShopPaymentPolicy, saveTherapistScheduleMode, type BusinessHours, type Interval, type ReservationConfig, type ResourceKind, type Room, type ShopBookingSettings } from '../../api/reservations';
import { currentShopAllows, isCurrentShop, useShopId } from '../../hooks/useShopId';
import PageHeader from '../../components/PageHeader';
import { errorMessage, money } from '../../utils/feedback';
import { dayKeys, intervalLabel, minuteLabel, roomLabels, shopLocal, shopUtc, timeMinute, weekdays } from '../../utils/reservationTime';
import { policyPayload, variantPayload, variantPriceCents, variantPriceDraft } from '../../utils/reservationPricing';
import { requestedEntryId, selectEntryResource } from '../../utils/entryNavigation';
import { copyHoursDays, formatBusinessHours, hoursDraft, hoursPayload, type HoursDraft } from '../../utils/reservationHours';
import ServiceAddOnEditor from '../../components/ServiceAddOnEditor';
import { useMerchantDraftProtection } from '../../components/MerchantDraftGuard';
import { useAuthStore } from '../../stores/authStore';
import { getProjectCatalog } from '../../api/projectCatalog';
import { readProjectCatalogPage } from '../../../../src/utils/projectCatalog';
import { EMPTY_PROJECT_EDITOR, type EmbeddedProjectEditor, type ProjectEditorState } from '../../utils/projectWorkspace';
import { checkedShopBookingSettings } from '../../../../src/utils/shopBookingSettings';
import { ShopBookingSettingsPanel } from './ShopBookingSettingsPanel';
import StoreOrderEmailReadiness from '../../components/StoreOrderEmailReadiness';

type EditorKind = ResourceKind | 'policy' | 'schedule';
type Values = Record<string, string | number | boolean | null>;
interface Editor { durationKind?: ServiceDurationKind; kind: EditorKind; id?: string; title: string; values: Values; }
interface HoursEditorState { dirty: boolean; busy: boolean; unknown: boolean; }
type HoursRecovery = 'NONE' | 'SAVED' | 'UNKNOWN';
class HoursSaveError extends Error {
  readonly outcome: Exclude<HoursRecovery, 'NONE'>;
  constructor(message: string, outcome: Exclude<HoursRecovery, 'NONE'>) { super(message); this.name = 'HoursSaveError'; this.outcome = outcome; }
}
const active = (value: boolean) => <Tag color={value ? 'cyan' : 'default'}>{value ? '已启用' : '已停用'}</Tag>;
const numberRule = (min: number, max: number) => [{ required: true, type: 'integer' as const, min, max }];
function IntervalRows({ rows, timezone, onEdit, onDelete }: { rows: Interval[]; timezone: string | null; onEdit: (row: Interval) => void; onDelete: (id: string) => void }) {
  return rows.length ? <div className="merchant-resource-list">{rows.map(row => <article className="merchant-resource-row" key={row.id}><div><strong>{intervalLabel(row.startAtUtc, row.endAtUtc, timezone)}</strong>{row.reason && <p className="merchant-secondary merchant-wrap">{row.reason}</p>}</div><Space><Button onClick={() => onEdit(row)}>编辑</Button><Button danger onClick={() => onDelete(row.id)}>删除</Button></Space></article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无禁用时段" />;
}

export function ProjectReservationEditor(props: EmbeddedProjectEditor) { return <ReservationsPage projectEditor={props} />; }

export default function ReservationsPage({ projectEditor }: { projectEditor?: EmbeddedProjectEditor } = {}) {
  const { shopId: selectedShopId, shop, loading: shopLoading, refreshing: shopRefreshing, error: shopError, updateShop, can } = useShopId();
  const shopId = projectEditor?.shopId ?? selectedShopId;
  const actorId = useAuthStore(state => state.merchant?.id);
  const projectServiceId = projectEditor?.serviceId;
  const scope = useRef({ shopId, actorId, projectServiceId, generation: 0 });
  if (scope.current.shopId !== shopId || scope.current.actorId !== actorId || scope.current.projectServiceId !== projectServiceId) scope.current = { shopId, actorId, projectServiceId, generation: scope.current.generation + 1 };
  const scopeGeneration = scope.current.generation;
  const [params, setParams] = useSearchParams();
  const [config, setConfig] = useState<ReservationConfig | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [bookingSettingsDraft, setBookingSettingsDraft] = useState<ShopBookingSettings>(DEFAULT_SHOP_BOOKING_SETTINGS), [bookingSettingsDirty, setBookingSettingsDirty] = useState(false);
  const bookingSettingsView = useRef({ generation: scopeGeneration, config, draft: bookingSettingsDraft });
  bookingSettingsView.current = { generation: scopeGeneration, config, draft: bookingSettingsDraft };
  const [bookingSettingsError, setBookingSettingsError] = useState('');
  const [bookingSettingsConflict, setBookingSettingsConflict] = useState(false), [latestBookingConfig, setLatestBookingConfig] = useState<ReservationConfig | null>(null);
  const bookingConflictRef = useRef(false), latestBookingConfigRef = useRef(latestBookingConfig); latestBookingConfigRef.current = latestBookingConfig;
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [formError, setFormError] = useState('');
  const [reload, setReload] = useState(0), [roomId, setRoomId] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null), [dirty, setDirty] = useState(false);
  const editorRef = useRef(editor); editorRef.current = editor;
  const [form] = Form.useForm<Values>();
  const [unknown, setUnknown] = useState(false);
  const operation = useRef<symbol | null>(null);
  const writeState = useRef({ generation: scopeGeneration, unknown: false });
  if (writeState.current.generation !== scopeGeneration) { writeState.current = { generation: scopeGeneration, unknown: false }; operation.current = null; }
  const bookingSettingsRecovery = useRef<number | null>(null);
  const [addOnSnapshot, setAddOnSnapshot] = useState({ generation: scopeGeneration, ...EMPTY_PROJECT_EDITOR });
  const addOnState = addOnSnapshot.generation === scopeGeneration ? addOnSnapshot : EMPTY_PROJECT_EDITOR;
  // Child saves must survive parent revision reads and same-account revocation.
  // A new account, shop or selected service starts a separate draft scope.
  const addOnStateRef = useRef({ generation: scopeGeneration, ...EMPTY_PROJECT_EDITOR });
  const pendingAddOnProjectRead = useRef(false);
  if (addOnStateRef.current.generation !== scopeGeneration) { addOnStateRef.current = { generation: scopeGeneration, ...EMPTY_PROJECT_EDITOR }; pendingAddOnProjectRead.current = false; }
  const addOnLifecycle = useCallback((state: ProjectEditorState) => {
    if (scope.current.generation !== scopeGeneration) return;
    const next = { generation: scopeGeneration, ...state }; addOnStateRef.current = next; setAddOnSnapshot(next);
  }, [scopeGeneration]);
  const hasAddOnWork = () => { const state = addOnStateRef.current; return state.generation === scopeGeneration && (state.dirty || state.busy || state.unknown); };
  const [hoursState, setHoursState] = useState<HoursEditorState & { generation: number }>({ generation: scopeGeneration, dirty: false, busy: false, unknown: false });
  const hoursStateRef = useRef(hoursState);
  const hoursLifecycle = useCallback((state: HoursEditorState) => {
    if (scope.current.generation !== scopeGeneration) return;
    const previous = hoursStateRef.current;
    const next = { ...state, generation: scopeGeneration };
    hoursStateRef.current = next; setHoursState(next);
    if (previous.generation === scopeGeneration && previous.dirty && !state.dirty) setBookingSettingsError('');
  }, [scopeGeneration]);
  const hoursDirty = hoursState.generation === scopeGeneration && hoursState.dirty;
  const hoursBusy = hoursState.generation === scopeGeneration && hoursState.busy;
  const hoursLocked = () => hoursStateRef.current.generation === scopeGeneration && hoursStateRef.current.busy;
  const hoursUnconfirmed = () => hoursStateRef.current.generation === scopeGeneration && hoursStateRef.current.unknown;
  const hasHoursDraft = () => hoursStateRef.current.generation === scopeGeneration && hoursStateRef.current.dirty;
  const mounted = useRef(true);
  const [modal, modalContext] = Modal.useModal();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    bookingSettingsRecovery.current = null;
    if (editorRef.current) form.resetFields();
    editorRef.current = null; setEditor(null); setDirty(false); setFormError('');
    setBookingSettingsDraft(DEFAULT_SHOP_BOOKING_SETTINGS); setBookingSettingsDirty(false); setBookingSettingsError(''); setUnknown(false); setNotice(''); setSaving(false);
    bookingConflictRef.current = false; setBookingSettingsConflict(false); setLatestBookingConfig(null);
  }, [shopId, actorId, projectServiceId]);
  const current = () => mounted.current && scope.current.generation === scopeGeneration && actorId === useAuthStore.getState().merchant?.id && !!shopId && isCurrentShop(shopId);
  const markUnknown = (value: boolean) => { if (current()) { writeState.current.unknown = value; setUnknown(value); } };
  const beginOperation = () => {
    if (!current() || operation.current) return null;
    const token = Symbol(); operation.current = token; setSaving(true); return token;
  };
  const endOperation = (token: symbol) => { if (current() && operation.current === token) { operation.current = null; setSaving(false); } };
  const writable = () => !loading && !error && current() && !!shopId && currentShopAllows(shopId, 'RESERVATION_CONFIG') && !projectEditor?.disabled && !writeState.current.unknown;
  const catalogWritable = () => !loading && !error && current() && !!shopId && currentShopAllows(shopId, 'CATALOG_MANAGE') && !projectEditor?.disabled && !writeState.current.unknown;
  const editorWritable = () => editor?.kind === 'variants' ? writable() && catalogWritable() : writable();
  const beforeWrite = () => writable() && !bookingSettingsDirty && !hasHoursDraft() && !hoursLocked() && !hoursUnconfirmed() && !addOnState.dirty && !addOnState.busy && !addOnState.unknown && (!projectEditor || projectEditor.beforeWrite());
  useMerchantDraftProtection(shopId ?? '', dirty || bookingSettingsDirty || hoursDirty || addOnState.dirty, saving || hoursBusy || addOnState.busy, () => !!operation.current || writeState.current.unknown || hoursLocked() || hoursUnconfirmed() || addOnState.unknown);
  useEffect(() => { projectEditor?.onLifecycleChange({ dirty: dirty || addOnState.dirty, busy: loading || saving || !!editor || addOnState.busy, unknown: unknown || addOnState.unknown }); }, [dirty, loading, saving, editor, unknown, addOnState, projectEditor?.onLifecycleChange]);
  useEffect(() => () => { projectEditor?.onLifecycleChange(EMPTY_PROJECT_EDITOR); }, [projectEditor?.onLifecycleChange]);
  const loadConfig = async (signal?: AbortSignal): Promise<ReservationConfig> => {
    if (!shopId) throw Error('请重新选择本店。');
    if (!projectEditor) return getReservationConfig(shopId, signal);
    const query = { search: '', status: 'all' as const, page: 1, pageSize: 1, serviceId: projectEditor.serviceId };
    const page = readProjectCatalogPage(await getProjectCatalog(shopId, query, signal), shopId, query);
    if(!page.canConfigurePolicy) throw Error('当前账号无预约规则编辑权限，请保留草稿后重新核对权限。');
    // The validated inventory preserves unused base and legacy metadata. Do not
    // run the base-price/duration normalizer over a selected variant family.
    const services: ReservationConfig['services'] = page.items.map(row => {
      const durationKind=readServiceDurationKind(row.durationKind);
      const basis=(value:unknown):'PER_PERSON'|'PER_BOOKING'=>{if(value!=='PER_PERSON'&&value!=='PER_BOOKING')throw Error('目录计价口径尚未核对，请保留原项目并由管理员修正。');return value;};
      const integer=(value:number|null,label:string):number=>{if(value===null||!Number.isSafeInteger(value))throw Error(label+'缺失或无法核对；原始记录仍保留在全部项目中。');return value;};
      if(row.participantCount!==1&&row.participantCount!==2)throw Error('顾客人数尚未核对，原始记录保留在全部项目中。');
      if(row.requiredRoomType!==null&&!['SINGLE','COUPLE','FOOT_SEAT'].includes(row.requiredRoomType))throw Error('场地类型尚未核对，原始记录保留在全部项目中。');
      return { id:row.id,shopId:row.shopId,name:row.name,isActive:row.isActive,durationKind,
        durationMin:integer(row.durationMin,'基础占用时间'),priceCents:integer(row.priceCents,'基础价格'),priceBasis:basis(row.priceBasis),
        participantCount:row.participantCount,requiredStaffCount:integer(row.requiredStaffCount,'技师人数'),
        requiredRoomType:row.requiredRoomType as ReservationConfig['services'][number]['requiredRoomType'],
        staffBufferMin:integer(row.staffBufferMin,'技师缓冲'),roomBufferMin:integer(row.roomBufferMin,'场地缓冲'),
        variants:row.variants.map(variant=>{if(variant.currency!=='usd')throw Error('规格币种尚未核对，原始记录保留在全部项目中。');return {id:variant.id,serviceId:variant.serviceId,name:variant.name,durationKind,
          durationMin:integer(variant.durationMin,'规格占用时间'),priceCents:integer(variant.priceCents,'规格价格'),priceBasis:basis(variant.priceBasis),
          currency:variant.currency,isActive:variant.isActive,sortOrder:integer(variant.sortOrder,'规格排序')};}),
        addOns:row.addOns.map(extra=>{if(extra.currency!=='usd')throw Error('附加项目币种尚未核对，原始记录保留在全部项目中。');return {id:extra.id,serviceId:extra.serviceId,name:extra.name,description:extra.description,
          priceCents:integer(extra.priceCents,'附加项目价格'),currency:'usd' as const,isActive:extra.isActive,sortOrder:integer(extra.sortOrder,'附加项目排序')};}),
      };
    });
    return { shopId, timezone: shop?.timezone ?? null, services, therapists: [], rooms: [] };
  };
  useEffect(() => {
    // A parent catalog revision may arrive during this save/readback. Keep its
    // modal and exact inputs until the current operation or recovery has ended.
    if (projectEditor && (operation.current || editorRef.current || writeState.current.unknown || hasAddOnWork())) { if (hasAddOnWork()) pendingAddOnProjectRead.current = true; return; }
    pendingAddOnProjectRead.current = false;
    const controller = new AbortController(); setConfig(null); setError(''); setEditor(null);
    if (!shopId) { setLoading(false); return; }
    setLoading(true);
    loadConfig(controller.signal).then(result => { if (!controller.signal.aborted && current()) setConfig(result); })
      .catch(e => { if (!controller.signal.aborted && current()) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted && current()) setLoading(false); });
    return () => controller.abort();
  }, [shopId, selectedShopId, actorId, reload, projectEditor?.revision, projectEditor?.serviceId]);
  useEffect(() => {
    if (!projectEditor || !pendingAddOnProjectRead.current || hasAddOnWork() || !current()) return;
    pendingAddOnProjectRead.current = false; setReload(value => value + 1);
  }, [addOnState.dirty, addOnState.busy, addOnState.unknown, shopId, actorId, projectServiceId]);
  useEffect(() => { if (config && !bookingSettingsDirty) { setBookingSettingsDraft(config.bookingSettings ?? DEFAULT_SHOP_BOOKING_SETTINGS); setBookingSettingsError(''); } }, [config, bookingSettingsDirty]);
  useEffect(() => {
    if (!dirty && !bookingSettingsDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, bookingSettingsDirty]);
  const serviceId = projectEditor?.serviceId ?? requestedEntryId(params.toString(), 'serviceId');
  const therapistId = requestedEntryId(params.toString(), 'therapistId');
  const service = selectEntryResource(config?.services ?? [], serviceId);
  const therapist = selectEntryResource(config?.therapists ?? [], therapistId);
  const room = config?.rooms.find(row => row.id === roomId) ?? config?.rooms[0];
  const tab = projectEditor ? 'services' : params.get('tab') || 'therapists';
  const selectResource = (key: 'serviceId' | 'therapistId', id: string) => setParams(previous => {
    const next = new URLSearchParams(previous); next.set(key, id); return next;
  });
  const open = (kind: EditorKind, title: string, values: Values, id?: string) => {
    if (!beforeWrite() || operation.current || saving || editorRef.current) return;
    setFormError(''); setDirty(false); form.resetFields(); form.setFieldsValue(values); setEditor({ kind, title, values, id, durationKind: kind === 'variants' ? readServiceDurationKind(service?.durationKind) : undefined });
  };
  const close = async () => {
    if (saving || writeState.current.unknown || !current() || editorRef.current !== editor) return;
    const token = beginOperation(); if (!token) return;
    try {
      if (dirty && !await modal.confirm({ title: '放弃尚未保存的设置？', content: '当前编辑内容尚未保存。', okText: '放弃', cancelText: '继续编辑' })) return;
      if (current() && editorRef.current === editor) { setEditor(null); setDirty(false); }
    } finally { endOperation(token); }
  };
  const refresh = async (message: string, reconcileBookingSettings = false, expectedBookingSettings?: ShopBookingSettings) => {
    if (!shopId) return;
    const recoveringBookingSettings = reconcileBookingSettings && bookingSettingsRecovery.current === scopeGeneration;
    try {
      const value = await loadConfig();
      // A partial config read is not evidence that an unknown rules save became defaults.
      // Embedded project reads intentionally omit these rules and use their own recovery.
      const reconciled = recoveringBookingSettings || expectedBookingSettings ? checkedShopBookingSettings(value.bookingSettings) : value.bookingSettings ?? DEFAULT_SHOP_BOOKING_SETTINGS;
      if (expectedBookingSettings && JSON.stringify(reconciled) !== JSON.stringify(expectedBookingSettings)) throw new Error('最新预约规则尚未核对到本次提交的提前时间与闭店日期。');
      if (current()) { setConfig(value); if (reconcileBookingSettings) { setBookingSettingsDraft(reconciled); setBookingSettingsDirty(false); setBookingSettingsError(''); } setError(''); setNotice(message); }
    }
    catch (e) {
      if (reconcileBookingSettings || expectedBookingSettings) {
        const failure = new Error((recoveringBookingSettings ? '预约提前时间与临时闭店' : '预约设置保存结果') + '尚未完整核对，当前草稿和保存锁已保留，请再次核对。' + errorMessage(e));
        if (current()) setError(failure.message);
        throw failure;
      }
      if (current()) { if (!hasAddOnWork()) setConfig(null); setError('更改已保存，但刷新失败。请刷新核对后再执行操作。' + errorMessage(e)); } throw e;
    }
  };
  const readHoursConfig = async () => {
    if (!current() || !currentShopAllows(shopId!, 'RESERVATION_CONFIG') || projectEditor?.disabled) throw Error('请重新核对当前门店及营业时间编辑权限。');
    const value = await loadConfig();
    if (!current()) throw Error('门店或账号已变更，请重新核对当前门店资料。');
    if (!value.businessHours) throw Error('服务器营业时间未能完整读取，请保留草稿后重试核对。');
    const businessHours = hoursPayload(hoursDraft(value.businessHours));
    setConfig(value);
    if (shop) updateShop({ ...shop, businessHours });
    return businessHours;
  };
  const save = async () => {
    if (!shopId || !editor || editorRef.current !== editor || !config || saving || !editorWritable() || !beforeWrite()) return;
    const token = beginOperation(); if (!token) return;
    let submitted = false, persisted = false;
    try {
      let values: Values;
      try { values = await form.validateFields(); } catch { return; }
      if (editorRef.current !== editor || !editorWritable() || !beforeWrite()) return;
      setFormError('');
      let payload: Record<string, unknown>;
      if (editor.kind === 'policy') {
        payload = policyPayload(values);
        submitted = true; await savePolicy(shopId, editor.id!, payload);
      } else if (editor.kind === 'schedule') {
        if (values.scheduleMode !== 'SHOP' && values.scheduleMode !== 'CUSTOM') throw new Error('请选择排班方式。');
        submitted = true; await saveTherapistScheduleMode(shopId, editor.id!, values.scheduleMode);
      } else {
        if (editor.kind === 'variants') payload = variantPayload(values, editor.id ? undefined : String(editor.values.serviceId));
        else if (editor.kind === 'shifts') {
          const startMin = timeMinute(String(values.startTime)), endMin = timeMinute(String(values.endTime), true);
          if (endMin <= startMin) throw new Error('排班结束时间须晚于开始时间，跨夜排班请拆为两天。');
          payload = { ...(editor.id ? {} : { therapistId: editor.values.therapistId }), weekday: values.weekday, startMin, endMin, isActive: values.isActive };
        } else if (editor.kind === 'rooms') payload = { name: String(values.name).trim(), roomType: values.roomType, capacity: values.roomType === 'COUPLE' ? 2 : 1, isActive: values.isActive };
        else {
          const startAtUtc = shopUtc(String(values.startLocal), config.timezone), endAtUtc = shopUtc(String(values.endLocal), config.timezone);
          if (endAtUtc <= startAtUtc) throw new Error('结束时间须晚于开始时间。');
          const parent = editor.kind === 'time-off' ? 'therapistId' : 'roomId';
          payload = { ...(editor.id ? {} : { [parent]: editor.values[parent] }), startAtUtc, endAtUtc, reason: String(values.reason || '').trim() || null };
        }
        submitted = true; const item = await saveResource(shopId, editor.kind, payload, editor.id);
        if (current() && editor.kind === 'rooms') setRoomId(String(item.id));
      }
      persisted = true;
      if (!current()) return;
      if (projectEditor && current()) await projectEditor.onSaved();
      await refresh((editor.kind === 'variants' ? '当前规格' : editor.kind === 'policy' ? '本服务预约规则' : '当前设置') + '已保存，并已重新读取服务器设置。');
      if (current()) { setEditor(null); setDirty(false); }
    } catch (e: any) { if (current()) { setFormError(errorMessage(e)); if (submitted && (persisted || !e?.response?.status || e.response.status >= 500 || e.response.status === 408)) markUnknown(true); } }
    finally { endOperation(token); }
  };
  const remove = async (kind: ResourceKind, id: string) => {
    if (!shopId || saving || (kind === 'variants' ? !catalogWritable() : !writable()) || !beforeWrite()) return;
    const physical = kind === 'time-off' || kind === 'maintenance';
    const token = beginOperation(); if (!token) return;
    try {
      if (!await modal.confirm({ title: physical ? '删除该禁用时段？' : '停用该资源？', content: '现有预约保留，服务器会拒绝与已确认预约或清理缓冲冲突的更改。', okText: physical ? '删除' : '停用', okButtonProps: { danger: true } })) return;
      if ((kind === 'variants' ? !catalogWritable() : !writable()) || !beforeWrite()) return;
      setNotice(''); setError('');
      await removeResource(shopId, kind, id); if (current()) { if (projectEditor) await projectEditor.onSaved(); await refresh(physical ? '禁用时段已删除。' : '资源已停用。'); }
    } catch (e: any) { if (current()) { setError(errorMessage(e)); if (!e?.response?.status || e.response.status >= 500 || e.response.status === 408) markUnknown(true); } } finally { endOperation(token); }
  };
  const reconcileUnknown = async () => {
      const token = beginOperation(); if (!token) return;
      try {
        if (!await modal.confirm({ title: '结束未知草稿并刷新核对？', content: '原请求不会取消，当前输入将放弃。请核对最新目录后再编辑。', okText: '结束草稿并核对', cancelText: '保留草稿' }) || !current()) return;
        await refresh('已重新读取当前设置，请核对原操作。', true);
        if (projectEditor && current()) await projectEditor.onSaved();
        if (current()) { setEditor(null); setDirty(false); bookingSettingsRecovery.current = null; markUnknown(false); }
      } catch(cause){if(current())setError(errorMessage(cause));} finally { endOperation(token); }

  };
  const windowValues = (row?: Interval): Values => ({ startLocal: row ? shopLocal(row.startAtUtc, config!.timezone) : '', endLocal: row ? shopLocal(row.endAtUtc, config!.timezone) : '', reason: row?.reason ?? '' });
  const editWindow = (kind: 'time-off' | 'maintenance', row: Interval, label: string) => { try { open(kind, label, windowValues(row), row.id); } catch (e) { setError(errorMessage(e)); } };
  const roomValues = (row?: Room): Values => ({ name: row?.name ?? '', roomType: row?.roomType ?? 'SINGLE', isActive: row?.isActive ?? true });
  const resourceActions = (kind: ResourceKind, id: string, isActive: boolean, edit: () => void) => { const allowed = kind === 'variants' ? catalogWritable() : writable(); return <Space wrap><Button disabled={saving || !allowed || unknown || addOnState.busy || addOnState.dirty || addOnState.unknown} onClick={edit}>编辑</Button><Button disabled={saving || !isActive || !allowed || unknown || addOnState.busy || addOnState.dirty || addOnState.unknown} onClick={() => void remove(kind, id)}>停用</Button></Space>; };
  const participantCount = Form.useWatch('participantCount', form);


  const formRoomType = Form.useWatch('roomType', form);
  const currentBookingSettingsView = () => current() && config?.shopId === shopId
    && bookingSettingsView.current.generation === scopeGeneration
    && bookingSettingsView.current.config === config && bookingSettingsView.current.draft === bookingSettingsDraft;
  const changeBookingSettings = (next: ShopBookingSettings) => {
    if (!currentBookingSettingsView() || !config?.bookingSettings || !writable() || operation.current || saving || editor || dirty
      || hasHoursDraft() || hoursLocked() || hoursUnconfirmed() || addOnState.dirty || addOnState.busy || addOnState.unknown) return;
    bookingSettingsView.current = { ...bookingSettingsView.current, draft: next };
    setBookingSettingsDraft(next); setBookingSettingsError('');
    setBookingSettingsDirty(JSON.stringify(next) !== JSON.stringify(config?.bookingSettings ?? DEFAULT_SHOP_BOOKING_SETTINGS));
  };
  const saveBookingSettingsDraft = async () => {
    if (!shopId || !currentBookingSettingsView() || !config?.bookingSettings || !config.bookingSettingsHash || bookingConflictRef.current || !writable() || !bookingSettingsDirty || saving || editor || dirty || hasHoursDraft() || hoursLocked() || hoursUnconfirmed() || addOnState.dirty || addOnState.busy || addOnState.unknown) return;
    let normalized: ShopBookingSettings;
    try { normalized = checkedShopBookingSettings(bookingSettingsDraft); } catch (cause) { setBookingSettingsError(errorMessage(cause)); return; }
    const token = beginOperation(); if (!token) return;
    setBookingSettingsError(''); setNotice('');
    try {
      const receipt = await saveShopBookingSettings(shopId, normalized, config.bookingSettingsHash);
      const saved = receipt.bookingSettings;
      if (!current()) return;
      await refresh('预约提前时间与临时闭店已保存。', false, saved);
      if (!current()) return;
      setBookingSettingsDraft(saved); setBookingSettingsDirty(false);
    } catch (e) { if (current()) { const status = (e as { response?: { status?: number } })?.response?.status; if (!status || status === 408 || status >= 500) { bookingSettingsRecovery.current = scopeGeneration; markUnknown(true); } if (status === 409) { bookingConflictRef.current = true; setBookingSettingsConflict(true); setLatestBookingConfig(null); } setBookingSettingsError('预约规则未能确认保存。' + errorMessage(e) + (status === 409 ? ' 当前草稿已保留；请重读最新规则并明确合并或放弃草稿后再保存。' : '')); } }
    finally { endOperation(token); }
  };
  const readLatestBookingRules = async () => {
    if (!current() || !writable() || operation.current || saving) return;
    const token = beginOperation(); if (!token) return;
    try { const latest = await loadConfig(); if (current()) { checkedShopBookingSettings(latest.bookingSettings); if (!latest.bookingSettingsHash) throw Error('最新规则版本缺失。'); setLatestBookingConfig(latest); } }
    catch (error) { if (current()) setBookingSettingsError('当前草稿仍保留，最新规则读取失败。' + errorMessage(error)); }
    finally { endOperation(token); }
  };
  const adoptLatestBookingRules = (merge: boolean) => {
    if (!currentBookingSettingsView() || !writable() || operation.current || saving || !latestBookingConfig?.bookingSettings || latestBookingConfigRef.current !== latestBookingConfig) return;
    let next = latestBookingConfig.bookingSettings;
    if (merge) {
      const periods = [...next.closedPeriods, ...bookingSettingsDraft.closedPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const merged: ShopBookingSettings['closedPeriods'] = [];
      for (const period of periods) { const previous = merged.at(-1); if (previous && period.startDate <= previous.endDate) { if (period.endDate > previous.endDate) previous.endDate = period.endDate; } else merged.push({ ...period }); }
      next = checkedShopBookingSettings({ minimumNoticeMinutes: bookingSettingsDraft.minimumNoticeMinutes, closedPeriods: merged });
    }
    setConfig(latestBookingConfig); setBookingSettingsDraft(next); setBookingSettingsDirty(JSON.stringify(next) !== JSON.stringify(latestBookingConfig.bookingSettings));
    bookingConflictRef.current = false; setBookingSettingsConflict(false); setLatestBookingConfig(null); setBookingSettingsError('');
  };
  if (shopLoading) return <Card loading />;
  if (!shopId) return <Empty description="请选择已授权门店管理预约资源。" />;
  return <div className={projectEditor ? 'merchant-project-rules' : 'merchant-page'}>{modalContext}{!projectEditor && <PageHeader title="预约设置" description="管理本店最短预约提前量、临时闭店、服务规格、每周排班与实体场地。" actions={<Button icon={<ReloadOutlined />} loading={loading} disabled={saving || !!editor || bookingSettingsDirty || hoursDirty || hoursBusy} onClick={() => { if (!hasHoursDraft() && !hoursLocked()) setReload(v => v + 1); }}>刷新</Button>} />}
    <Alert type="info" showIcon title={`${shop?.name ?? shopId} · ${config?.timezone || shop?.timezone || '时区尚未设置'}`} description="单人、情侣和四手服务均按实际顾客与技师人数占用资源；保存时重新检查场地与清理缓冲。" />
    {!projectEditor && <StoreOrderEmailReadiness shop={shop} available={!shopRefreshing && !shopError && shop?.id === shopId} />}
    {!projectEditor && config && <ShopBookingSettingsPanel key={shopId} settings={bookingSettingsDraft} timezone={config.timezone ?? shop?.timezone ?? null} phone={Array.isArray(shop?.studioProfile?.phones) ? shop.studioProfile.phones.find((value): value is string => typeof value === 'string' && !!value.trim()) : shop?.phone} disabled={!config.bookingSettings || !writable() || saving || !!editor || unknown || hoursDirty || hoursBusy} dirty={bookingSettingsDirty} onChange={changeBookingSettings} onSave={() => void saveBookingSettingsDraft()} />}
    {hoursDirty && <Alert type="warning" showIcon title="营业时间有未保存修改" description="请先在营业时间中保存或明确放弃修改，再刷新或切换预约分区。离开页面或切换门店时会提示确认。" />}
    {!projectEditor && config && !config.bookingSettings && <Alert type="warning" showIcon title="预约规则尚未成功读取，暂不能编辑；请刷新后重试。" />}
    {bookingSettingsError && <Alert type="error" showIcon title={bookingSettingsError} />}
    {bookingSettingsConflict && <Alert type="warning" showIcon title="预约规则已有变化，当前草稿已保留" description={latestBookingConfig?.bookingSettings ? `服务器最新提前量：${latestBookingConfig.bookingSettings.minimumNoticeMinutes} 分钟；最新闭店：${latestBookingConfig.bookingSettings.closedPeriods.map(period => `${period.startDate} 至 ${period.endDate}`).join('；') || '无'}。合并会保留双方闭店日期和当前草稿提前量。` : '请先重读最新规则。不会直接使用旧草稿覆盖其他窗口或日历刚设置的闭店日期。'} action={<Space wrap><Button disabled={saving} onClick={() => void readLatestBookingRules()}>重读最新规则，保留草稿</Button>{latestBookingConfig && <><Button disabled={saving} onClick={() => adoptLatestBookingRules(true)}>合并最新闭店日期</Button><Button disabled={saving} onClick={() => adoptLatestBookingRules(false)}>放弃草稿并采用最新规则</Button></>}</Space>} />}
    {unknown && <Alert type="warning" showIcon title="保存结果待核对，设置操作已锁定" description="输入已保留；请先核对服务器设置，不会自动重复请求。" action={<Button disabled={saving} onClick={()=>void reconcileUnknown()}>结束草稿并核对</Button>} />}
    {error && <Alert type="error" showIcon title={error} action={<Button disabled={saving || hoursDirty || hoursBusy} onClick={() => { if (!hasHoursDraft() && !hoursLocked()) setReload(v => v + 1); }}>重试</Button>} />}
    {notice && <Alert type="success" showIcon title={notice} closable onClose={() => setNotice('')} />}
    {loading ? <Card loading /> : config && <>{!projectEditor && config.orderOnly !== true && can('OWNER_ONLY') && <PaymentPolicyPanel key={shopId} config={config} saving={saving || !!editor || bookingSettingsDirty || hoursDirty || hoursBusy} onSave={async enabled => {
      if (!writable() || !currentShopAllows(shopId, 'OWNER_ONLY') || saving || editor || bookingSettingsDirty || hasHoursDraft() || hoursLocked()) return;
      const token = beginOperation(); if (!token) return;
      let submitted = false;
      try {
        if (!await modal.confirm({ title: enabled ? '开启到店付款？' : '停止接收新的到店付预约？', content: enabled ? '顾客可提交到店付预约，请及时接受，并仅登记已实际收到的款项；此操作不会向顾客扣款。' : '现有预约保留原付款方式与收款历史。', okText: '保存规则' }) || !writable() || !currentShopAllows(shopId, 'OWNER_ONLY')) return;
        setError(''); setNotice(''); submitted = true;
        await saveShopPaymentPolicy(shopId, enabled); if (current()) await refresh('付款规则已保存并刷新。');
      } catch (e) { if (current()) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (submitted && (!status || status === 408 || status >= 500)) markUnknown(true);
        setError('再次尝试前，请刷新核对当前规则。' + errorMessage(e));
      } }
      finally { endOperation(token); }
    }} />}<Tabs tabBarStyle={projectEditor ? { display: 'none' } : undefined} activeKey={tab} onChange={value => { if (hasHoursDraft() || hoursLocked()) { setBookingSettingsError('请先保存或放弃营业时间草稿，再切换预约分区。'); return; } if (bookingSettingsDirty) { setBookingSettingsError('请先保存预约提前时间和临时闭店修改，再切换预约分区。'); return; } setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', value); return next; }); }} items={[
      { key: 'services', label: '服务规格与规则', children: <>{!projectEditor && <Card title="选择服务" extra={can('CATALOG_MANAGE') ? <Link to="/services">管理服务</Link> : null}><Select aria-label="服务" style={{ width: '100%' }} value={service?.id} options={config.services.map(row => ({ value: row.id, label: `${row.name}${row.isActive ? '' : ' · 已停用'}` }))} onChange={id => selectResource('serviceId', id)} />{!service && (serviceId !== null ? <Alert style={{ marginTop: 16 }} type="warning" showIcon title="所请求的服务在本店不可用" description="系统未替换成其他服务，请明确选择可用服务。" /> : <Empty description="请先创建服务，再配置预约规格。" />)}</Card>}{projectEditor && !service && <Alert type="warning" showIcon title="所选项目在本店不可用；不会替换为其他项目。" />}{service && <>
        <Card title="规格与价格" extra={<Button disabled={saving || !catalogWritable() || unknown || addOnState.busy || addOnState.dirty || addOnState.unknown} type="primary" icon={<PlusOutlined />} onClick={() => open('variants', service.name, { serviceId: service.id, name: '', durationMin: null, priceUsd: null, priceBasis: 'PER_BOOKING', sortOrder: 0, isActive: true })}>新增规格</Button>}>
          {!can('CATALOG_MANAGE') && <Alert style={{ marginBottom: 12 }} type="info" showIcon title="规格名称、价格、时长与启停由服务目录权限维护；当前账号仅可查看。" />}
          <Typography.Paragraph type="secondary">{durationHelp(service.durationKind)} </Typography.Paragraph><Typography.Paragraph type="secondary">规格继承主服务类型，各自明确填写预约占用与固定金额。价格为整次订单总价，不按顾客或技师人数重复计算；不会按时长推价。</Typography.Paragraph>
          {service.variants.length ? <Table aria-label="当前服务规格与价格" rowKey="id" size="small" pagination={false} scroll={{x:650}} dataSource={service.variants} columns={[
            {title:'规格名称',dataIndex:'name',key:'name'},
            {title:'占用时长',key:'duration',render:(_,row)=>serviceDurationLabel(service.durationKind,row.durationMin)},
            {title:'整次订单价格（USD）',key:'price',render:(_,row)=>money(row.priceCents,row.currency)},
            {title:'状态',key:'active',render:(_,row)=>active(row.isActive)},
            {title:'操作',key:'actions',render:(_,row)=>resourceActions('variants', row.id, row.isActive, () => open('variants', service.name, { name: row.name, durationMin: row.durationMin, priceUsd: variantPriceDraft(row.priceCents), priceBasis: 'PER_BOOKING', sortOrder: row.sortOrder, isActive: row.isActive }, row.id))},
          ]} /> : <Empty description="暂无独立规格，继续使用基础服务时长与价格。一旦创建规格，预约必须选择启用规格；停用全部规格不会恢复原基础计价。" />}
        </Card><details open={projectEditor?.initialRulesOpen} style={{marginTop:16, marginBottom:16}}><summary style={{cursor:'pointer', padding:16, border:'1px solid #dde5e8', borderRadius:12, fontWeight:600}}>预约规则 · 人数、场地与缓冲</summary><div style={{marginTop:12}}>        <Card title="预约规则" extra={<Button disabled={saving || !writable() || unknown || addOnState.busy || addOnState.dirty || addOnState.unknown} onClick={() => open('policy', service.name, { participantCount: service.participantCount, requiredStaffCount: service.requiredStaffCount, requiredRoomType: service.requiredRoomType ?? '', staffBufferMin: service.staffBufferMin, roomBufferMin: service.roomBufferMin, priceBasis: 'PER_BOOKING' }, service.id)}>编辑规则</Button>}><Descriptions column={{ xs: 1, sm: 2 }} items={[
          { key: 'basis', label: '收费方式', children: '整次订单总价' }, { key: 'basePrice', label: '项目价格来源', children: service.variants.length ? '使用上方实际规格价格，基础价格不参与预约' : money(service.priceCents, 'usd') },
          { key: 'people', label: '顾客人数／技师数', children: `${service.participantCount} / ${service.requiredStaffCount}` }, { key: 'room', label: '场地', children: service.requiredRoomType ? roomLabels[service.requiredRoomType] : '无需场地' },
          { key: 'kind', label: '项目时长类型', children: SERVICE_DURATION_LABELS[readServiceDurationKind(service.durationKind)] }, { key: 'occupancy', label: durationFieldLabel(service.durationKind), children: service.variants.length ? '以所选实际规格为准' : service.durationMin + ' 分钟' }, { key: 'staff', label: '员工清理缓冲', children: `${service.staffBufferMin}分钟` }, { key: 'roomBuffer', label: '场地清理缓冲', children: `${service.roomBufferMin}分钟` },
        ]} /></Card>
</div></details><details style={{marginBottom:16}}><summary style={{cursor:'pointer',padding:16, border:'1px solid #dde5e8', borderRadius:12, fontWeight:600}}>附加项目（可选）· {service.addOns ? service.addOns.length + ' 个' : '数量待核对'}</summary>{(can('CATALOG_MANAGE') || hasAddOnWork()) && <ServiceAddOnEditor key={actorId+':'+shopId+':'+service.id} shopId={shopId} service={service} disabled={!!projectEditor?.disabled || saving || !!editor || unknown} beforeWrite={() => catalogWritable() && !editor && (!projectEditor || projectEditor.beforeWrite())} onLifecycleChange={addOnLifecycle} onSaved={async()=>{if (projectEditor && current()) await projectEditor.onSaved(); await refresh('附加项目已保存，正在刷新本店配置。');}} />}</details></>}</> },
      { key: 'therapists', label: '员工排班与请假', children: <><Card title="本店技师团队" extra={can('CATALOG_MANAGE') ? <Link to={`/technicians?shopId=${encodeURIComponent(shopId)}`}>编辑技师</Link> : null}><Select aria-label="技师" style={{ width: '100%' }} value={therapist?.id} options={config.therapists.map(row => ({ value: row.id, label: `${row.name}${row.isActive ? '' : ' · 已停用'}` }))} onChange={id => selectResource('therapistId', id)} />{therapist ? <p className="merchant-secondary" style={{ marginTop: 12 }}>{therapist.isActive ? '此技师已启用，可承接本店全部项目，新增项目自动纳入。实际可约时段仍按排班、休假与已有占用检查。' : '此技师已停用，暂不参与预约分配；恢复启用后可承接本店全部项目。'}</p> : therapistId !== null ? <Alert style={{ marginTop: 16 }} type="warning" showIcon title="所请求的技师在本店不可用" description="系统未替换成其他技师，请明确选择可用技师。" /> : <Empty description="请先添加本店技师；启用后即可纳入本店全部项目的团队。" />}</Card>{therapist && <>
        <Card title="排班方式" extra={<Button disabled={saving} onClick={() => open('schedule', therapist.name + ' · 排班方式', { scheduleMode: therapist.scheduleMode ?? 'SHOP' }, therapist.id)}>修改方式</Button>}><Typography.Text strong>{therapist.scheduleMode === 'CUSTOM' ? '个人例外排班' : '跟随门店营业时间'}</Typography.Text><Typography.Paragraph type="secondary">默认跟随门店，无需重复填写班次；个人例外模式仅使用本人的启用班次。两种方式都扣除休假与已有占用，切换时核对未来预约。</Typography.Paragraph></Card>
        <Card title="个人例外班次" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open('shifts', therapist.name, { therapistId: therapist.id, weekday: 1, startTime: '', endTime: '', isActive: true })}>新增排班</Button>}><Typography.Paragraph type="secondary">按门店当地时间设置，休息时间请拆分排班。下方班次仅在个人例外模式生效；员工清理缓冲也须落在实际可用时段内。</Typography.Paragraph>{therapist.shifts.length ? <div className="merchant-resource-list">{therapist.shifts.map(row => <article key={row.id} className="merchant-resource-row"><Space wrap><strong>{weekdays[row.weekday]} · {minuteLabel(row.startMin)}–{minuteLabel(row.endMin)}</strong>{active(row.isActive)}</Space>{resourceActions('shifts', row.id, row.isActive, () => open('shifts', therapist.name, { weekday: row.weekday, startTime: minuteLabel(row.startMin), endTime: minuteLabel(row.endMin), isActive: row.isActive }, row.id))}</article>)}</div> : <Empty description={therapist.scheduleMode === 'CUSTOM' ? "个人例外尚未设置班次，该技师暂不可预约。" : "跟随门店营业时间，无需逐人重复添加班次。"} />}</Card>
        <Card title="请假／临时离岗" extra={<Button disabled={!config.timezone} icon={<PlusOutlined />} onClick={() => open('time-off', therapist.name, { ...windowValues(), therapistId: therapist.id })}>新增请假</Button>}><IntervalRows rows={therapist.timeOff} timezone={config.timezone} onEdit={row => editWindow('time-off', row, therapist.name)} onDelete={id => void remove('time-off', id)} /></Card>
      </>}</> },
      { key: 'rooms', label: '房间、座位与维护', children: <><Card title="实体场地" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open('rooms', '新场地', roomValues())}>新增场地</Button>}><Typography.Paragraph type="secondary">每个资源由一笔预约独占。共享足疗区请为每个座位分别创建资源，不要把整个区域作为一个资源。</Typography.Paragraph><Select aria-label="场地" style={{ width: '100%' }} value={room?.id} options={config.rooms.map(row => ({ value: row.id, label: `${row.name} · ${roomLabels[row.roomType]}${row.isActive ? '' : ' · 已停用'}` }))} onChange={setRoomId} />{room ? <div className="merchant-resource-row"><Space wrap>{active(room.isActive)}<span>{roomLabels[room.roomType]} · 容量 {room.capacity}</span></Space>{resourceActions('rooms', room.id, room.isActive, () => open('rooms', room.name, roomValues(room), room.id))}</div> : <Empty description="尚未配置场地。" />}</Card>{room && <Card title="维护／不可用时段" extra={<Button disabled={!config.timezone} icon={<PlusOutlined />} onClick={() => open('maintenance', room.name, { ...windowValues(), roomId: room.id })}>新增维护</Button>}><IntervalRows rows={room.maintenance} timezone={config.timezone} onEdit={row => editWindow('maintenance', row, room.name)} onDelete={id => void remove('maintenance', id)} /></Card>}</> },
      { key: 'hours', label: '营业时间', children: <OpeningHours key={scopeGeneration + ':' + shopId + ':' + reload} config={config} saving={saving || bookingSettingsDirty} canWrite={() => writable() && !editor && !bookingSettingsDirty} onLifecycleChange={hoursLifecycle} onReconcile={async () => {
        if (!current() || saving || editor || bookingSettingsDirty) throw Error('请先结束其他设置操作，再重新核对营业时间。');
        setSaving(true);
        try { return await readHoursConfig(); } finally { if (current()) setSaving(false); }
      }} onSave={async businessHours => {
        if (!writable() || saving || editor || bookingSettingsDirty) throw Error('当前不能保存营业时间，请保留草稿并核对门店、权限及其他未保存设置。');
        setSaving(true); setError(''); setNotice('');
        let persisted = false;
        try {
          await saveHours(shopId, businessHours); persisted = true;
          const saved = await readHoursConfig();
          if (JSON.stringify(saved) !== JSON.stringify(businessHours)) throw Error('服务器当前营业时间与提交草稿不一致，请重新核对后明确选择保留的设置。');
          if (current()) setNotice('营业时间已保存并重新核对。');
          return saved;
        } catch (cause) {
          if (persisted) throw new HoursSaveError('营业时间已保存，但最新设置回读失败。草稿仍保留，请先重新核对服务器设置。' + errorMessage(cause), 'SAVED');
          const status = (cause as { response?: { status?: number } })?.response?.status;
          if (!status || status === 408 || status >= 500) throw new HoursSaveError('营业时间保存结果尚未确认，已暂停再次保存。请先重新核对服务器设置。' + errorMessage(cause), 'UNKNOWN');
          throw cause;
        } finally { if (current()) setSaving(false); }
      }} /> },
    ].filter(item => projectEditor ? item.key === 'services' : item.key !== 'services')} /></>}
    <Modal open={!!editor} title={editor?.title} onCancel={() => void close()} onOk={() => void save()} okButtonProps={{ disabled: !editorWritable() || unknown }} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={false} destroyOnHidden width={620} okText={editor?.kind === 'variants' ? '保存当前规格' : editor?.kind === 'policy' ? '保存本服务预约规则' : '保存当前设置'}>
      {unknown && <Alert style={{marginBottom:16}} type="warning" showIcon title="保存结果待核对，当前输入已锁定" description="请先核对服务器设置；结束草稿不会取消原请求，也不会重复提交。" action={<Button disabled={saving} onClick={()=>void reconcileUnknown()}>结束草稿并核对</Button>} />}
      {editor && ['variants','policy'].includes(editor.kind) && <Alert style={{marginBottom:16}} type="info" showIcon title={editor.kind === 'variants' ? `只保存当前规格 · ${editor.title}` : `只保存本服务预约规则 · ${editor.title}`} description={editor.kind === 'variants' ? '保存本规格名称、USD价格、占用时长及启停，并同步关联展示行；不会修改其他服务、门店资料或历史订单。' : '只保存本服务的顾客人数、技师数、场地与清理缓冲；规格价格和历史订单保持不变。'} />}
      {formError && <Alert type="error" showIcon title={formError} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" disabled={saving || !editorWritable() || unknown} onValuesChange={changed => { setDirty(true); if (changed.participantCount === 2) { if (form.getFieldValue('requiredRoomType') !== 'COUPLE') form.setFieldValue('requiredRoomType', ''); form.setFieldValue('requiredStaffCount', 2); } }}>
        {editor && ['variants', 'policy'].includes(editor.kind) && <Form.Item label="收费方式"><Typography.Text>整次订单总价 · 不按顾客或技师人数重复计算</Typography.Text></Form.Item>}
        {editor?.kind === 'policy' && <><Alert type="info" showIcon title="单人 1客1技师 · 情侣 2客2技师 · 四手 1客2技师" description="这里仅配置接待人数、场地与清理缓冲。规格名称、价格、时长与启停由服务目录维护。" style={{ marginBottom: 16 }} /><div className="merchant-form-grid"><Form.Item name="participantCount" label="顾客人数" rules={[{ required: true }]}><Select options={[{ value: 1, label: '1 位顾客' }, { value: 2, label: '2 位顾客（情侣）' }]} /></Form.Item><Form.Item name="requiredStaffCount" label="所需技师" rules={[{ required: true }]}><Select disabled={participantCount === 2} options={[{ value: 1, label: '1 位技师' }, { value: 2, label: participantCount === 2 ? '2 位技师（情侣）' : '2 位技师（四手）' }]} /></Form.Item><Form.Item name="requiredRoomType" label="所需场地（可选）" extra="不绑定场地时只按技师排班；绑定后会同时检查并占用场地。"><Select options={[{ value: '', label: '不绑定场地' }, ...Object.entries(roomLabels).filter(([value]) => participantCount !== 2 || value === 'COUPLE').map(([value, label]) => ({ value, label }))]} /></Form.Item><Form.Item name="staffBufferMin" label="员工清理缓冲（分钟）" rules={numberRule(0, 120)}><InputNumber min={0} max={120} precision={0} /></Form.Item><Form.Item name="roomBufferMin" label="场地清理缓冲（分钟）" rules={numberRule(0, 120)}><InputNumber min={0} max={120} precision={0} /></Form.Item></div></>}
        {editor?.kind === 'variants' && <><Form.Item name="name" label="规格名称" rules={[{ required: true, whitespace: true, max: 100 }]}><Input maxLength={100} /></Form.Item><div className="merchant-form-grid"><Form.Item label="继承主服务类型"><Typography.Text>{SERVICE_DURATION_LABELS[readServiceDurationKind(editor.durationKind)]}（规格不可单独改变）</Typography.Text></Form.Item><Form.Item name="durationMin" label={durationFieldLabel(editor.durationKind)} extra={durationHelp(editor.durationKind)} rules={numberRule(5, 240)}><InputNumber min={5} max={240} precision={0} /></Form.Item><Form.Item name="priceUsd" label="整次订单固定价格（USD）" rules={[{ required: true }, { validator: async (_, value) => { variantPriceCents(value); } }]} extra="输入美元，最多两位小数，例如 100.25；金额不按时长或人数推算。"><InputNumber min={0.01} max={100000} step={0.01} changeOnBlur={false} /></Form.Item><Form.Item name="sortOrder" label="排序" rules={numberRule(0, 10000)}><InputNumber min={0} max={10000} precision={0} /></Form.Item></div></>}
        {editor?.kind === 'schedule' && <Form.Item name="scheduleMode" label="排班方式" rules={[{ required: true }]} extra="跟随门店按营业时间接待，个人例外按本人启用班次接待；休假和已有占用始终扣除。"><Select options={[{ value: 'SHOP', label: '跟随门店营业时间' }, { value: 'CUSTOM', label: '个人例外排班' }]} /></Form.Item>}
        {editor?.kind === 'shifts' && <><Form.Item name="weekday" label="星期" rules={[{ required: true }]}><Select options={weekdays.map((label, value) => ({ label, value }))} /></Form.Item><div className="merchant-form-grid"><Form.Item name="startTime" label="开始时间（门店当地）" rules={[{ required: true }]}><Input type="time" /></Form.Item><Form.Item name="endTime" label="结束时间（HH:mm，可填24:00）" rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/ }]}><Input placeholder="18:00" /></Form.Item></div></>}
        {editor?.kind === 'rooms' && <><Form.Item name="name" label="场地名称" rules={[{ required: true, whitespace: true, max: 100 }]}><Input maxLength={100} /></Form.Item><Form.Item name="roomType" label="场地类型" rules={[{ required: true }]}><Select options={Object.entries(roomLabels).map(([value, label]) => ({ value, label }))} /></Form.Item><Typography.Paragraph type="secondary">容量： {formRoomType === 'COUPLE' ? 2 : 1}。每笔预约独占使用。</Typography.Paragraph></>}
        {(editor?.kind === 'time-off' || editor?.kind === 'maintenance') && <><Alert type="info" showIcon title={`门店当地时间：${config?.timezone ?? '缺少时区'}`} description="按UTC保存，夏令时跳过或重复的时间将被拒绝。" style={{ marginBottom: 16 }} /><Form.Item name="startLocal" label="开始日期与时间" rules={[{ required: true }]}><Input type="datetime-local" step={60} /></Form.Item><Form.Item name="endLocal" label="结束日期与时间" rules={[{ required: true }]}><Input type="datetime-local" step={60} /></Form.Item><Form.Item name="reason" label="原因" rules={[{ max: 500 }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item></>}
        {editor && ['variants', 'shifts', 'rooms'].includes(editor.kind) && <Form.Item name="isActive" label="已启用" valuePropName="checked"><Switch /></Form.Item>}
      </Form>
    </Modal>
  </div>;
}

function PaymentPolicyPanel({ config, saving, onSave }: { config: ReservationConfig; saving: boolean; onSave: (enabled: boolean) => Promise<void> }) {
  const enabled = config.paymentPolicy?.payAtStoreEnabled;
  const [value, setValue] = useState(enabled === true);
  useEffect(() => { setValue(enabled === true); }, [enabled]);
  useEffect(() => {
    if (value === enabled) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [value, enabled]);
  return <Card title="到店付款规则" extra={<Button type="primary" disabled={saving || typeof enabled !== 'boolean' || value === enabled} loading={saving} onClick={() => void onSave(value)}>保存规则</Button>}><Space wrap><Switch checked={value} disabled={saving || typeof enabled !== 'boolean'} onChange={setValue} aria-label="允许到店付预约" /><Typography.Text strong>允许顾客到店付款</Typography.Text>{value !== enabled && <Tag color="gold">规则尚未保存</Tag>}</Space><Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>新门店默认关闭。待接受预约仅短暂保留资源，接受后继续保留，但不代表已收款；完成服务须收齐款项且服务已结束。请在预约详情登记实际收款与退款。这些记录仅登记事实，不发起退款或银行转账。现有预约保留原付款方式。</Typography.Paragraph></Card>;
}

function OpeningHours({ config, saving, canWrite, onLifecycleChange, onReconcile, onSave }: { config: ReservationConfig; saving: boolean; canWrite: () => boolean; onLifecycleChange: (state: HoursEditorState) => void; onReconcile: () => Promise<BusinessHours>; onSave: (hours: BusinessHours) => Promise<BusinessHours> }) {
  const [hours, setHours] = useState(() => hoursDraft(config.businessHours)), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const [source, setSource] = useState(''), [targets, setTargets] = useState<string[]>([]), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<HoursRecovery>('NONE');
  const [modal, modalContext] = Modal.useModal();
  const draftDirty = useRef(false);
  const recoveryRef = useRef<HoursRecovery>('NONE');
  const mounted = useRef(true), operation = useRef(false);
  // Delayed controls must belong to this exact draft and copy-day selection.
  const view = useRef({ hours, source, targets }); view.current = { hours, source, targets };
  const currentView = () => view.current.hours === hours && view.current.source === source && view.current.targets === targets;
  const replaceHours = (next: HoursDraft) => { view.current = { ...view.current, hours: next }; setHours(next); };
  const replaceSelection = (nextSource: string, nextTargets: string[]) => {
    view.current = { ...view.current, source: nextSource, targets: nextTargets }; setSource(nextSource); setTargets(nextTargets);
  };
  const publish = () => onLifecycleChange({ dirty: draftDirty.current, busy: operation.current, unknown: recoveryRef.current !== 'NONE' });
  const editable = () => mounted.current && currentView() && !saving && !operation.current && recoveryRef.current === 'NONE' && canWrite();
  const disabled = saving || busy || recovery !== 'NONE' || !canWrite();
  useEffect(() => {
    mounted.current = true;
    onLifecycleChange({ dirty: draftDirty.current, busy: operation.current, unknown: recoveryRef.current !== 'NONE' });
    return () => { mounted.current = false; onLifecycleChange({ dirty: false, busy: false, unknown: false }); };
  }, [onLifecycleChange]);
  useEffect(() => {
    // A policy/resource refresh must not erase an hours draft that has not been saved.
    if (!draftDirty.current) { replaceHours(hoursDraft(config.businessHours)); setDirty(false); }
  }, [config]);
  const change = (day: string, periods: HoursDraft[string]) => {
    if (!editable()) return;
    replaceHours({ ...hours, [day]: periods }); draftDirty.current = true; setDirty(true); setNotice(''); publish();
  };
  const copy = async () => {
    if (!editable()) return;
    operation.current = true; setBusy(true); publish();
    try {
      const next = copyHoursDays(hours, source, targets);
      const label = (day: string) => weekdays[dayKeys.indexOf(day)];
      if (!await modal.confirm({ title: '替换草稿中所选日期的营业时间？', content: `${label(source)} ${hours[source].length ? `(${hours[source].length}个营业时段)` : '（休息，将移除营业时段）'} → ${targets.map(label).join(', ')}。其他日期保持不变。点击“保存营业时间”后才会保存。`, okText: '复制到所选日期', cancelText: '保留草稿' })) return;
      if (!mounted.current || !canWrite()) return;
      replaceHours(next); draftDirty.current = true; setDirty(true); setError(''); replaceSelection(source, []); publish();
      setNotice('已仅复制到草稿的所选日期，请核对后保存营业时间。');
    } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { if (mounted.current) { operation.current = false; setBusy(false); publish(); } }
  };
  const discard = async () => {
    if (!editable() || !draftDirty.current) return;
    operation.current = true; setBusy(true); publish();
    try {
      if (!await modal.confirm({ title: '放弃营业时间修改？', content: '仅放弃当前未保存的营业时间草稿，恢复为已读取的门店设置，不修改服务器资料。', okText: '放弃修改', cancelText: '继续编辑', okButtonProps: { danger: true } })) return;
      if (!mounted.current || !canWrite()) return;
      replaceHours(hoursDraft(config.businessHours)); draftDirty.current = false; setDirty(false); replaceSelection('', []); setError(''); setNotice('已放弃未保存修改。'); publish();
    } finally { if (mounted.current) { operation.current = false; setBusy(false); publish(); } }
  };
  const save = async () => {
    if (!editable() || !draftDirty.current) return;
    operation.current = true; setBusy(true); publish();
    try {
      const payload = hoursPayload(hours);
      setError(''); const saved = await onSave(payload);
      if (!mounted.current || !canWrite()) return;
      replaceHours(hoursDraft(saved)); draftDirty.current = false; setDirty(false); setNotice(''); publish();
    } catch (e) {
      if (mounted.current) {
        if (e instanceof HoursSaveError) { recoveryRef.current = e.outcome; setRecovery(e.outcome); publish(); }
        setError(errorMessage(e));
      }
    }
    finally { if (mounted.current) { operation.current = false; setBusy(false); publish(); } }
  };
  const reconcile = async () => {
    if (!mounted.current || !currentView() || saving || operation.current || !canWrite()) return;
    operation.current = true; setBusy(true); publish();
    try {
      const saved = await onReconcile();
      if (!mounted.current || !canWrite()) return;
      const matchesDraft = JSON.stringify(saved) === JSON.stringify(hoursPayload(hours));
      if (!matchesDraft && !await modal.confirm({
        title: '使用服务器营业时间结束当前草稿？',
        content: <><Typography.Paragraph>{recoveryRef.current === 'UNKNOWN' ? '原保存请求的结果未能确认，重新核对不会取消原请求。以下为刚读取的服务器设置；确认后将替换本地草稿，继续操作前请核对。' : '以下为刚读取的服务器设置。确认后将替换本地草稿，不会再次提交保存。'}</Typography.Paragraph><Typography.Paragraph style={{ whiteSpace: 'pre-line' }}>{formatBusinessHours(saved)}</Typography.Paragraph></>,
        okText: '使用服务器设置', cancelText: '保留草稿',
      })) { if (mounted.current) setNotice('已读取服务器设置，当前草稿仍保留；请再次核对后明确选择。'); return; }
      if (!mounted.current || !canWrite()) return;
      replaceHours(hoursDraft(saved)); draftDirty.current = false; setDirty(false); recoveryRef.current = 'NONE'; setRecovery('NONE'); replaceSelection('', []); setError(''); setNotice(matchesDraft ? '已核对服务器营业时间与提交草稿一致。' : '已按确认使用最新服务器营业时间。'); publish();
    } catch (cause) { if (mounted.current) setError('未能重新核对营业时间，当前草稿仍保留。' + errorMessage(cause)); }
    finally { if (mounted.current) { operation.current = false; setBusy(false); publish(); } }
  };
  return <Card title="每周营业时间" extra={<Space wrap>{dirty && <Tag color="gold">未保存</Tag>}<Button disabled={disabled || !dirty} onClick={() => void discard()}>放弃修改</Button><Button type="primary" loading={saving || busy} disabled={disabled || !dirty} onClick={() => void save()}>保存营业时间</Button></Space>}>{modalContext}<Typography.Paragraph type="secondary">每周营业时段使用当地时区： {config.timezone || '本店'}。不营业的日期不包含时段。员工排班单独配置；影响现有预约的修改将被拒绝。</Typography.Paragraph>
    <div style={{ padding: 16, border: '1px solid #e5eaf0', borderRadius: 12, marginBottom: 16 }}>
      <Typography.Text strong>复用某日营业时间</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>请选择来源日与要替换的准确日期。来源日休息时，目标日也将明确设为休息；不会复制员工排班或其他门店资料。</Typography.Paragraph>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
        <label>来源日期<Select aria-label="营业时间来源日期" value={source || undefined} disabled={disabled} placeholder="请选择来源日期" style={{ width: '100%', marginTop: 6 }} options={dayKeys.map((value, i) => ({ value, label: weekdays[i] }))} onChange={value => { if (editable()) replaceSelection(value, targets.filter(day => day !== value)); }} /></label>
        <label>目标日期<Select aria-label="营业时间目标日期" mode="multiple" value={targets} disabled={disabled || !source} placeholder="请选择要替换的日期" style={{ width: '100%', marginTop: 6 }} options={dayKeys.filter(day => day !== source).map(value => ({ value, label: weekdays[dayKeys.indexOf(value)] }))} onChange={value => { if (editable() && source) replaceSelection(source, value); }} /></label>
      </div><Button style={{ marginTop: 12 }} disabled={disabled || !source || !targets.length} onClick={() => void copy()}>复制到所选日期</Button>
    </div>
    {recovery !== 'NONE' && <Alert type="warning" showIcon title={recovery === 'SAVED' ? '营业时间已保存，等待回读核对' : '营业时间保存结果尚未确认'} description="草稿保留期间不会自动重复保存。请先只读核对服务器设置；核对失败仍会保留草稿。" action={<Button disabled={saving || busy || !canWrite()} loading={busy} onClick={() => void reconcile()}>重新核对服务器设置</Button>} />}
    {error && <Alert type="error" showIcon title={error} />}{notice && <Alert type="info" showIcon title={notice} />}
    {dayKeys.map((day, index) => <div className="merchant-hours-row" key={day}><strong>{weekdays[index]}</strong><div>{hours[day].length ? hours[day].map((row, position) => <Space wrap key={position} style={{ marginBottom: 8 }}><Input aria-label={`${weekdays[index]}开始时间${position + 1}`} type="time" value={row.open} disabled={disabled} onChange={event => change(day, hours[day].map((item, i) => i === position ? { ...item, open: event.target.value } : item))} /><span>–</span><Input aria-label={`${weekdays[index]}结束时间${position + 1}`} type="time" value={row.close} disabled={disabled} onChange={event => change(day, hours[day].map((item, i) => i === position ? { ...item, close: event.target.value } : item))} /><Button disabled={disabled} onClick={() => change(day, hours[day].filter((_, i) => i !== position))}>移除</Button></Space>) : <Tag>休息</Tag>}<Button disabled={disabled || hours[day].length >= 4} onClick={() => change(day, [...hours[day], { open: '', close: '' }])}>新增时段</Button></div></div>)}</Card>;
}
