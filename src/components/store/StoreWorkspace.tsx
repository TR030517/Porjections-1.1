import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCheck, Clock3, Eye, Image, Info, LayoutGrid, Save, ShieldCheck, Store, Users, X } from 'lucide-react';
import { createResource, listResourcePage, updateResource } from '../../api/resources';
import type { ResourceId } from '../../api/resources';
import { useConfirmation } from '../Confirmation';
import ResourcePicker from '../ResourcePicker';
import StoreCustomerPreview from './StoreCustomerPreview';
import StoreMediaEditor from './StoreMediaEditor';
import StoreHoursEditor from './StoreHoursEditor';
import StoreTimezonePicker from './StoreTimezonePicker';
import { storeZipStateConflict } from '../../utils/storeTimezones';
import { initiallyAutoMatchTimezone, matchDraftTimezone } from './storeTimezoneDraft';
import StorePublicLink from './StorePublicLink';
import StoreAddressAutocomplete from './StoreAddressAutocomplete';
import { buildStoreSavePayload, draftFingerprint, draftFromStore, STATUS } from './storeModel';
import type { StoreDraft, StoreItem } from './types';
import { MediaDraftSession, type MediaDraftTransport, type MediaPurpose } from '../../utils/mediaDraft';
import { abandonShopMedia, confirmShopMedia, previewShopMedia, uploadShopMedia } from '../../api/mediaUploads';
import { subscribeSession } from '../../api/session';
import { ApiError } from '../../api/session';
import type { ReadinessAction } from '../../api/shopReadiness';
import StoreReadiness from './StoreReadiness';
import StoreBusinessSettings, { type StoreBusinessTarget } from './StoreBusinessSettings';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycle } from './businessScope';
import { storeAccountSummary } from '../../utils/storeAccountStatus';
import StoreAccountCredentials from './StoreAccountCredentials';
import StoreOrderEmailSettingsAdmin from './StoreOrderEmailSettingsAdmin';
import type { StoreAccountCredentials as AccountCredentials } from '../../api/accountAccess';
import StoreServiceWorkspace from './StoreServiceWorkspace';
import type { ServiceWorkspaceApi, StoreServiceWorkspaceProps, WorkspaceReceipt, WorkspaceSnapshot } from '../../types/serviceWorkspace';
import { getProjectCatalog } from '../../api/projectCatalog';
import { readServiceWorkspace, saveServiceWorkspace, readServiceWorkspaceOperation, reconcileServiceWorkspaceOperation } from '../../api/reservations';
import { workspaceProfileMenu } from '../../utils/serviceWorkspaceProfile';
import ShopBookingSettingsEditor from './ShopBookingSettingsEditor';
import { SHOP_BRAND_COLORS } from '../../utils/shopBranding';
import type { ShopBrandColor } from '../../utils/shopBranding';

export type StoreBusinessView = 'services' | 'technicians' | 'service-orders' | 'reservation-settings';
export type StoreWorkspaceLifecycleListener = (state: BusinessLifecycle, readCurrent?: () => BusinessLifecycle) => void;
type SectionId = 'basic' | 'brand' | 'price-menu' | 'hours' | 'business' | 'review';
const SECTIONS: { id: SectionId; label: string; icon: typeof Store }[] = [
  { id: 'review', label: '营业准备', icon: ShieldCheck },
  { id: 'basic', label: '基本资料', icon: Store },
  { id: 'brand', label: '品牌展示', icon: Image },
  { id: 'price-menu', label: '服务与价格', icon: LayoutGrid },
  { id: 'hours', label: '营业设置', icon: Clock3 },
  { id: 'business', label: '技师与营业资源', icon: Users },
];
export function workspaceSectionBlock(current: string, next: string, project: BusinessLifecycle, business: BusinessLifecycle): 'project' | 'business' | null {
  if (current === next) return null;
  if (project.dirty || project.busy || project.unknown) return 'project';
  return next !== 'business' && (business.dirty || business.busy || business.unknown) ? 'business' : null;
}
export function workspaceUnknownTarget(project: BusinessLifecycle): 'price-menu' | 'business' {
  return project.unknown ? 'price-menu' : 'business';
}
const control = 'store-control';
const boundOwnerError = '该经营账号已绑定门店。请选择未绑定的商家账号，或新建账号后回来继续。';
const createMerchantAccountLink = '?module=merchant-list&tab=accounts';
function Field({ label, children, wide = false, hint }: { label: string; children: React.ReactNode; wide?: boolean; hint?: string }) {
  return <div className={wide ? 'sm:col-span-2' : ''}><label className="block space-y-2 text-sm text-slate-600"><span className="font-medium">{label}</span>{children}</label>{hint && <p className="mt-2 text-xs leading-5 text-slate-400">{hint}</p>}</div>;
}
function Block({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="store-form-block"><div className="mb-5"><h3 className="text-base font-semibold text-slate-800">{title}</h3>{description && <p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>}</div><div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2">{children}</div></section>;
}
function errorSection(message: string): SectionId {
  if (/展示价目表/.test(message)) return 'price-menu';
  if (/「基本资料」/.test(message)) return 'basic';
  if (/标签|地图/.test(message)) return 'basic';
  if (/图片|相册|Logo|横幅|视频|标签|HTTPS|URL|媒体/i.test(message)) return 'brand';
  if (/时区|地址|城市|州\/省/.test(message)) return 'basic';
  if (/营业|时间/.test(message)) return 'hours';
  if (/拒绝|审核|发布状态/.test(message)) return 'review';
  return 'basic';
}

interface PendingProfileSave { payload: Record<string, unknown>; shopId: ResourceId | null; shortName: string; ownerId: string; }
function validProfile(value: unknown): value is StoreItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as StoreItem;
  return row.id != null && row.ownerId != null && ['name', 'shortName', 'subtitle', 'timezone', 'address', 'city', 'state', 'zipCode', 'about'].every(key => typeof row[key as keyof StoreItem] === 'string')
    && Object.hasOwn(STATUS, row.status) && ['phones', 'emails', 'gallery', 'tags'].every(key => Array.isArray(row[key as keyof StoreItem]) && (row[key as keyof StoreItem] as unknown[]).every(value => typeof value === 'string'))
    && !!row.businessHours && typeof row.businessHours === 'object' && !Array.isArray(row.businessHours) && !!row.features && typeof row.features.onlineBooking === 'boolean' && typeof row.features.reviews === 'boolean'
    && Array.isArray(row.priceMenu) && /^[a-f0-9]{64}$/.test(row.priceMenuRevision ?? '');
}
function sameProfileValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) return !!actual && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => sameProfileValue((actual as Record<string, unknown>)[key], value));
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => sameProfileValue(actual[index], value));
  return actual === expected || (expected === '' && actual == null);
}
function submittedProfileMatches(row: StoreItem, pending: PendingProfileSave) {
  return Object.entries(pending.payload).every(([key, value]) => key === 'expectedPriceMenuRevision' || key === 'catalogSelectionPreconditions' || sameProfileValue(key === 'reviewReason' ? row.reviewComment : row[key as keyof StoreItem], value));
}
function uncertainProfileError(error: unknown) { return !(error instanceof ApiError) || !error.status || error.status === 408 || error.status >= 500; }

