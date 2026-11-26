import { durationFieldLabel, durationHelp, serviceKindDraftChange, serviceDurationLabel, SERVICE_DURATION_LABELS } from '../utils/serviceDuration';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, RefreshCw, Search, X } from 'lucide-react';
import { createResource, deleteResource, listResourcePage, PublicationCheck, ResourceId, ResourceQuery, reviewStore, StoreReviewAction, updateResource } from '../api/resources';
import { OperationConfig, OperationColumn, OperationField } from '../config/operations';
import { useConfirmation } from './Confirmation';
import ResourcePicker from './ResourcePicker';
import BookingReservationActions from './BookingReservationActions';
import { bookingServiceSummary } from '../utils/bookingReception';
import CatalogImport from './CatalogImport';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycleListener } from './store/businessScope';
import { useAuthStore } from '../stores/authStore';
import { buildOperationPayload, visibleOperationFields, localPublicationInput, operationFieldMinLength } from '../utils/operationForm';
import { merchantAccountCreatePayload, newMerchantAccountDraft } from '../utils/merchantAccountDraft';
import { bookingTimestamp } from '../utils/bookingTimestamp';
import { giftTimestamp } from '../utils/giftTimestamp';
import { localReservationTime } from '../utils/reservationForm';
import type { BookingDetail } from '../types/bookingDetails';
import { ApiError } from '../api/session';
import { readinessId } from '../api/shopReadiness';
import { locationPage, locationPageSize } from '../utils/adminLocation';
import { SETTING_ERROR_MESSAGES, settingField, settingValueError, settingWriteUncertain, verifiedSetting } from '../utils/platformSettings';

type RecordItem = Record<string, unknown> & { id: ResourceId };
const orderStatuses = { PENDING: '待确认', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消', REFUNDING: '退款中', REFUNDED: '已退款' };
function statusText(resource: string, key: string, value: string) {
  let labels: Record<string, string> = {};
  if (key === 'paymentStatus') labels = { UNPAID: '未支付', PAID: '已支付', PARTIALLY_REFUNDED: '部分退款', REFUNDED: '已退款' };
  else if (key === 'paymentMode') labels = { ONLINE: '在线预付', PAY_AT_STORE: '到店付款', ZERO: '零额结算' };
  else if (key === 'role') labels = { ADMIN: '平台管理员', MERCHANT: '商家', STAFF: '门店员工', CUSTOMER: '顾客' };
  else if (key === 'durationKind') labels = SERVICE_DURATION_LABELS;
  else if (key === 'category') labels = { MASSAGE: '按摩', REFLEXOLOGY: '足疗', CUPPING: '拔罐', SCRAPING: '刮痧', HEAD_THERAPY: '头疗', MIXED: '组合服务', OTHER: '其他' };
  else if (key === 'scope') labels = { ALL: '全部', USERS: '顾客', MERCHANTS: '商家与员工' };
  else if (key === 'publicationState') labels = { DRAFT:'草稿/停用',SCHEDULED:'待发布',LIVE:'展示中',EXPIRED:'已过期' };
  else if (key === 'type' && resource === 'content') labels = { INFO:'普通',IMPORTANT:'重要',URGENT:'紧急' };
  else if (key === 'targetType') labels = { NONE:'仅展示',SHOP_DETAIL:'门店详情',CATEGORY:'服务类型',COUPON_CENTER:'优惠券中心',EXTERNAL_URL:'外部页面' };
  else if (key === 'status') {
    if (['service-orders', 'after-sales'].includes(resource)) labels = orderStatuses;
    else if (resource === 'applications') labels = { PENDING: '待审核', APPROVED: '已发布', REJECTED: '已拒绝', SUSPENDED: '已停用' };
    else if (['users', 'admins', 'merchants'].includes(resource)) labels = { ACTIVE: '启用', SUSPENDED: '禁用', DELETED: '已删除' };
    else if (resource === 'technicians') labels = { ACTIVE: '启用', INACTIVE: '停用' };
    else if (resource === 'gift-cards') labels = { DRAFT: '草稿', ACTIVE: '已启用配置', PAUSED: '已停用配置' };
    else if (resource === 'withdrawals') labels = { PENDING: '待处理', COMPLETED: '已完成', FAILED: '失败' };
    else if (resource === 'gift-card-orders') labels = { PENDING: '待支付', PAID: '已支付', CANCELLED: '已取消', COMPLETED: '已完成', REFUNDING: '退款中', REFUNDED: '已退款' };
  }
  return Object.keys(labels).length ? labels[value] ?? '待核对' : value;
}
function money(value: unknown, currency: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return '—';
  const amount = (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? amount + ' ' + currency.toUpperCase() : amount + '（币种未提供）';
}
function localTime(item: RecordItem, key: string) {
  if (key === 'endTime' && typeof item.startTime === 'string' && typeof item.endTime === 'string' && typeof item.shopTimezone === 'string') {
    try {
      const start = localReservationTime(item.startTime, item.shopTimezone), end = localReservationTime(item.endTime, item.shopTimezone);
      if (start.slice(0, 10) !== end.slice(0, 10)) return end.replace('T', ' ');
    } catch { /* Keep the existing explicit fallback for incomplete historical snapshots. */ }
  }
  const local = item[key === 'startTime' ? 'localStartTime' : 'localEndTime'];
  if (typeof local === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(local)) return local.slice(0, 5);
  const value = item[key];
  if (typeof value !== 'string' || !value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (typeof item.shopTimezone === 'string' && item.shopTimezone) {
    try { return new Intl.DateTimeFormat('zh-CN', { timeZone: item.shopTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date); } catch { /* Keep the original instant when the snapshot is invalid. */ }
  }
  return date.toISOString() + '（预约时区未提供）';
}
function display(item: RecordItem, column: OperationColumn, config: OperationConfig) {
  const value = item[column.key];
  if (config.resource === 'services' && ['priceCents', 'durationMin'].includes(column.key) && item.hasVariants !== false) return item.hasVariants === true ? column.key === 'priceCents' ? '按规格定价' : '以所选规格为准' : '规格待核对';
  if (config.resource === 'services' && column.key === 'durationMin' && typeof value === 'number') return serviceDurationLabel(item.durationKind, value);
  if (value == null || value === '') return '—';
  if (column.kind === 'boolean') return typeof value === 'boolean' ? value ? '是' : '否' : '—';
  if (column.kind === 'cents') return money(value, item.currency ?? config.defaultCurrency);
  if (column.kind === 'list') return Array.isArray(value) ? value.map(String).join(', ') || '—' : '—';
  if (column.kind === 'time') return localTime(item, column.key);
  if (column.kind === 'dateOnly') {
    const date = item.localDate ?? value;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) return '—';
    return date.slice(0, 10) + (!item.localDate && !item.shopTimezone ? '（原记录日期，预约时区未提供）' : '');
  }
  if (column.kind === 'date' && typeof value === 'string') {
    if (config.resource === 'service-orders') return bookingTimestamp(value, item.shopTimezone);
    if (config.resource === 'gift-card-orders') return giftTimestamp(value, item.timezone);
    const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) + '（本机时间）';
  }
  if (typeof value === 'string') return column.key === 'currency' ? value.toUpperCase() : statusText(config.resource, column.key, value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return '—';
}
function publicationChecks(item: RecordItem): PublicationCheck[] {
  return Array.isArray(item.publicationChecklist) ? item.publicationChecklist.filter((check): check is PublicationCheck => check != null && typeof check === 'object' && typeof check.key === 'string' && typeof check.label === 'string' && typeof check.complete === 'boolean') : [];
}
function PublicationStatus({ item }: { item: RecordItem }) {
  const checks = publicationChecks(item); const missing = checks.filter(check => !check.complete);
  return <div className="min-w-48 max-w-xs space-y-1.5 text-xs leading-5"><p className={item.publicationReady === true ? 'font-medium text-teal-700' : 'font-medium text-amber-800'}>{item.publicationReady === true ? '发布资料齐全' : checks.length ? '待完善发布资料' : '未提供发布检查结果'}</p>{missing.length > 0 && <ul className="space-y-1 text-slate-600">{missing.map(check => <li key={check.key}>待补：{check.label}</li>)}</ul>}</div>;
}
function initialFilters(config: OperationConfig, query?: ResourceQuery) {
  const values: Record<string, string> = { search: typeof query?.search === 'string' ? query.search.trim().slice(0, 100) : '' };
  for (const filter of config.filters ?? []) {
    const incoming = query?.[filter.key]; const value = incoming == null ? filter.defaultValue ?? '' : String(incoming);
    values[filter.key] = filter.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '' : value === filter.allValue || filter.options?.some(option => option.value === value) ? value : filter.defaultValue ?? '';
  }
  return values;
}
export default function OperationalPage({ config, onEditStore, initialQuery, onQueryChange, onConfigureImportedService, explicitShopId, embedded = false, onLifecycleChange, onChanged, onManagePriceMenu, onOpenOrderAfterSales }: { config: OperationConfig; onEditStore?: (id: ResourceId) => void; initialQuery?: ResourceQuery; onQueryChange?: (query: ResourceQuery) => void; onConfigureImportedService?: (shopId: string, serviceId: string) => void; explicitShopId?: ResourceId; embedded?: boolean; onLifecycleChange?: BusinessLifecycleListener; onChanged?: () => void; onManagePriceMenu?: () => void; onOpenOrderAfterSales?: (target: { shopId: string; bookingId: string }, canContinue: () => boolean) => void }) {
  const confirm = useConfirmation();
  const { user } = useAuthStore();
  const shopScoped = ['services', 'technicians', 'service-orders', 'after-sales', 'gift-cards', 'gift-card-orders'].includes(config.resource);
  const scope = useBusinessScope(explicitShopId, shopScoped);
  const shopId = shopScoped ? scope.shopId : undefined;
  const [items, setItems] = useState<RecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(() => locationPage(initialQuery?.page));
  const [pageSize, setPageSize] = useState(() => locationPageSize(initialQuery?.pageSize, [25, 50, 100], 25));
  const [filterDraft, setFilterDraft] = useState(() => initialFilters(config, initialQuery));
  const [appliedFilters, setAppliedFilters] = useState(() => initialFilters(config, initialQuery));
  const [filterError, setFilterError] = useState('');
  const [details, setDetails] = useState<RecordItem | null>(null);
  const [detailBusy, setDetailBusy] = useState(false), [detailDirty, setDetailDirty] = useState(false);
  const [detailUnknown, setDetailUnknown] = useState(false);
  const detailOwner = useRef<{ key: string; id: string; verifiedShopId?: string; valid: () => boolean } | null>(null), closingDetail = useRef(false);
  const detailState = useRef({ busy: false, dirty: false, unknown: false });
  detailState.current = { busy: detailBusy, dirty: detailDirty, unknown: detailUnknown };
  const [reviewTarget, setReviewTarget] = useState<RecordItem | null>(null);
  const [reviewAction, setReviewAction] = useState<StoreReviewAction>('APPROVE');
  const [reviewReason, setReviewReason] = useState('');
  const [reviewFormError, setReviewFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const [createdMerchant, setCreatedMerchant] = useState<{ email: string; password: string } | null>(null);
  const [catalogImport, setCatalogImport] = useState<{ actorId: string; shopId?: string } | null>(null);
  const [reviewErrorId, setReviewErrorId] = useState<ResourceId | null>(null);
  const [editing, setEditing] = useState<RecordItem | null | undefined>(undefined);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [originalForm, setOriginalForm] = useState('');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const settingOperation = useRef<symbol | null>(null), settingUncertain = useRef(false);
  const [settingUnknown, setSettingUnknown] = useState(false), [settingReadback, setSettingReadback] = useState<RecordItem | null>(null);
  const writable = Boolean(config.fields?.length && (config.allowCreate || config.allowEdit));
  const accountResource = ['users', 'admins', 'merchants'].includes(config.resource);
  const selfAccount = accountResource && editing != null && String(editing.id) === String(user?.id);
  const formFields = (config.fields ?? []).map(field => config.resource === 'settings' && field.key === 'value' ? { ...field, ...settingField(editing?.key) } : config.resource === 'services' && field.key === 'durationMin' ? { ...field, label: durationFieldLabel(form.durationKind || undefined), hint: durationHelp(form.durationKind || undefined) } : field);
  const variantMetadataOnly = config.resource === 'services' && editing != null && editing.hasVariants === true;
  const editableFields = variantMetadataOnly ? formFields.filter(field => !['durationKind', 'durationMin', 'priceCents'].includes(field.key)) : formFields;
  const fields = visibleOperationFields(editableFields, Boolean(editing)).filter(field => !(embedded && field.key === 'shopId'));
  const hasActions = Boolean(config.allowEdit || config.allowDelete || config.allowReview || config.details?.length);
  const navigationFilters = JSON.stringify(initialFilters(config, initialQuery));
  const detailScopeKey = JSON.stringify([scope.actorId, shopId, config.resource, navigationFilters]);
  const owner = detailOwner.current;
  const detailView = useRef({ id: details ? String(details.id) : null, key: detailScopeKey });
  detailView.current = { id: details ? String(details.id) : null, key: detailScopeKey };
  const detailCurrent = () => !!owner && detailOwner.current === owner && detailView.current.id === owner.id && detailView.current.key === owner.key && owner.valid();
  const openDetails = (item: RecordItem) => {
    const valid = scope.capture();
    if (!valid() || detailState.current.busy || closingDetail.current || shopId != null && String(item.shopId) !== String(shopId)) return;
    detailOwner.current = { key: detailScopeKey, id: String(item.id), valid };
    closingDetail.current = false; setDetailBusy(false); setDetailDirty(false); setDetailUnknown(false); setDetails(item);
  };
  const acceptDetail = (updated: BookingDetail, refresh: boolean) => {
    if (!owner || !detailCurrent() || String(updated.id) !== owner.id) return;
    const updatedShop = (updated as BookingDetail & { shopId?: string }).shopId;
    if (updatedShop !== undefined && details?.shopId != null && String(updatedShop) !== String(details.shopId)) return;
    const verifiedShopId = String(updatedShop ?? details?.shopId ?? '');
    if (!refresh && readinessId(verifiedShopId) && (shopId == null || String(shopId) === verifiedShopId)) owner.verifiedShopId = verifiedShopId;
    setDetails(previous => previous && String(previous.id) === owner.id ? { ...previous, ...updated, shopTimezone: updated.timezone, serviceName: bookingServiceSummary(updated) } : previous);
    if (refresh) setReload(value => value + 1);
  };
  const orderAfterSalesTarget = owner?.verifiedShopId && readinessId(owner.id) ? { shopId: owner.verifiedShopId, bookingId: owner.id } : undefined;
  const canOpenOrderAfterSales = () => {
    const { busy, dirty, unknown } = detailState.current;
    return !!orderAfterSalesTarget && detailCurrent() && !closingDetail.current && !busy && !dirty && !unknown;
  };
  const editorDirty = editing !== undefined && JSON.stringify(form) !== originalForm;
  const clearEditor = () => { setEditing(undefined); setForm({}); setOriginalForm(''); setFormError(''); setFieldErrors({}); settingUncertain.current = false; setSettingUnknown(false); setSettingReadback(null); };
  const close = async () => {
    if (saving || settingOperation.current || settingUncertain.current) return;
    if (editorDirty && !await confirm({ title: config.resource === 'settings' ? '放弃平台设置草稿' : '放弃项目草稿', message: config.resource === 'settings' ? '当前平台设置修改尚未保存，是否关闭？' : '当前项目修改尚未保存，是否关闭？', confirmLabel: '放弃修改' })) return;
    if (config.resource === 'settings' && (settingOperation.current || settingUncertain.current)) return;
    clearEditor();
  };
  useEffect(() => { onLifecycleChange?.({ dirty: editorDirty || detailDirty, busy: saving || detailBusy || !!catalogImport, unknown: detailUnknown || settingUnknown }); }, [editorDirty, detailDirty, detailUnknown, settingUnknown, saving, detailBusy, catalogImport, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  useEffect(() => {
    settingOperation.current = null; settingUncertain.current = false; setSettingUnknown(false); setSettingReadback(null);
  }, [config.resource, scope.actorId]);
  useEffect(() => {
    if (config.resource !== 'settings' || !editorDirty && !settingUnknown) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [config.resource, editorDirty, settingUnknown]);
  const closeDetails = async () => {
    if (!detailCurrent() || detailState.current.busy || closingDetail.current) return;
    closingDetail.current = true; setDetailBusy(true);
    try {
      if (detailState.current.unknown) {
        if (!await confirm({ title: '关闭结果待核对的订单', message: '原请求仍可能完成，关闭不会撤销或重试原操作。本页面会话内重新打开该订单仍为只读。是否关闭详情并刷新列表？', confirmLabel: '关闭并刷新' }) || !detailCurrent()) return;
      } else if (detailState.current.dirty && (!await confirm({ title: '放弃订单编辑', message: '订单详情中有尚未保存的修改，是否关闭？', confirmLabel: '放弃修改' }) || !detailCurrent())) return;
      if (!detailCurrent()) return;
      const unknown = detailState.current.unknown;
      detailOwner.current = null; setDetails(null); setDetailBusy(false); setDetailDirty(false); setDetailUnknown(false);
      if (unknown) setReload(value => value + 1);
    } finally { if (detailOwner.current === owner || detailOwner.current === null) { closingDetail.current = false; if (detailCurrent()) setDetailBusy(false); } }
  };
  useEffect(() => { detailOwner.current = null; closingDetail.current = false; setDetailBusy(false); setDetailDirty(false); setDetailUnknown(false); }, [detailScopeKey]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const current = scope.capture();
    if (!scope.actorId || embedded && shopId == null) { setItems([]); setTotal(0); setLoading(false); return () => controller.abort(); }
    listResourcePage<RecordItem>(config.resource, { page, pageSize, ...appliedFilters, shopId }, controller.signal).then(result => {
      if (!controller.signal.aborted && current()) { setItems(result.items); setTotal(result.total); if (page > 1 && !result.items.length) setPage(Math.max(1, Math.ceil(result.total / pageSize))); }
    }).catch(err => { if (!controller.signal.aborted && current()) { setItems([]); setTotal(0); setError(err instanceof Error ? err.message : '数据加载失败'); } }).finally(() => { if (!controller.signal.aborted && current()) setLoading(false); });
    return () => controller.abort();
  }, [config.resource, page, pageSize, appliedFilters, reload, shopId, scope.actorId]);
  const previousShopId = useRef(shopId);
  useEffect(() => {
    if (String(previousShopId.current) !== String(shopId)) { setPage(1); setDetails(null); }
    previousShopId.current = shopId;
  }, [shopId]);
  useEffect(() => {
    setCreatedMerchant(null);
    const next = JSON.parse(navigationFilters) as Record<string, string>;
    setFilterDraft(next); setAppliedFilters(previous => JSON.stringify(previous) === navigationFilters ? previous : next);
    setPage(locationPage(initialQuery?.page)); setPageSize(locationPageSize(initialQuery?.pageSize, [25, 50, 100], 25));
    setFilterError(''); setDetails(null); setEditing(undefined); setReviewTarget(null); setFieldErrors({});
  }, [config.resource, navigationFilters, initialQuery?.page, initialQuery?.pageSize, scope.actorId]);
  useEffect(() => {
    if (!embedded) onQueryChange?.({ ...appliedFilters, page, pageSize, ...(shopId == null ? {} : { shopId }) });
  }, [appliedFilters, page, pageSize, shopId, embedded, onQueryChange]);
  useEffect(() => {
    if (editing === undefined && !details && !reviewTarget) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving && !detailBusy) { close(); void closeDetails(); setReviewTarget(null); } };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [editing, details, reviewTarget, saving, detailBusy, detailDirty]);
  const open = (item: RecordItem | null) => {
    if (saving || settingOperation.current || settingUncertain.current || !scope.capture()() || embedded && (shopId == null || item && String(item.shopId) !== String(shopId))) return;
    if (config.resource === 'services' && item && typeof item.hasVariants !== 'boolean') { setNotice('规格信息尚未核对，请重新加载本店服务后再编辑。'); return; }
    const values: Record<string, unknown> = {};
    visibleOperationFields(config.fields ?? [], Boolean(item)).forEach(field => { values[field.key] = field.type === 'password' ? '' : field.type === 'datetime-local' ? localPublicationInput(item?.[field.key]) : item?.[field.key] ?? (field.key === 'shopId' && shopScoped ? shopId : undefined) ?? field.defaultValue ?? (field.type === 'checkbox' ? false : field.type === 'references' ? [] : ''); });
    if (!item && config.resource === 'merchants') Object.assign(values, newMerchantAccountDraft());
    setCreatedMerchant(null);
    setForm(values); setOriginalForm(JSON.stringify(values)); setFormError(''); setFieldErrors({}); setNotice(''); setEditing(item);
  };
  const change = (key: string, value: unknown) => {
    if (config.resource === 'settings' && (settingOperation.current || settingUncertain.current)) return;
    setFieldErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
    setFormError('');
    setForm(previous => ({ ...previous, [key]: value, ...(key === 'shopId' ? { serviceIds: [] } : {}), ...(config.resource === 'services' && key === 'durationKind' && value !== '' ? serviceKindDraftChange(value, Boolean(editing)) : {}) }));
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (saving || editing === undefined || config.resource === 'settings' && (settingOperation.current || settingUncertain.current)) return;
    const current = scope.capture();
    if (!current() || embedded && (shopId == null || editing && String(editing.shopId) !== String(shopId))) return;
    setFormError(''); setFieldErrors({});
    if (config.resource === 'settings') {
      const code = settingValueError(editing?.key, form.value);
      if (code) { setFieldErrors({ value: SETTING_ERROR_MESSAGES[code] }); document.getElementById('operation-value')?.focus(); return; }
    }
    const adminEdit = config.resource === 'admins' ? editing : undefined;
    let payload: Record<string, unknown>;
    try {
      let payloadFields = editableFields;
      if (adminEdit) {
        const previousName = typeof adminEdit.name === 'string' ? adminEdit.name.trim() : '';
        payloadFields = editableFields.filter(field => {
          if (field.key === 'name') return String(form.name ?? '').trim() !== previousName;
          if (field.key === 'status') return form.status !== (adminEdit.status ?? '');
          return true;
        });
      }
      payload = buildOperationPayload(payloadFields, { ...form, ...(embedded && shopId != null ? { shopId } : {}) }, Boolean(editing));
      if (!editing && config.resource === 'merchants') payload = merchantAccountCreatePayload(payload, form.loginName);
    }
    catch (err) { setFormError(err instanceof Error ? err.message : '请检查表单。'); return; }
    if (adminEdit && Object.keys(payload).length === 0) {
      clearEditor();
      return;
    }
    if (accountResource && editing && payload.status === 'SUSPENDED' && editing.status !== 'SUSPENDED') {
      if (!await confirm({ title: '禁用账户', message: '禁用后服务器将撤销该账户的登录会话。是否继续？', confirmLabel: '禁用' })) return;
    }
    const token = Symbol('setting-write');
    if (config.resource === 'settings') settingOperation.current = token;
    setSaving(true);
    try {
      if (!current()) return;
      const saved = editing ? await updateResource(config.resource, editing.id, payload) : await createResource(config.resource, payload);
      if (!current()) return;
      if (config.resource === 'settings' && !verifiedSetting(saved, { id: editing?.id, key: editing?.key, value: String(payload.value) })) throw new ApiError('保存回执无法核对，请只读重新载入当前配置。');
      if (!editing && config.resource === 'merchants') setCreatedMerchant({ email: String(payload.email), password: String(payload.password) });
      clearEditor(); setNotice(accountResource ? '账户信息已保存。' : '记录已保存。'); setReload(value => value + 1); onChanged?.();
    } catch (err) {
      if (current()) {
        if (config.resource === 'settings' && settingWriteUncertain(err)) {
          settingUncertain.current = true; setSettingUnknown(true); setSettingReadback(null);
          setFormError('保存结果未知，已阻止重复提交。请只读重新载入当前值并明确结束本次核对；原草稿保留。');
        } else if (config.resource === 'settings' && err instanceof ApiError && err.fields?.value) {
          setFieldErrors({ value: err.fields.value }); document.getElementById('operation-value')?.focus();
        } else setFormError(err instanceof Error ? err.message : '保存失败，请重试。');
      }
    }
    finally { if (config.resource !== 'settings' || current() && settingOperation.current === token) { if (config.resource === 'settings') settingOperation.current = null; setSaving(false); setForm(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !(config.fields ?? []).some(field => field.key === key && field.type === 'password')))); } }
  };
  const readSetting = async () => {
    const current = scope.capture();
    if (config.resource !== 'settings' || !editing || !current() || !settingUncertain.current || settingOperation.current) return;
    const token = Symbol('setting-read'); settingOperation.current = token; setSaving(true); setSettingReadback(null);
    try {
      const result = await listResourcePage<RecordItem>('settings', { page: 1, pageSize: 100 });
      if (!current() || settingOperation.current !== token) return;
      const matches = result.items.filter(item => String(item.id) === String(editing.id));
      if (matches.length !== 1 || !verifiedSetting(matches[0], { id: editing.id, key: editing.key })) throw new Error('当前配置未完整返回，请稍后只读重试；原操作仍待核对。');
      setSettingReadback(matches[0]); setFormError('');
    } catch (cause) { if (current() && settingOperation.current === token) setFormError('只读核对失败，原操作仍待核对。' + (cause instanceof Error ? cause.message : '')); }
    finally { if (current() && settingOperation.current === token) { settingOperation.current = null; setSaving(false); } }
  };
  const finishSettingReview = async () => {
    const current = scope.capture();
    if (!current() || !settingUncertain.current || settingOperation.current || !settingReadback) return;
    const token = Symbol('setting-review'); settingOperation.current = token; setSaving(true);
    try {
      if (!await confirm({ title: '结束本次设置核对？', message: '请核对当前已保存值。原请求仍可能完成；结束不会撤销或重试原请求，原草稿将保留供你重新决定。', confirmLabel: '已核对，结束本次操作' }) || !current() || settingOperation.current !== token) return;
      settingUncertain.current = false; setSettingUnknown(false); setSettingReadback(null); setFormError(''); setReload(value => value + 1);
    } finally { if (current() && settingOperation.current === token) { settingOperation.current = null; setSaving(false); } }
  };
  const remove = async (item: RecordItem) => {
    const current = scope.capture();
    if (!current() || embedded && String(item.shopId) !== String(shopId)) return;
    if (saving || !await confirm({title:'确认停用',message:'停用后保留历史记录，并更新服务器上的可用状态。是否继续？',confirmLabel:'停用'})) return;
    if (!current()) return;
    setSaving(true); setError('');
    try { await deleteResource(config.resource, item.id); if (current()) { setReload(value => value + 1); onChanged?.(); } }
    catch (err) { setError(err instanceof Error ? err.message : '停用失败'); }
    finally { setSaving(false); }
  };
  const openReview = (item: RecordItem, action: StoreReviewAction) => {
    if (saving || !config.allowReview || config.resource !== 'applications') return;
    setReviewTarget(item); setReviewAction(action); setReviewReason(''); setReviewFormError('');
  };
  const review = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !reviewTarget || !config.allowReview || config.resource !== 'applications') return;
    const reason = reviewReason.trim();
    if ((reviewAction !== 'APPROVE' && !reason) || reason.length > 2000) { setReviewFormError('拒绝或要求补资料时须填写原因，最多 2000 字。'); return; }
    const expectedStatus = reviewAction === 'APPROVE' ? 'APPROVED' : reviewAction === 'REJECT' ? 'REJECTED' : 'PENDING';
    setSaving(true); setError(''); setNotice(''); setReviewErrorId(null);
    try {
      const saved = await reviewStore(reviewTarget.id, reviewAction, reason);
      if (String(saved.id) !== String(reviewTarget.id) || saved.status !== expectedStatus) throw new Error('服务器返回的审核结果与请求不一致，请刷新核对。');
      setNotice(reviewAction === 'APPROVE' ? '门店审核已通过并发布。' : reviewAction === 'REJECT' ? '门店申请已拒绝。' : '补资料说明已保存，门店保持待审核。');
      setReviewTarget(null); setReviewReason(''); setReviewFormError('');
      setReload(value => value + 1);
    } catch (err) { setReviewFormError(err instanceof Error ? err.message : '审核失败，请重试。'); setReviewErrorId(reviewTarget.id); }
    finally { setSaving(false); }
  };
  const renderField = (field: OperationField) => {
    const locked = Boolean(field.readOnly || editing && field.immutable || selfAccount && field.key === 'status' || config.resource === 'settings' && (saving || settingUnknown));
    const id = 'operation-' + field.key;
    const required = Boolean((field.required || !editing && field.requiredOnCreate) && !locked);
    const hint = selfAccount && field.key === 'status' ? '当前登录账户不可禁用。' : field.hint;
    const fieldError = fieldErrors[field.key];
    const describedBy = [hint ? id + '-hint' : '', fieldError ? id + '-error' : ''].filter(Boolean).join(' ') || undefined;
    const control = 'block w-full rounded-lg border border-slate-200 px-3 py-2.5 read-only:bg-slate-50 disabled:bg-slate-50';
    return <div key={field.key} className={'space-y-2 text-sm text-slate-600 ' + (['textarea','references','reference'].includes(field.type ?? '') ? 'sm:col-span-2' : '')}>
      <label htmlFor={id}>{field.label}{required ? ' *' : ''}{editing && field.immutable ? '（创建后不可更改）' : ''}</label>
      {field.type === 'reference' || field.type === 'references' ? <ResourcePicker resource={field.resource!} value={form[field.key]} onChange={value => change(field.key, value)} multiple={field.type === 'references'} shopId={field.parentKey ? form[field.parentKey] : undefined} required={required} disabled={locked} /> : field.type === 'checkbox' ? <input id={id} type="checkbox" disabled={locked} checked={Boolean(form[field.key])} onChange={event => change(field.key,event.target.checked)} className="ml-3" /> : field.type === 'textarea' ? <textarea id={id} rows={4} readOnly={locked} maxLength={field.maxLength} value={String(form[field.key] ?? '')} onChange={event => change(field.key,event.target.value)} required={required} className={control} /> : field.type === 'select' ? <select id={id} disabled={locked} value={String(form[field.key] ?? '')} onChange={event => change(field.key,event.target.value)} required={required} aria-describedby={describedBy} aria-invalid={Boolean(fieldError)} className={control}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input id={id} type={field.type ?? 'text'} readOnly={locked} min={field.min} max={field.max} step={field.type === 'number' || field.type === 'datetime-local' ? 1 : undefined} minLength={operationFieldMinLength(field)} maxLength={field.maxLength} pattern={field.pattern} autoComplete={field.type === 'password' ? 'new-password' : 'off'} value={String(form[field.key] ?? '')} onChange={event => change(field.key,event.target.value)} required={required} aria-describedby={describedBy} aria-invalid={Boolean(fieldError)} className={control} />}
      {config.resource === 'merchants' && !editing && field.key === 'password' && <div className="flex items-center gap-3 text-xs"><span>当前初始密码：<code className="select-all">{String(form.password ?? '')}</code></span><button type="button" disabled={saving} onClick={() => change('password', newMerchantAccountDraft().password)} className="text-teal-700 underline">重新生成</button></div>}
      {hint && <p id={id + '-hint'} className="text-xs leading-5 text-slate-500">{hint}</p>}
      {fieldError && <p id={id + '-error'} role="alert" className="text-sm text-red-700">{fieldError}</p>}
    </div>;
  };
  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (filterDraft.startDate && filterDraft.endDate && filterDraft.startDate > filterDraft.endDate) {
      setFilterError('预约结束日期不能早于开始日期。'); return;
    }
    setFilterError(''); setPage(1); setDetails(null);
    setAppliedFilters({ ...filterDraft, search: filterDraft.search.trim() });
  };
  const resetFilters = () => {
    const next = initialFilters(config);
    setFilterDraft(next); setAppliedFilters(next); setPage(1); setFilterError(''); setDetails(null);
  };
  const changeFilter = (key: string, value: string) => { setFilterDraft(previous => ({ ...previous, [key]: value })); setFilterError(''); };
  const renderValue = (item: RecordItem, column: OperationColumn) => {
    if (column.kind === 'checklist') return <PublicationStatus item={item} />;
    if (column.kind === 'schedule') return <div className="min-w-44 space-y-1 text-xs leading-5"><p className="font-medium text-slate-800">{display(item, { key: 'bookingDate', label: '', kind: 'dateOnly' }, config)}</p><p>{localTime(item, 'startTime')} – {localTime(item, 'endTime')}</p><p className="text-slate-500">{typeof item.shopTimezone === 'string' && item.shopTimezone ? item.shopTimezone : '预约时区未提供'}</p></div>;
    if (column.key === 'shopTimezone' && !item.shopTimezone) return '预约时区未提供';
    if (column.key === 'cancelReason' && item.status === 'CANCELLED') {
      return typeof item.cancelReason === 'string' && item.cancelReason.trim() ? item.cancelReason : '未记录取消原因';
    }
    const value = display(item, column, config);
    return ['status', 'paymentStatus'].includes(column.key) ? <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{value}</span> : value;
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const columnCount = config.columns.length + (hasActions ? 1 : 0);
  const hasFilters = config.searchable !== false || Boolean(config.filters?.length);
  return <div className={embedded ? "space-y-5" : "app-page"}>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="page-heading">{config.title}</h1><p className="page-description">{config.description}</p></div><div className="flex flex-wrap gap-3">{config.resource === 'services' && onManagePriceMenu && <button type="button" onClick={onManagePriceMenu} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white"><Plus className="h-4 w-4" />进入服务与价格工作区</button>}{config.resource === 'services' && user?.role === 'ADMIN' && <button type="button" onClick={() => setCatalogImport({ actorId: String(user.id), shopId: shopId == null ? undefined : String(shopId) })} className="store-secondary-button"><FileSpreadsheet className="h-4 w-4" />导入停用服务草稿</button>}{config.resource !== 'services' && writable && config.allowCreate && <button type="button" onClick={() => open(null)} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white"><Plus className="h-4 w-4" />新增</button>}</div></div>
    {!writable && !config.allowReview && <p className="text-sm leading-6 text-slate-500">{config.resource === 'service-orders' ? '可在订单详情中为符合条件的预约改期。' : '当前页面仅提供查询。'}</p>}
    <form onSubmit={applyFilters} className="surface-panel space-y-3 p-5">
      <div className="flex flex-wrap items-end gap-3">
        {config.searchable !== false && <label className="min-w-0 flex-[1_1_240px] space-y-2 text-sm text-slate-500"><span>关键词</span><input type="search" maxLength={100} value={filterDraft.search} onChange={event => changeFilter('search', event.target.value)} placeholder={config.searchPlaceholder ?? '按名称查询'} className="block w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>}
        {(config.filters ?? []).map(filter => <label key={filter.key} className="min-w-[145px] flex-[1_1_145px] space-y-2 text-sm text-slate-500"><span>{filter.label}</span>{filter.type === 'date' ? <input type="date" value={filterDraft[filter.key] ?? ''} onChange={event => changeFilter(filter.key, event.target.value)} className="block w-full rounded-lg border border-slate-200 px-3 py-2.5" /> : <select value={filterDraft[filter.key] ?? ''} onChange={event => changeFilter(filter.key, event.target.value)} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5"><option value={filter.allValue ?? ''}>全部</option>{filter.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</label>)}
        {hasFilters && <><button type="submit" className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm text-white"><Search className="h-4 w-4" />查询</button><button type="button" onClick={resetFilters} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600">重置</button></>}
        <button type="button" disabled={loading} onClick={() => { setDetails(null); setReload(value => value + 1); }} className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 disabled:opacity-50"><RefreshCw className="h-4 w-4" />刷新</button>
      </div>
      {config.filters?.some(filter => filter.key === 'startDate') && <p className="text-xs leading-5 text-slate-500">日期按门店当地的预约日期筛选，包含起止当日。修改条件后点击查询生效。</p>}
      {filterError && <p role="alert" className="text-sm text-red-700">{filterError}</p>}
    </form>
    {error && <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p>{error}</p>{reviewErrorId != null && onEditStore && <button type="button" disabled={saving} onClick={() => onEditStore(reviewErrorId)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm">编辑门店资料后重新审核</button>}</div>}
    {notice && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800">{notice}</p>}
    {createdMerchant && <div role="status" className="space-y-2 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800"><p>登录邮箱：{createdMerchant.email}</p><p>初始密码：<code className="select-all">{createdMerchant.password}</code></p><button type="button" onClick={() => setCreatedMerchant(null)} className="underline">隐藏本次登录资料</button></div>}
    <section className="surface-panel overflow-hidden" aria-label={config.title}>
      <div className="overflow-x-auto"><table className={'w-full text-left ' + (config.details?.length ? 'min-w-[1600px]' : 'min-w-[850px]')}><thead><tr>{config.columns.map(column => <th key={column.key}>{column.label}</th>)}{hasActions && <th>操作</th>}</tr></thead><tbody className="divide-y divide-slate-100">
        {loading ? <tr><td colSpan={columnCount} role="status" className="py-12 text-center text-slate-500">正在加载…</td></tr> : !items.length ? <tr><td colSpan={columnCount} className="py-12 text-center text-slate-400">{error ? '数据未加载' : '暂无记录'}</td></tr> : items.map(item => <tr key={item.id} className="hover:bg-slate-50">{config.columns.map(column => <td key={column.key} className="max-w-sm whitespace-normal break-words text-slate-600">{renderValue(item, column)}</td>)}{hasActions && <td className="whitespace-nowrap">
          {config.details?.length && <button type="button" onClick={() => openDetails(item)} className="mr-3 text-teal-700">查看详情</button>}
          {config.resource !== 'services' && writable && config.allowEdit && <button type="button" disabled={saving} onClick={() => open(item)} className="mr-3 text-teal-700">编辑</button>}
          {config.resource === 'services' && onConfigureImportedService && <button type="button" disabled={saving} onClick={() => onConfigureImportedService(String(item.shopId), String(item.id))} className="mr-3 text-teal-700">编辑服务与价格</button>}
          {config.allowReview && item.status === 'PENDING' && <><button type="button" disabled={saving || item.publicationReady !== true} title={item.publicationReady === true ? '服务器将在提交时再次核验' : '请先完善发布检查中的待补资料'} onClick={() => openReview(item, 'APPROVE')} className="mr-3 text-teal-700 disabled:cursor-not-allowed disabled:text-slate-400">审核并发布</button><button type="button" disabled={saving} onClick={() => openReview(item, 'REJECT')} className="mr-3 text-red-600">拒绝</button><button type="button" disabled={saving} onClick={() => openReview(item, 'REQUEST_INFO')} className="mr-3 text-slate-600">要求补资料</button></>}
          {config.allowReview && onEditStore && <button type="button" disabled={saving} onClick={() => onEditStore(item.id)} className="text-slate-600">查看 / 完善资料</button>}
          {config.allowDelete && config.resource !== 'services' && <button type="button" disabled={saving} onClick={() => void remove(item)} className="text-red-600">停用</button>}
        </td>}</tr>)}
      </tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-sm text-slate-500"><span>{loading || error ? '—' : '共 ' + total + ' 条'} · 第 {page} / {pages} 页</span><div className="flex items-center gap-2"><select aria-label="每页条数" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); setDetails(null); }} className="rounded-lg border border-slate-200 px-2 py-2">{[25, 50, 100].map(size => <option key={size} value={size}>{size} 条 / 页</option>)}</select><button type="button" aria-label="上一页" disabled={loading || page <= 1} onClick={() => { setPage(value => value - 1); setDetails(null); }} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="下一页" disabled={loading || page >= pages} onClick={() => { setPage(value => value + 1); setDetails(null); }} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>
    </section>
    {reviewTarget && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/35 p-3 sm:p-6"><section role="dialog" aria-modal="true" aria-labelledby="shop-review-title" className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"><header className="flex items-center justify-between gap-4 border-b border-slate-100 p-5"><h2 id="shop-review-title" className="text-lg font-semibold text-slate-900">{reviewAction === 'APPROVE' ? '审核并发布门店' : reviewAction === 'REJECT' ? '拒绝门店申请' : '要求补资料'}</h2><button type="button" disabled={saving} onClick={() => setReviewTarget(null)} aria-label="关闭审核表单" className="rounded-lg p-2 text-slate-500"><X className="h-5 w-5" /></button></header><form onSubmit={review} className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6"><div><p className="font-medium text-slate-800">{String(reviewTarget.name ?? '门店 #' + reviewTarget.id)}</p><p className="mt-1 text-xs leading-5 text-slate-500">{reviewAction === 'APPROVE' ? '提交后服务器将重新核验发布条件，审核通过后才会对外发布。' : reviewAction === 'REJECT' ? '门店将标记为已拒绝，资料与审核原因保留。' : '门店保持待审核，并保存需要补充的资料说明。'}</p></div><PublicationStatus item={reviewTarget} />{typeof reviewTarget.reviewComment === 'string' && reviewTarget.reviewComment && <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">此前审核说明：{reviewTarget.reviewComment}</p>}<label className="block space-y-2 text-sm text-slate-600"><span>审核说明{reviewAction === 'APPROVE' ? '（选填）' : ' *'}</span><textarea rows={4} maxLength={2000} required={reviewAction !== 'APPROVE'} value={reviewReason} onChange={event => { setReviewReason(event.target.value); setReviewFormError(''); }} className="block w-full rounded-lg border border-slate-200 px-3 py-2.5" placeholder={reviewAction === 'REQUEST_INFO' ? '说明需要补充哪些资料' : '填写本次审核原因'} /></label>{reviewFormError && <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{reviewFormError}</p>{reviewErrorId != null && onEditStore && <button type="button" disabled={saving} onClick={() => { setReviewTarget(null); onEditStore(reviewErrorId); }} className="rounded-lg border border-red-200 bg-white px-3 py-2">查看 / 完善门店资料</button>}</div>}<footer className="flex justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" disabled={saving} onClick={() => setReviewTarget(null)} className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm">取消</button><button type="submit" disabled={saving} className={'rounded-lg px-5 py-2.5 text-sm text-white disabled:opacity-50 ' + (reviewAction === 'REJECT' ? 'bg-red-600' : 'bg-brand')}>{saving ? '正在提交…' : reviewAction === 'APPROVE' ? '审核并发布' : reviewAction === 'REJECT' ? '确认拒绝' : '保存补资料说明'}</button></footer></form></section></div>}
    {details && config.details && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/35 p-3 sm:p-6"><section role="dialog" aria-modal="true" aria-labelledby="order-detail-title" className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"><header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5"><div><h2 id="order-detail-title" className="text-lg font-semibold text-slate-900">订单详情</h2><p className="mt-1 text-xs leading-5 text-slate-500">订单资料先显示列表快照，读取并核对预约明细后同步更新；金额和支付记录分别保留。</p></div><button type="button" disabled={detailBusy} onClick={() => void closeDetails()} aria-label="关闭订单详情" className="rounded-lg p-2 text-slate-500"><X className="h-5 w-5" /></button></header><div className="min-h-0 flex-1 overflow-y-auto"><dl className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2 sm:p-6">{config.details.map(column => <div key={column.key} className={'min-w-0 space-y-2 ' + (['notes', 'cancelReason'].includes(column.key) ? 'sm:col-span-2' : '')}><dt className="text-xs text-slate-500">{column.label}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{renderValue(details, column)}</dd></div>)}</dl>{config.resource === 'service-orders' && <BookingReservationActions key={detailScopeKey + ":" + String(details.id)} scopeKey={detailScopeKey} expectedShopId={details.shopId == null ? undefined : String(details.shopId)} onBusyChange={value => { if (detailCurrent()) { detailState.current.busy = value; setDetailBusy(value); } }} onDirtyChange={value => { if (detailCurrent()) { detailState.current.dirty = value; setDetailDirty(value); } }} onUnknownChange={value => { if (detailCurrent()) { detailState.current.unknown = value; setDetailUnknown(value); } }} bookingId={String(details.id)} onSnapshot={updated => acceptDetail(updated, false)} onUpdated={updated => acceptDetail(updated, true)} />}</div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-4">
        {config.resource === 'service-orders' && onOpenOrderAfterSales && <>
          <button type="button" disabled={!canOpenOrderAfterSales()} onClick={() => {
            if (orderAfterSalesTarget && canOpenOrderAfterSales()) onOpenOrderAfterSales(orderAfterSalesTarget, canOpenOrderAfterSales);
          }} className="rounded-lg border border-teal-200 px-4 py-2.5 text-sm font-medium text-teal-700 disabled:opacity-40">查看关联售后工单</button>
          {!canOpenOrderAfterSales() && <span className="text-xs text-slate-500">{detailBusy ? '请等待当前操作完成。' : detailUnknown ? '请先核对订单操作结果。' : detailDirty ? '请先保存或取消订单编辑。' : '预约明细核对后可查看工单。'}</span>}
        </>}
        <button type="button" disabled={detailBusy} onClick={() => void closeDetails()} className="ml-auto rounded-lg border border-slate-200 px-5 py-2.5 text-sm disabled:opacity-40">关闭</button>
      </footer>
    </section></div>}
    {editing !== undefined && writable && config.resource !== 'services' && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/35 p-4"><section role="dialog" aria-modal="true" aria-labelledby="operation-dialog-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void close(); } if (event.key === 'Tab') { event.stopPropagation(); const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(item => item.getClientRects().length > 0); if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); } } }} className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 id="operation-dialog-title" className="text-lg font-semibold text-slate-900">{editing ? '编辑' : '新增'}{config.resource === 'users' ? '用户账户' : config.title}</h2><button type="button" disabled={saving || settingUnknown} onClick={close} aria-label="关闭表单" className="rounded-lg p-2 text-slate-400"><X className="h-5 w-5" /></button></div><form onSubmit={save} noValidate={config.resource === 'settings'} className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6">
      {config.resource === 'settings' && <p className="text-sm text-slate-500">{String(editing?.label ?? editing?.key ?? '')}</p>}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">{variantMetadataOnly && <p className="rounded-lg bg-teal-50 p-3 text-xs leading-6 text-teal-800">本服务已有独立规格。这里仅修改主项目资料与启停；时长和价格请使用列表中的“编辑实际规格”。</p>}{fields.map(renderField)}</div>
      {formError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
      {config.resource === 'settings' && settingUnknown && <div role="status" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>保存结果未知；请先核对当前已保存值，原草稿保留。</p>{settingReadback && <p className="break-all">当前已保存值：{String(settingReadback.value) || '（空）'}</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={readSetting} className="rounded-lg border border-amber-300 px-3 py-2">只读重新载入并核对</button><button type="button" disabled={saving || !settingReadback} onClick={finishSettingReview} className="rounded-lg border border-amber-300 px-3 py-2">已核对，结束本次操作</button></div></div>}
      <div className="flex justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" disabled={saving || settingUnknown} onClick={close} className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm">取消</button><button type="submit" disabled={saving || settingUnknown} className="rounded-lg bg-brand px-5 py-2.5 text-sm text-white disabled:opacity-50">{saving ? '正在保存…' : '保存'}</button></div>
    </form></section></div>}
    {catalogImport && user?.role === 'ADMIN' && config.resource === 'services' && <CatalogImport actorId={catalogImport.actorId} fixedShopId={catalogImport.shopId} onClose={() => setCatalogImport(null)} onImported={receipt => { setNotice('门店 #' + receipt.shopId + ' 已新增 ' + receipt.summary.createdServices + ' 个停用项目和 ' + receipt.summary.createdVariants + ' 个停用规格。'); setReload(value => value + 1); onChanged?.(); }} onConfigure={(targetShopId, serviceId) => { setCatalogImport(null); onConfigureImportedService?.(targetShopId, serviceId); }} />}
  </div>;
}