export default function StoreWorkspace({ item, isStoreManager, onClose, onSaved, onReadinessAction, onManageAccountAccess, initialSection, onCopySettings, initialBusinessTarget, onLifecycleChange }: {
  item: StoreItem | null;
  isStoreManager: boolean;
  onClose: () => void;
  onSaved: (saved: StoreItem) => void;
  onNavigateStore?: (view: StoreBusinessView, item: StoreItem) => void;
  onManageAccountAccess?: (item: StoreItem) => void;
  onReadinessAction?: (action: ReadinessAction, item: StoreItem) => void;
  initialSection?: SectionId;
  initialBusinessTarget?: StoreBusinessTarget;
  onCopySettings?: (item: StoreItem) => void;
  onLifecycleChange?: StoreWorkspaceLifecycleListener;
}) {
  const confirm = useConfirmation();
  const scope = useBusinessScope(item?.id ?? 'new-store');
  const saveInFlight = useRef(false);
  const pendingProfile = useRef<PendingProfileSave | null>(null);
  const recoveryInFlight = useRef(false), reviewInFlight = useRef(false);
  const [pendingSave, setPendingSave] = useState<PendingProfileSave | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [profileReview, setProfileReview] = useState<{ row: StoreItem | null; creating: boolean } | null>(null);
  const [draft, setDraft] = useState(() => draftFromStore(item));
  const [autoMatchTimezone, setAutoMatchTimezone] = useState(() => initiallyAutoMatchTimezone(item?.timezone ?? ''));
  const zipStateConflict = storeZipStateConflict(draft.state, draft.zipCode);
  const temporaryLocation = /pending update/i.test(draft.city) || /pending update/i.test(draft.state) || draft.zipCode.trim() === '00000' || draft.address.trim().toLowerCase() === 'address pending update';
  const [baseline, setBaseline] = useState(item);
  const baselineRef = useRef(baseline); baselineRef.current = baseline;
  const [savedFingerprint, setSavedFingerprint] = useState(() => draftFingerprint(draftFromStore(item)));
  const [tab, setTab] = useState<SectionId>(initialBusinessTarget ? 'business' : initialSection ?? (item && !isStoreManager ? 'review' : 'basic'));
  const currentProfileEvent = useRef({ tab, draft, baseline });
  currentProfileEvent.current = { tab, draft, baseline };
  const [businessTarget, setBusinessTarget] = useState<StoreBusinessTarget | undefined>(initialBusinessTarget);
  const [businessOnlyState, setBusinessState] = useState<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const [projectState, setProjectState] = useState<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const [bookingSettingsState, setBookingSettingsState] = useState<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const [accountState, setAccountState] = useState<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const [orderEmailState, setOrderEmailState] = useState<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const childLifecycles = useRef({ business: EMPTY_BUSINESS_LIFECYCLE, project: EMPTY_BUSINESS_LIFECYCLE, booking: EMPTY_BUSINESS_LIFECYCLE, account: EMPTY_BUSINESS_LIFECYCLE, orderEmail: EMPTY_BUSINESS_LIFECYCLE });
  const businessChangedState = useCallback((state: BusinessLifecycle) => { childLifecycles.current.business = state; setBusinessState(state); }, []);
  const projectChangedState = useCallback((state: BusinessLifecycle) => { childLifecycles.current.project = state; setProjectState(state); }, []);
  const bookingChangedState = useCallback((state: BusinessLifecycle) => { childLifecycles.current.booking = state; setBookingSettingsState(state); }, []);
  const accountChangedState = useCallback((state: BusinessLifecycle) => { childLifecycles.current.account = state; setAccountState(state); }, []);
  const orderEmailChangedState = useCallback((state: BusinessLifecycle) => { childLifecycles.current.orderEmail = state; setOrderEmailState(state); }, []);
  const businessState = { dirty: businessOnlyState.dirty || projectState.dirty || bookingSettingsState.dirty || accountState.dirty || orderEmailState.dirty, busy: businessOnlyState.busy || projectState.busy || bookingSettingsState.busy || accountState.busy || orderEmailState.busy, unknown: businessOnlyState.unknown || projectState.unknown || bookingSettingsState.unknown || accountState.unknown || orderEmailState.unknown };
  const [projectVisited, setProjectVisited] = useState(initialSection === 'price-menu');
  const [projectFocus, setProjectFocus] = useState<StoreServiceWorkspaceProps['focus']>(() => initialBusinessTarget?.serviceId && (initialBusinessTarget.tab === 'services' || initialBusinessTarget.reservationTab === 'services')
    ? { serviceId: initialBusinessTarget.serviceId, pane: initialBusinessTarget.reservationTab === 'services' ? 'booking' : 'metadata', revision: 0 } : undefined);
  const projectFocusRevision = useRef(0);
  const [businessVisited, setBusinessVisited] = useState(!!initialBusinessTarget);
  const [businessMessage, setBusinessMessage] = useState('');
  const [readinessRevision, setReadinessRevision] = useState(0);
  const businessChanged = useCallback(() => { setReadinessRevision(value => value + 1); }, []);
  const accountSaved = (value: AccountCredentials) => {
    if (!item || value.userId === null) return;
    const patch = { accountBindingStatus: 'BOUND' as const, loginBinding: { shopId: String(item.id), userId: value.userId }, loginAccount: { id: value.userId, name: item.loginAccount?.name ?? item.name, loginName: null, email: value.email, status: value.accountStatus ?? undefined } };
    setBaseline(previous => previous ? { ...previous, ...patch } : previous); onSaved({ ...item, ...patch }); setReadinessRevision(value => value + 1);
  };
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (pendingProfile.current || saveInFlight.current) return;
    setDraft(previous => matchDraftTimezone(previous, autoMatchTimezone));
  }, [draft.city, draft.state, draft.zipCode, autoMatchTimezone]);
  const [showPreview, setShowPreview] = useState(false);
  const [closing, setClosing] = useState(false);
  const [uploading,setUploading]=useState(false);
  const alive=useRef(true),uploadLocked=useRef(false);
  const [media] = useState(() => item ? new MediaDraftSession(String(item.id), {
    upload: (file, purpose, key) => uploadShopMedia(String(item.id), file, purpose, key),
    confirm: confirmShopMedia,
    preview: previewShopMedia,
    abandon: abandonShopMedia,
  }) : null);
  useEffect(() => {
    alive.current = true;
    media?.activate();
    const leaveMedia = () => {
      if (pendingProfile.current || saveInFlight.current) media?.releasePreviews();
      else void media?.dispose();
    };
    const unsubscribe = subscribeSession(user => { if (!user) leaveMedia(); });
    return () => {
      alive.current = false;
      unsubscribe();
      leaveMedia();
    };
  }, [media]);
  const upload=async(file:File,purpose:MediaPurpose)=>{if(!media||uploadLocked.current||saveInFlight.current||pendingProfile.current)throw new Error('请先完成门店保存结果核对，再上传图片。');uploadLocked.current=true;setUploading(true);try{const url=await media.upload(file,purpose);if(!alive.current)throw new Error('当前工作室已关闭。');return url;}finally{uploadLocked.current=false;if(alive.current)setUploading(false);}};
  const dialog = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const dirty = draftFingerprint(draft) !== savedFingerprint;
  const liveNavigation = useRef(EMPTY_BUSINESS_LIFECYCLE);
  liveNavigation.current = { dirty, busy: saving || uploading || closing || recovering, unknown: !!pendingSave };
  const readLifecycle = useCallback(() => {
    const states = Object.values(childLifecycles.current), own = liveNavigation.current;
    return { dirty: own.dirty || states.some(state => state.dirty), busy: own.busy || saveInFlight.current || recoveryInFlight.current || reviewInFlight.current || uploadLocked.current || states.some(state => state.busy), unknown: !!pendingProfile.current || states.some(state => state.unknown) };
  }, []);
  useLayoutEffect(() => {
    onLifecycleChange?.(readLifecycle(), readLifecycle);
  }, [dirty, saving, uploading, closing, recovering, pendingSave, businessState.dirty, businessState.busy, businessState.unknown, onLifecycleChange, readLifecycle]);
  useLayoutEffect(() => () => onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  const set = <K extends keyof StoreDraft>(key: K, value: StoreDraft[K]) => {
    if (pendingProfile.current || saveInFlight.current || closing) return;
    setDraft(previous => ({ ...previous, [key]: value })); setNotice('');
  };
  const rematchTimezone = () => {
    if (pendingProfile.current || saveInFlight.current) return;
    const matched = matchDraftTimezone(draft, true);
    if (!matched.timezone) { setFormError('无法按当前地址匹配时区，请核对城市和州，或手动选择门店时区。'); return; }
    setDraft(matched);
    setAutoMatchTimezone(true); setNotice('');
  };
  const projectOwner = useMemo(() => scope.captureEvent(), [item?.id, scope.actorId, scope.captureEvent]);
  const projectCurrent = useCallback(() => alive.current && projectOwner(), [projectOwner]);
  const projectApi = useMemo<ServiceWorkspaceApi>(() => {
    const scoped = async (operation: () => Promise<unknown>) => {
      const current = scope.capture();
      if (!item || !projectCurrent() || !current()) throw Error('当前门店或登录状态已变化。');
      const result = await operation();
      if (!alive.current || !current()) throw Error('当前门店或登录状态已变化，未接收原请求结果。');
      return result;
    };
    const shopId = String(item?.id ?? '');
    return {
      loadCatalog: (query, signal) => scoped(() => getProjectCatalog(shopId, query, signal)),
      loadSnapshot: (serviceId, signal) => scoped(() => readServiceWorkspace(shopId, serviceId, signal)),
      save: command => scoped(() => saveServiceWorkspace(shopId, command)),
      readReceipt: (key, signal) => scoped(() => readServiceWorkspaceOperation(shopId, key, signal)),
      reconcile: (key, signal) => scoped(() => reconcileServiceWorkspaceOperation(shopId, key, signal)),
    };
  }, [item?.id, projectCurrent, scope.capture]);
  const projectMedia = useMemo<MediaDraftTransport | undefined>(() => {
    if (!item) return;
    const shopId = String(item.id);
    return {
      upload: (file, purpose, key) => uploadShopMedia(shopId, file, purpose, key),
      confirm: confirmShopMedia,
      preview: previewShopMedia,
      abandon: abandonShopMedia,
    };
  }, [item?.id]);
  const discardProjectMedia = useRef<(() => Promise<number>) | null>(null);
  const registerProjectMediaDiscard = useCallback((discard: (() => Promise<number>) | null) => {
    discardProjectMedia.current = discard;
  }, []);
  const savedShopImages = [baseline?.logoUrl ?? '', baseline?.bannerUrl ?? '', ...(baseline?.gallery ?? [])];
  const beforeProjectWrite = () => {
    const others = [childLifecycles.current.business, childLifecycles.current.booking, childLifecycles.current.account, childLifecycles.current.orderEmail];
    // Profile inputs are an independent draft. They may stay dirty while a
    // service is saved, but a profile write/unknown result cannot race it.
    return projectCurrent() && !pendingProfile.current && !saveInFlight.current && !recoveryInFlight.current && !reviewInFlight.current && !uploadLocked.current && !saving && !uploading && !closing
      && !others.some(state => state.dirty || state.busy || state.unknown);
  };
  const projectSaved = useCallback(({ snapshot }: { snapshot: WorkspaceSnapshot; receipt: WorkspaceReceipt }) => {
    if (!item || snapshot.shopId !== String(item.id) || !projectCurrent() || pendingProfile.current || saveInFlight.current) throw Error('门店上下文已变化，请保留服务回执后重新核对。');
    const menu = workspaceProfileMenu(snapshot.priceMenu);
    const confirmed = baselineRef.current ? { ...baselineRef.current, priceMenu: menu, priceMenuRevision: snapshot.priceMenuRevision } : null;
    if (!confirmed) throw Error('门店资料基线缺失，请保留服务回执后重新核对。');
    baselineRef.current = confirmed; setBaseline(confirmed);
    setSavedFingerprint(previous => { const original = JSON.parse(previous) as StoreDraft; return draftFingerprint({ ...original, priceMenu: menu }); });
    setDraft(previous => ({ ...previous, priceMenu: menu }));
    onSaved(confirmed);
    setReadinessRevision(value => value + 1);
  }, [item?.id, projectCurrent, onSaved]);
  const focusProject = (serviceId: string | undefined, pane: 'metadata' | 'booking') => {
    setProjectFocus(serviceId ? { serviceId, pane, revision: ++projectFocusRevision.current } : undefined);
    setProjectVisited(true); setTab('price-menu'); setShowPreview(false);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    title.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!dirty && !uploading && !saving && !pendingSave && !businessState.dirty && !businessState.busy && !businessState.unknown) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty,uploading,saving,pendingSave,businessState]);
  const leave = async (next: () => void) => {
    const current = scope.capture();
    if (!alive.current || !current() || pendingProfile.current || saveInFlight.current || saving || closing || uploadLocked.current || readLifecycle().busy) return;
    if (accountState.unknown || orderEmailState.unknown) { setBusinessMessage(orderEmailState.unknown ? '请先在预约通知收件邮箱中核对原操作结果，再关闭门店工作室。' : '请先在商家账号密码设置中核对原保存结果，再关闭门店工作室。'); setTab('basic'); setShowPreview(false); return; }
    if (businessState.unknown) { setBusinessMessage('请先核对并明确结束结果未知的业务草稿，再关闭门店工作室。'); const target = workspaceUnknownTarget(projectState); if (target === 'price-menu') { setProjectVisited(true); setShowPreview(false); } setTab(target); return; }
    setClosing(true);
    try {
      if ((dirty || businessState.dirty) && !await confirm({ title: '离开门店工作室', message: '当前有未保存的修改。离开将放弃本次编辑，已保存的资料保留。', confirmLabel: '放弃修改并离开' })) return;
      if (!alive.current || !current() || pendingProfile.current || saveInFlight.current || uploadLocked.current || Object.values(childLifecycles.current).some(state => state.busy || state.unknown)) return;
      if(media&&await media.cleanup()){setFormError('部分未保存文件暂未清理完成，请重试关闭。原有已保存图片不受影响。');return;}
      if (await discardProjectMedia.current?.()) { setBusinessMessage('部分价目草稿图片暂未清理完成，请重试关闭。'); return; }
      if (!alive.current || !current() || pendingProfile.current || saveInFlight.current || uploadLocked.current || Object.values(childLifecycles.current).some(state => state.busy || state.unknown)) return;
      next();
    } finally { if (alive.current && current()) setClosing(false); }
  };
  const switchTab = (next: SectionId) => { if(pendingProfile.current||saveInFlight.current||uploading||saving||closing)return; if (next !== tab && (orderEmailState.dirty || orderEmailState.busy || orderEmailState.unknown)) { setBusinessMessage(orderEmailState.unknown ? '请先核对预约通知邮箱原操作结果，再切换分区。' : orderEmailState.busy ? '预约通知邮箱操作尚未完成，请稍后切换。' : '请先完成或放弃通知邮箱草稿，再切换分区。'); return; } if (next !== tab && (accountState.dirty || accountState.busy || accountState.unknown)) { setBusinessMessage(accountState.unknown ? '请先核对商家账号原保存结果，再切换分区。' : accountState.busy ? '商家账号正在保存，请稍后切换。' : '请先保存或放弃商家账号草稿，再切换分区。'); return; } if (bookingSettingsState.dirty || bookingSettingsState.busy || bookingSettingsState.unknown) { setBusinessMessage(bookingSettingsState.unknown ? '请先重新载入并核对预约设置保存结果，再切换分区。' : bookingSettingsState.busy ? '预约设置正在保存，请稍后切换。' : '请先保存预约提前时间/临时闭店设置，再切换分区。'); return; } if (workspaceSectionBlock(tab, next, projectState, businessOnlyState)) { setBusinessMessage(businessState.unknown ? '请先核对并明确结束结果未知的业务草稿，再切换分区。' : businessState.busy ? '当前业务操作尚未完成，请稍后切换。' : '请先保存或取消当前业务草稿，再切换分区。'); return; } setBusinessMessage(''); if (next === 'business') setBusinessVisited(true); if (next === 'price-menu') setProjectVisited(true); setTab(next); setShowPreview(false); };
  const acceptProfile = async (saved: StoreItem, current: () => boolean) => {
    const next = draftFromStore(saved);
    pendingProfile.current = null; setPendingSave(null); setProfileReview(null);
    setDraft(next); setAutoMatchTimezone(initiallyAutoMatchTimezone(next.timezone)); setBaseline(saved); setSavedFingerprint(draftFingerprint(next)); setFormError(''); setNotice('门店资料已保存。营业准备已按保存后的资料更新。');
    onSaved(saved); setReadinessRevision(value => value + 1);
    if (media) {
      try { if (await media.saved([saved.logoUrl ?? '', saved.bannerUrl ?? '', ...(saved.gallery ?? []), ...next.priceMenu.flatMap(group => group.items.map(row => row.imageUrl ?? ''))])) { if (alive.current && current()) setNotice('门店资料已保存；部分未使用的暂存文件清理待重试，关闭时会再次清理。'); } }
      catch { if (alive.current && current()) setNotice('门店资料已保存；暂存文件清理尚未完成，已保存的图片保留。'); }
    }
  };
  const reconcileProfile = async () => {
    const pending = pendingProfile.current, current = scope.capture();
    if (!pending || !alive.current || !current() || recoveryInFlight.current || saveInFlight.current || reviewInFlight.current) return;
    recoveryInFlight.current = true; setRecovering(true); setProfileReview(null); setFormError('');
    try {
      const page = await listResourcePage<StoreItem>('stores', pending.shopId === null ? { search: pending.shortName, pageSize: 100 } : { shopId: pending.shopId, pageSize: 1 });
      if (!alive.current || !current() || pendingProfile.current !== pending) return;
      if (page.items.some(row => !validProfile(row))) throw Error('返回的门店资料不完整，无法核对；当前草稿仍保留。');
      const row = pending.shopId === null ? page.items.find(row => row.shortName === pending.shortName && String(row.ownerId) === pending.ownerId) ?? null : page.items.find(row => String(row.id) === String(pending.shopId)) ?? null;
      if (pending.shopId !== null && row && submittedProfileMatches(row, pending)) { await acceptProfile(row, current); return; }
      setProfileReview({ row, creating: pending.shopId === null });
    } catch (error) { if (alive.current && current() && pendingProfile.current === pending) setFormError(error instanceof Error ? error.message : '只读核对失败，原保存结果仍未知。'); }
    finally { recoveryInFlight.current = false; if (alive.current && current()) setRecovering(false); }
  };
  const finishProfileReview = async () => {
    const pending = pendingProfile.current, current = scope.capture();
    if (!pending || !profileReview || !alive.current || !current() || recoveryInFlight.current || saveInFlight.current || reviewInFlight.current) return;
    reviewInFlight.current = true;
    try {
      const accepted = await confirm({ title: '结束门店资料核对', message: '当前读回结果不能证明原请求已失败。原请求仍可能迟到并写入门店；结束后保留当前草稿与上传文件，请先核对门店再决定是否重新保存。', confirmLabel: '结束核对并保留草稿' });
      if (!accepted || !alive.current || !current() || pendingProfile.current !== pending || recoveryInFlight.current || saveInFlight.current) return;
      pendingProfile.current = null; setPendingSave(null); setProfileReview(null); setFormError(''); setNotice('已结束本次核对，草稿与上传文件已保留。原请求仍可能迟到并写入门店，请核对后再决定是否重新保存。');
    } finally { reviewInFlight.current = false; }
  };
  const save = async (event: React.FormEvent) => {
    if (event.target !== event.currentTarget) return; event.preventDefault();
    const current = scope.capture();
    // A retained form handler must not submit an old draft or bypass a child
    // editor that became dirty/locked after that handler was rendered.
    const latest = currentProfileEvent.current;
    if (latest.tab !== tab || latest.draft !== draft || latest.baseline !== baseline || tab === 'price-menu' || !projectCurrent() || !current() || pendingProfile.current || saveInFlight.current || recoveryInFlight.current || reviewInFlight.current || Object.values(childLifecycles.current).some(state => state.dirty || state.busy || state.unknown) || liveNavigation.current.busy || saving || uploadLocked.current || closing || (item && !dirty)) return; setFormError(''); setNotice('');
    let payload: Record<string, unknown>;
    try { payload = buildStoreSavePayload(draft, { isStoreManager, editing: baseline }); if (item) { delete payload.priceMenu; delete payload.expectedPriceMenuRevision; } }
    catch (err) { const message = err instanceof Error ? err.message : '请检查门店资料。'; setFormError(message); setTab(errorSection(message)); setShowPreview(false); requestAnimationFrame(() => statusRef.current?.focus()); return; }
    const intent: PendingProfileSave = { payload: structuredClone(payload), shopId: item?.id ?? null, shortName: String(payload.shortName ?? draft.shortName), ownerId: String(payload.ownerId ?? item?.ownerId ?? draft.ownerId) };
    saveInFlight.current = true; setSaving(true);
    try {
      const saved = item ? await updateResource<StoreItem>('stores', item.id, payload) : await createResource<StoreItem>('stores', payload);
      if (!alive.current || !current()) return;
      if (!validProfile(saved) || (item && String(saved.id) !== String(item.id))) throw new Error('保存回执不完整，无法确认原保存结果。');
      await acceptProfile(saved, current);
    } catch (err) {
      if (!alive.current || !current()) return;
      if (uncertainProfileError(err)) {
        pendingProfile.current = intent; setPendingSave(intent); setProfileReview(null); setFormError('门店资料保存结果未知，当前输入及上传文件已保留。请只读核对原保存结果，暂勿重复提交。'); return;
      }
      const message = err instanceof Error ? err.message : '保存失败，请重试。';
      setShowPreview(false);
      if (message === '具有相同唯一值的记录已存在。') { setTab('basic'); setFormError('门店短链已被使用，请更换后重试。'); }
      else if (!item && message === '该经营账号已绑定门店，请新建独立门店账号') {
        setTab('basic');
        setFormError(boundOwnerError);
      } else setFormError(message);
      requestAnimationFrame(() => statusRef.current?.focus());
    }
    finally { saveInFlight.current = false; if (alive.current && current()) setSaving(false); }
  };
  const text = (key: keyof StoreDraft, label: string, options: { wide?: boolean; required?: boolean; maxLength?: number; placeholder?: string; type?: string; hint?: string } = {}) => <Field label={label} wide={options.wide} hint={options.hint}><input id={'store-' + key} type={options.type ?? 'text'} required={options.required} maxLength={options.maxLength} value={String(draft[key])} onChange={event => set(key, event.target.value as never)} placeholder={options.placeholder} className={control} /></Field>;
  const repair = (action: ReadinessAction) => {
    if (pendingProfile.current || saveInFlight.current || saving || closing || uploading) return false;
    if (action.kind === 'services' || action.kind === 'reservation' && action.tab === 'services') {
      if (businessState.dirty || businessState.busy || businessState.unknown) { setBusinessMessage('请先结束当前配置编辑。'); return false; }
      focusProject(action.kind === 'reservation' ? action.serviceId : undefined, 'booking'); return true;
    }
    if (action.kind === 'store-section') { switchTab(action.section); requestAnimationFrame(() => document.getElementById(action.section === 'review' ? 'store-status' : 'store-tab-' + action.section)?.focus()); }
    else if (action.kind === 'technicians' || action.kind === 'reservation') {
      if (businessState.dirty || businessState.busy || businessState.unknown) { setBusinessMessage('请先保存、取消或核对当前业务草稿，再打开修复项。'); return false; }
      setBusinessTarget(action.kind === 'reservation' ? { tab: 'reservations', reservationTab: action.tab, serviceId: action.serviceId, therapistId: action.therapistId } : { tab: action.kind }); setBusinessVisited(true); setTab('business'); setShowPreview(false);
    } else if (item && onReadinessAction) void leave(() => onReadinessAction(action, item));
    return true;
  };
  return <div className="store-studio-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="store-studio-title" className="store-studio" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void leave(onClose); }
    if (event.key === 'Tab') {
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0);
      if (!controls.length) return;
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === title.current)) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  }}>
    <header className="store-studio-header"><div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Store className="h-5 w-5" /></span><div className="min-w-0"><p className="text-xs font-medium tracking-wide text-slate-400">门店工作室</p><h2 ref={title} tabIndex={-1} id="store-studio-title" className="truncate text-lg font-semibold text-slate-900 outline-none">{item?.name || '创建新门店'}</h2></div></div><div className="flex shrink-0 items-center gap-3"><span className="hidden max-w-44 truncate rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-500 sm:block">{item?.canonicalPath || '门店短链待保存'}</span><button type="button" disabled={!!pendingSave || saving || closing || uploading || businessState.busy} onClick={() => void leave(onClose)} aria-label="关闭门店工作室" className="store-icon-button"><X className="h-5 w-5" /></button></div></header>
    {businessMessage && tab !== 'business' && <p role="alert" className="mx-5 mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{businessMessage}</p>}
    <div className="store-studio-toolbar"><div role="tablist" aria-label="门店设置分区" className="store-studio-tabs" onKeyDown={event=>{if(saving||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=SECTIONS.findIndex(section=>section.id===tab);const next=event.key==='Home'?0:event.key==='End'?SECTIONS.length-1:(index+(event.key==='ArrowRight'?1:-1)+SECTIONS.length)%SECTIONS.length;switchTab(SECTIONS[next].id);document.getElementById('store-tab-'+SECTIONS[next].id)?.focus();}}>{SECTIONS.map(section => <button key={section.id} id={'store-tab-' + section.id} type="button" role="tab" tabIndex={tab === section.id ? 0 : -1} aria-selected={tab === section.id} aria-controls={section.id === 'business' ? 'store-business-editor-panel' : section.id === 'price-menu' ? 'store-service-editor-panel' : 'store-editor-panel'} disabled={!!pendingSave || saving || uploading || closing} onClick={() => switchTab(section.id)} className={tab === section.id ? 'is-active' : ''}><section.icon className="h-4 w-4 shrink-0" />{section.label}</button>)}</div><button type="button" style={{ display: tab === 'business' ? 'none' : undefined }} onClick={() => setShowPreview(value => !value)} aria-pressed={showPreview} className="store-preview-toggle"><Eye className="h-4 w-4" />{showPreview ? '返回编辑' : '客户预览'}</button></div>
    <div className={"store-studio-body " + (tab === 'business' ? 'store-studio-business' : '')}><div className={'store-editor ' + (showPreview ? 'mobile-preview-active' : '')}>
      {pendingSave && <section role="alert" className="m-5 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
        <h3 className="font-semibold">门店资料保存结果未知</h3>
        <p>本次草稿及上传文件已保留。请先只读核对，核对期间不能修改、再次保存或离开工作室。</p>
        {pendingSave.shopId === null && <p>无法可靠确认原创建请求；同短链且同经营者的门店仅供核对，不会自动绑定为创建结果。</p>}
        {profileReview && (profileReview.row ? <div className="rounded-lg bg-white p-3"><p>当前门店记录：{profileReview.row.name}（#{profileReview.row.id}）</p><p>短链：{profileReview.row.shortName}</p><p>{profileReview.row.address}，{profileReview.row.city}，{profileReview.row.state} {profileReview.row.zipCode}</p><p>只读核对记录与本次提交不构成确定失败；原请求仍可能迟到。</p></div> : <p>{profileReview.creating ? '未找到可核对的同短链门店。' : '未找到本次保存的门店记录。'}当前查询不能证明原请求已失败。</p>)}
        <div className="flex flex-wrap gap-3"><button type="button" className="store-secondary-button" disabled={recovering} onClick={() => void reconcileProfile()}>{recovering ? '正在只读核对…' : '只读核对保存结果'}</button><button type="button" className="store-secondary-button" disabled={recovering || !profileReview} onClick={() => void finishProfileReview()}>结束核对并保留草稿</button></div>
      </section>}
      <form style={{ display: tab === 'business' || tab === 'price-menu' ? 'none' : undefined }} id="store-workspace-form" noValidate onSubmit={save} className="flex min-h-full flex-col" aria-label="门店资料编辑">
        <fieldset disabled={!!pendingSave || saving || uploading || closing} className="min-w-0 flex-1 border-0 p-0"><div id="store-editor-panel" role="tabpanel" aria-labelledby={'store-tab-' + tab} className="store-editor-content">
          {formError && <p ref={statusRef} tabIndex={-1} role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700 outline-none">
            {formError}
            {formError === boundOwnerError && <a href={createMerchantAccountLink} target="_blank" rel="noopener noreferrer" className="ml-2 font-medium underline">打开商家账号管理（新标签页）</a>}
          </p>}
          {notice && <p role="status" className="mb-5 flex items-start gap-2 rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm leading-6 text-teal-800"><CheckCheck className="mt-1 h-4 w-4 shrink-0" />{notice}</p>}
          {tab === 'basic' && <div className="mb-6"><StorePublicLink key={item?.canonicalPath ?? 'unsaved'} path={item?.canonicalPath} publicVisible={item?.publicVisible} draftPending={dirty} /></div>}
          {tab === 'basic' && temporaryLocation && <p role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">此店地点资料包含临时预填值，请核对并修改；时区可手动调整。</p>}
          {tab === 'basic' && <div className="space-y-6"><Block title="门店基本资料" description="让顾客快速认识你的门店。名称、介绍与联系方式会同步到右侧预览。">{text('name','门店名称 *',{required:true,maxLength:200,placeholder:'填写对外展示的门店名称'})}{text('shortName','唯一门店短链 *',{required:true,maxLength:100,placeholder:'例如 downtown-spa',hint:'3–100 个英文字母或数字，可用横线分隔；保存后统一小写。原短名会保留为别名。'})}{text('subtitle','一句话介绍',{wide:true,maxLength:500,placeholder:'用一句话介绍门店特色'})}<div className="sm:col-span-2"><Field label="门店介绍"><textarea id="store-about" rows={5} maxLength={20000} value={draft.about} onChange={event => set('about',event.target.value)} placeholder="介绍你的服务特色、环境与理念" className={control} /></Field></div><Field label="门店标签" wide hint="每行一个，最多 10 个，每个不超过 100 字。"><textarea id="store-tags" rows={2} value={draft.tags} onChange={event=>set('tags',event.target.value)} className={control} placeholder="深层按摩&#10;安静空间" /></Field></Block>
            <Block title="联系与位置" description="完整地址建议会填入街道、城市、州和邮编。新建或未设置时区的门店自动匹配；已保存的时区会保留，也可手动修改或按地址重新匹配。">
              <Field label="联系电话" hint="每行一条，最多 5 条。"><textarea id="store-phones" rows={2} value={draft.phones} onChange={event => set('phones',event.target.value)} className={control} placeholder="+1 555 000 0000" /></Field>
              <Field label="联系邮箱" hint="每行一条，最多 5 条；这些是顾客可见的公开联系邮箱。预约通知收件地址在下方单独验证设置，不修改登录邮箱。"><textarea id="store-emails" rows={2} value={draft.emails} onChange={event => set('emails',event.target.value)} className={control} placeholder="hello@example.com" /></Field>
              <StoreAddressAutocomplete value={draft.address} city={draft.city} state={draft.state} zipCode={draft.zipCode} disabled={!!pendingSave || saving || uploading || closing} onChange={parts => { if (!pendingProfile.current && !saveInFlight.current) setDraft(previous => ({ ...previous, ...parts })); }} />
              <div className="sm:col-span-2 grid grid-cols-1 gap-5 sm:grid-cols-2">
                {text('mapShareUrl','地图分享链接',{type:'url',maxLength:500,placeholder:'https://…'})}
                <div>
                  <Field label="门店时区"><StoreTimezonePicker value={draft.timezone} onChange={value => { setAutoMatchTimezone(false); set('timezone', value); }} disabled={!!pendingSave || saving || closing || uploading} /></Field>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs leading-5">
                    <span className="text-slate-400">{autoMatchTimezone ? '跟随当前地址自动匹配；可手动修改。' : '保留当前时区，修改地址不会自动覆盖。'}</span>
                    <button type="button" className="font-medium text-teal-700 disabled:opacity-40" onClick={rematchTimezone} disabled={!!pendingSave || saving || closing || uploading || !draft.state.trim()}>按地址重新匹配</button>
                  </div>
                </div>
              </div>
              {zipStateConflict && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 sm:col-span-2">邮编对应 {zipStateConflict.zipState}，与所填州 {zipStateConflict.enteredState} 不一致，请核对地址；自动时区按城市和州匹配，仍可手动修改。</p>}
            </Block>
            {item && !isStoreManager && <StoreOrderEmailSettingsAdmin shopId={item.id} disabled={!!pendingSave || saving || uploading || closing || accountState.dirty || accountState.busy || accountState.unknown || businessOnlyState.dirty || businessOnlyState.busy || businessOnlyState.unknown || projectState.dirty || projectState.busy || projectState.unknown || bookingSettingsState.dirty || bookingSettingsState.busy || bookingSettingsState.unknown} onLifecycleChange={orderEmailChangedState} onSaved={businessChanged} />}
            <Block title="商家账号密码设置"><div className="space-y-4 sm:col-span-2">{item ? <>{onManageAccountAccess && !isStoreManager ? <StoreAccountCredentials key={String(item.id)} shopId={item.id} suggestedEmail={item.emails.find(value => value.trim())} disabled={!!pendingSave || saving || uploading || closing || businessOnlyState.dirty || businessOnlyState.busy || businessOnlyState.unknown || projectState.dirty || projectState.busy || projectState.unknown || bookingSettingsState.dirty || bookingSettingsState.busy || bookingSettingsState.unknown || orderEmailState.dirty || orderEmailState.busy || orderEmailState.unknown} onLifecycleChange={accountChangedState} onSaved={accountSaved} /> : <p className="break-all text-sm text-slate-600">独立登录账号：{storeAccountSummary(item).label}<span className="mt-1 block text-xs text-slate-400">账号密码仅限平台管理员设置。</span></p>}<p className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-400">历史经营归属：#{item.ownerId}，仅保留原账本与经营历史，不随账号设置变更。</p></> : <>
              <p className="text-sm font-medium text-slate-700">经营归属（必选）</p>
              <p className="text-xs leading-5 text-slate-500">请选择有效且未绑定门店的商家账号。需要新账号时，在账号管理中点击「新增」，创建成功后回到此页按姓名搜索。此页会保留已填写的门店资料。</p>
              <a href={createMerchantAccountLink} target="_blank" rel="noopener noreferrer" className="inline-flex text-sm font-medium text-teal-700 underline">打开商家账号管理（新标签页）</a>
              <ResourcePicker resource="merchants" value={draft.ownerId} onChange={value => set('ownerId', String(value))} required />
            </>}</div></Block></div>}
          {tab === 'brand' && <div className="space-y-6"><Block title="顾客页面强调色" description="选择门店顾客页面的整体主题色，标题、链接、选中状态、服务项目和预约入口会统一使用。"><div className="sm:col-span-2 flex flex-wrap gap-3">{(Object.entries(SHOP_BRAND_COLORS) as [ShopBrandColor, { label: string; hex: string }][]).map(([color, option]) => <button key={color} type="button" aria-label={option.label} aria-pressed={draft.brandColor === color} title={option.label} onClick={() => set('brandColor', color)} className={'flex h-11 items-center gap-2 rounded-lg border px-3 text-sm '+(draft.brandColor === color ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white')}><span aria-hidden="true" className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: option.hex }} />{option.label}{draft.brandColor === color && <Check className="h-4 w-4 text-teal-700" />}</button>)}</div></Block><Block title="品牌标识" description="使用自己的品牌素材，右侧预览会随编辑即时变化。"><div className="sm:col-span-2"><StoreMediaEditor previewUrls={media?.previewUrls} kind="logo" onUpload={media?file=>upload(file,'logo'):undefined} value={draft.logoUrl} onChange={value => set('logoUrl',value)} disabled={!!pendingSave || saving || uploading || closing} /></div></Block><Block title="门店封面" description="封面是顾客打开门店时首先看到的画面。"><div className="sm:col-span-2"><StoreMediaEditor previewUrls={media?.previewUrls} kind="banner" onUpload={media?file=>upload(file,'cover'):undefined} value={draft.bannerUrl} onChange={value => set('bannerUrl',value)} disabled={!!pendingSave || saving || uploading || closing} /></div></Block><Block title="门店相册" description="展示真实环境与服务空间，顺序会随保存同步。"><div className="sm:col-span-2"><StoreMediaEditor previewUrls={media?.previewUrls} kind="gallery" onUpload={media?file=>upload(file,'gallery'):undefined} value={draft.gallery} onChange={value => set('gallery',value)} disabled={!!pendingSave || saving || uploading || closing} /></div>{text('videoUrl','视频链接',{wide:true,type:'url',maxLength:500,placeholder:'https://…',hint:'填写视频地址。工作室预览不自动播放视频。'})}</Block><Block title="官网与社交媒体" description="可选填写门店自己的公开链接。只接受 HTTPS；不会根据门店名称自动生成。">{text('websiteUrl','门店官网',{type:'url',maxLength:500,placeholder:'https://example.com'})}{text('instagramUrl','Instagram',{type:'url',maxLength:500,placeholder:'https://www.instagram.com/your-shop'})}{text('facebookUrl','Facebook',{type:'url',maxLength:500,placeholder:'https://www.facebook.com/your-shop'})}</Block></div>}
          {tab === 'hours' && <div className="space-y-6">{item && <>{draft.timezone !== (item.timezone ?? '') && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">门店时区有未保存修改。请先点击底部“保存门店资料”，然后再保存按门店当地日期设置的闭店与预约提前时间。</p>}<ShopBookingSettingsEditor shopId={item.id} timezone={draft.timezone || null} phone={item.phones.map(value => value.trim()).find(Boolean)} disabled={!!pendingSave || saving || uploading || closing || businessOnlyState.dirty || businessOnlyState.busy || businessOnlyState.unknown || projectState.dirty || projectState.busy || projectState.unknown || draft.timezone !== (item.timezone ?? '')} onLifecycleChange={bookingChangedState} /></>}<Block title="营业时间" description="按门店所在地的时间设置，关闭日不会提供预约时段。"><div className="sm:col-span-2"><StoreHoursEditor value={draft.businessHours} onChange={value => set('businessHours',value)} /></div></Block><Block title="线上服务" description="顾客可用的服务取决于门店发布状态和以下设置。"><label className="store-switch-card"><span><span className="block font-medium text-slate-700">线上预约</span><span className="mt-1 block text-xs leading-5 text-slate-500">允许顾客选择服务并提交预约</span></span><input type="checkbox" checked={draft.onlineBooking} onChange={event => set('onlineBooking',event.target.checked)} /></label><label className="store-switch-card"><span><span className="block font-medium text-slate-700">顾客评价</span><span className="mt-1 block text-xs leading-5 text-slate-500">允许顾客提交服务评价</span></span><input type="checkbox" checked={draft.reviews} onChange={event => set('reviews',event.target.checked)} /></label><p className="flex gap-2 rounded-lg bg-slate-50 p-4 text-xs leading-6 text-slate-500 sm:col-span-2"><Info className="mt-1 h-4 w-4 shrink-0" />在线收款与会员卡尚未开通。营业时段设置与此刻实际营业状态分别管理。</p></Block></div>}
          {tab === 'review' && <div className="space-y-6">{item && !isStoreManager ? <StoreReadiness key={String(item.id) + ":" + readinessRevision} shopId={String(item.id)} revision={readinessRevision} dirty={dirty} onAction={repair} /> : <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">{item ? '请补充资料并保存，营业准备由平台检查。' : '保存门店后查看营业准备检查。'}</p>}<Block title="发布状态" description={isStoreManager?'门店资料由平台审核。你可以补充资料并保存。':'审核与补资料说明也可在门店申请页面处理。'}><Field label="当前状态">{isStoreManager?<p className="rounded-lg bg-slate-50 px-4 py-3 text-slate-700">{STATUS[draft.status]}</p>:<select id="store-status" value={draft.status} onChange={event=>set('status',event.target.value as StoreDraft['status'])} className={control}>{Object.entries(STATUS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}</Field>{!isStoreManager && draft.status==='REJECTED' && <Field label="拒绝原因 *" wide><textarea id="store-reviewReason" maxLength={2000} rows={3} value={draft.reviewReason} onChange={event=>set('reviewReason',event.target.value)} className={control} /></Field>}{item?.reviewComment && <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-600 sm:col-span-2">最近审核说明：{item.reviewComment}</p>}</Block></div>}
        </div></fieldset>
      </form>
      {tab === 'price-menu' && !item && <p className="store-editor-content text-sm text-slate-500">请先创建门店，再维护服务与价格。</p>}
      {item && projectVisited && <div id="store-service-editor-panel" role="tabpanel" aria-labelledby="store-tab-price-menu" hidden={tab !== 'price-menu'} className="store-editor-content">
        <StoreServiceWorkspace key={'admin:' + scope.actorId + ':' + item.id} shopId={String(item.id)} scopeKey={'admin:' + scope.actorId + ':' + item.id} api={projectApi} revision={readinessRevision} isCurrent={projectCurrent} disabled={!!pendingSave || saving || uploading || closing} beforeWrite={beforeProjectWrite} mediaTransport={projectMedia} onMediaDiscardReady={registerProjectMediaDiscard} shopImages={savedShopImages} focus={projectFocus} onLifecycleChange={projectChangedState} onSaved={projectSaved} />
      </div>}
      <fieldset disabled={!!pendingSave || saving || uploading || closing} id="store-business-editor-panel" hidden={tab !== 'business'} className="store-editor-content min-w-0 border-0" role="tabpanel" aria-labelledby="store-tab-business">
        {businessMessage && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{businessMessage}</p>}
        {item ? businessVisited && <StoreBusinessSettings item={item} initialTarget={businessTarget} onLifecycleChange={businessChangedState} onChanged={businessChanged} onOpenPriceMenu={() => { setProjectVisited(true); switchTab('price-menu'); }} /> : <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">请先创建门店，再在本窗口配置本店服务、技师和预约。</p>}
        {item && onCopySettings && <button type="button" className="store-secondary-button mt-5" onClick={() => void leave(() => onCopySettings(item))}>复制本店已保存设置</button>}
      </fieldset>
    </div><aside className={'store-preview-pane '+(showPreview?'is-mobile-visible':'')}><StoreCustomerPreview previewUrls={media?.previewUrls} draft={draft} saved={!!item && !dirty} /></aside></div>
    <footer className="store-studio-footer"><div className="min-w-0"><p className={'flex items-center gap-2 text-sm '+(dirty || businessState.dirty?'text-amber-700':'text-slate-500')}>{dirty || businessState.dirty?<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />:<Check className="h-4 w-4 shrink-0 text-teal-600" />}{uploading?'图片上传验证中…':saving?'正在保存…':businessState.busy?'业务操作进行中…':pendingSave?'门店资料保存结果待核对':businessState.unknown?'业务创建结果待核对':businessState.dirty?'业务配置有未保存的修改':dirty?'有未保存的修改':item?'与已保存资料一致':'门店尚未创建'}</p><p className="mt-1 text-xs leading-5 text-slate-400">{tab === 'price-menu' ? '当前服务、分组与顺序分别在本页明确保存；其他分区的门店资料草稿保留。' : '此按钮仅保存门店基本资料、品牌及营业设置；服务与价格在统一编辑区保存。'}</p></div><div className="flex shrink-0 gap-2"><button type="button" disabled={!!pendingSave || saving || closing || uploading || businessState.busy} onClick={()=>void leave(onClose)} className="store-secondary-button">关闭</button>{tab !== 'price-menu' && <button type="submit" form="store-workspace-form" disabled={!!pendingSave || saving || uploading || closing || businessState.dirty || businessState.busy || businessState.unknown || !!item && !dirty} className="store-primary-button"><Save className="h-4 w-4" />{saving?'保存中…':item?'保存门店资料':'创建门店'}</button>}</div></footer>
  </section></div>;
}
