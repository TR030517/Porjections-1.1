import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { ProjectCatalogItem, ProjectCatalogQuery } from '../../utils/projectCatalog';
import { readProjectCatalogPage } from '../../utils/projectCatalog';
import { PRICE_MENU_GALLERY } from '../../utils/priceMenuGallery';
import { PROJECT_METADATA_CATEGORIES } from '../../utils/projectMetadata';
import { safePriceMenuImage } from '../../utils/priceMenu';
import { MediaDraftSession, ShopMediaUploadRecoveryError, type StagedMedia } from '../../utils/mediaDraft';
import type { SaveLegacyDisplay, SaveMenuLayout, ServiceWorkspaceDraft, StoreServiceWorkspaceProps, WorkspaceCommand, WorkspaceDisplayDraft, WorkspaceFieldIssue, WorkspaceReceipt, WorkspaceSnapshot, WorkspaceTarget } from '../../types/serviceWorkspace';
import { buildWorkspaceCommand, newWorkspaceDisplay, readWorkspaceReceipt, readWorkspaceSnapshot, targetKey, verifyWorkspaceReadback, workspaceDraft, workspaceFingerprint, workspaceHasChanges, workspaceKey, workspaceMoney, workspaceRejected, workspaceTitle } from '../../utils/serviceWorkspace';
import './StoreServiceWorkspace.css';
import StoreLegacyProjectRepair, { LegacyAssociationReview, hasLiteralPrice, legacyAssociationRows } from './StoreLegacyProjectRepair';

const control = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-500';
const secondary = 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 hover:border-teal-500 disabled:opacity-40';
const primary = 'rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40';
type Pending = { shopId: string; scope: string; command: WorkspaceCommand; baseline: WorkspaceSnapshot; draft: ServiceWorkspaceDraft | null; layout: LayoutDraft | null; legacy: LegacyDraft | null; media?: readonly StagedMedia[] };
const pendingMemory = new Map<string, Pending>();
const storageKey = (scope: string) => 'massajoy.service-workspace.v1:' + encodeURIComponent(scope);
function retain(pending: Pending) {
  // A synchronous durable write precedes POST. Storage failures never send a command.
  sessionStorage.setItem(storageKey(pending.scope), JSON.stringify(pending)); pendingMemory.set(pending.scope, pending);
}
function recover(scope: string, shopId: string): Pending | null {
  const memory = pendingMemory.get(scope); if (memory) { if (memory.shopId !== shopId) throw Error('待核对记录门店不符。'); return memory; }
  const value = sessionStorage.getItem(storageKey(scope)); if (!value) return null;
  const raw = JSON.parse(value) as Pending;
  if (raw.scope !== scope || raw.shopId !== shopId || !raw.command?.idempotencyKey || !raw.baseline || raw.baseline.shopId !== shopId) throw Error('待核对记录损坏，请保留本页并联系管理员。');
  pendingMemory.set(scope, raw); return raw;
}
function forget(pending: Pending) { sessionStorage.removeItem(storageKey(pending.scope)); pendingMemory.delete(pending.scope); }
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请保留草稿并重试读取。';
function Field({ label, children, issue, fieldId }: { label: string; children: ReactNode; issue?: string; fieldId?: string }) {
  const generated = useId(), id = fieldId ?? 'workspace-field-' + generated, errorId = id + '-error';
  const controls: ReactElement<Record<string, unknown>>[] = [];
  const collect = (value: ReactNode) => Children.forEach(value, child => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    if (['input', 'textarea', 'select'].includes(String(child.type))) controls.push(child);
    else collect(child.props.children as ReactNode);
  });
  collect(children);
  // Gallery and local file controls share the image field. Focus the editable URL.
  const first = controls.find(child => child.type === 'textarea' || child.type === 'input' && child.props.type !== 'file') ?? controls[0];
  const attach = (value: ReactNode): ReactNode => Children.map(value, child => {
    if (!isValidElement<Record<string, unknown>>(child)) return child;
    if (child === first) return cloneElement(child, { id, 'aria-invalid': issue ? true : undefined, 'aria-describedby': [child.props['aria-describedby'], issue ? errorId : ''].filter(Boolean).join(' ') || undefined });
    return child.props.children ? cloneElement(child, { children: attach(child.props.children as ReactNode) }) : child;
  });
  return <div className="block min-w-0 space-y-1.5 text-sm text-slate-700"><label className="block" htmlFor={id}>{label}</label>{attach(children)}{issue && <span id={errorId} role="alert" className="block text-xs text-red-700">{issue}</span>}</div>;
}
function WorkspaceModal({label,disabled,onCancel,restoreFocus,children,wide=false}:{label:string;disabled:boolean;onCancel:()=>void;restoreFocus:(prior:Element|null,dialog:HTMLElement|null)=>void;children:ReactNode;wide?:boolean}){
  const dialog=useRef<HTMLDivElement>(null),latest=useRef({disabled,onCancel});latest.current={disabled,onCancel};
  useLayoutEffect(()=>{const prior=document.activeElement,openedDialog=dialog.current;const first=openedDialog?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');(first??openedDialog)?.focus();return()=>restoreFocus(prior,openedDialog);},[]);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={wide?'w-full max-w-2xl':'w-full max-w-md'} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!latest.current.disabled)latest.current.onCancel();return;}
    if(event.key!=='Tab')return;
    const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')??[]);
    const first=nodes[0],last=nodes[nodes.length-1];
    if(!first){event.preventDefault();dialog.current?.focus();return;}
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
    event.stopPropagation();
  }}>{children}</div></div>;
}
type LayoutDraft = { groups: { key: string; index?: number; category: string }[]; moves: { itemId: string; group: string; position: string }[]; removals: { index: number; moveTo: string }[] };
type LegacyDraft = { id: string; name: string; priceText: string; description: string; imageUrl: string; isVisible: boolean };
type ImageInput = { key: string; value: string };
type ImageUploadError = ImageInput & { file: File; message: string; restart: boolean };
const menuImageUrls = (snapshot: WorkspaceSnapshot) => snapshot.priceMenu.flatMap(group => group.items.map(row => row.imageUrl ?? ''));
function WorkspaceComparison({title,attempt,snapshot}:{title:string;attempt?:Pending;snapshot?:WorkspaceSnapshot}){
  const source=snapshot??attempt?.baseline, draft=attempt?.draft??(snapshot?.service?workspaceDraft(snapshot):null);
  return <section className="space-y-2 rounded-lg bg-slate-50 p-3"><h5 className="text-sm font-semibold">{title}</h5><div className="workspace-summary">
    {draft?<><p className="text-sm font-semibold">{draft.name||'未命名服务'} · {draft.isActive?'启用':'暂停'}</p><p className="text-xs">{draft.participantCount} 位顾客 / {draft.requiredStaffCount} 位技师 · 技师缓冲 {draft.staffBuffer} 分钟 / 场地缓冲 {draft.roomBuffer} 分钟</p>{!draft.variants.length&&<p className="text-xs">基础方案：{draft.duration} 分钟 · USD {draft.price}</p>}<ul>{draft.variants.map(row=><li key={row.key} className="text-xs">{row.name||'未命名规格'} · {row.duration} 分钟 · USD {row.price} · {row.isActive?'启用':'暂停'}</li>)}</ul>{!!draft.addOns.length&&<><p className="text-xs font-semibold">附加项</p><ul>{draft.addOns.map(row=><li key={row.key} className="text-xs">{row.name} · USD {row.price} · {row.isActive?'启用':'暂停'}</li>)}</ul></>}<p className="text-xs font-semibold">顾客展示 · {draft.displays.length} 处</p><ul>{draft.displays.map(row=><li key={row.key} className="break-words text-xs">{workspaceTitle(draft,row)} · {row.isVisible?'显示':'隐藏'} · {row.group.startsWith('g:')?source?.priceMenu[Number(row.group.slice(2))]?.category:draft.newGroups.find(g=>g.key===row.group.slice(2))?.category}</li>)}</ul></>:attempt?.legacy?<><p className="text-sm">{attempt.legacy.name}</p><p className="text-xs">{attempt.legacy.priceText} · {attempt.legacy.isVisible?'显示':'隐藏'}</p><p className="break-words text-xs">{attempt.legacy.description}</p></>:attempt?.layout?<><p className="text-xs">分组与顺序草稿</p><ol>{attempt.layout.groups.map(g=><li key={g.key} className="text-xs">{g.category}</li>)}</ol><p className="text-xs">移动 {attempt.layout.moves.length} 处展示；移除 {attempt.layout.removals.length} 个分组并保留内容。</p></>:attempt?.command.action==='REMOVE_MENU_DISPLAY'?<p className="text-xs">移除：{attempt.baseline.priceMenu.flatMap(g=>g.items).find(row=>row.id===(attempt.command as {itemId:string}).itemId)?.name??'指定展示位置'}</p>:<><p className="text-xs">当前分组与展示</p>{snapshot?.priceMenu.map((group,index)=><div key={index}><p className="text-xs font-semibold">{group.category||'未命名分组'} · {group.items.length} 项</p><ul>{group.items.map((row,position)=><li key={row.id??position} className="break-words text-xs">{row.name} · {row.isVisible===false?'隐藏':'显示'}</li>)}</ul></div>)}</>}
  </div></section>;
}

/** One service draft, one command. The caller supplies role-specific, identity-checked transport. */
export default function StoreServiceWorkspace(props: StoreServiceWorkspaceProps) {
  const { shopId, scopeKey, focus, revision } = props;
  const readReady = props.readReady !== false, fieldPrefix = 'workspace-' + useId();
  const identity = JSON.stringify([scopeKey, shopId]);
  const live = useRef({ identity, generation: 0, mounted: true, props });
  if (live.current.identity !== identity) live.current = { identity, generation: live.current.generation + 1, mounted: true, props };
  else live.current.props = props;
  const generation = live.current.generation, eventRevision = useRef(0), renderedRevision = eventRevision.current;
  // Retain the event's original session fence, never adopt a later same-actor login's function.
  const ownerCurrent = props.isCurrent;
  const current = () => live.current.mounted && live.current.generation === generation && ownerCurrent();
  const eventCurrent = () => current() && renderedRevision === eventRevision.current;
  const mediaScope = useRef<{ identity: string; session?: MediaDraftSession; busy: boolean; retain: boolean }>({ identity, busy: false, retain: false });
  if (mediaScope.current.identity !== identity) mediaScope.current = { identity, busy: false, retain: false };
  const mediaState = mediaScope.current;
  if (!mediaState.session && props.mediaTransport) {
    const transport = props.mediaTransport;
    const canAbandon = props.canAbandonMedia ?? ownerCurrent;
    const requireUploadScope = () => {
      const active = live.current.props;
      if (!current() || !(active.canUploadMedia?.() ?? active.beforeWrite())) throw Error('当前门店或上传权限已变化。');
    };
    mediaState.session = new MediaDraftSession(shopId, {
      upload: async (file, purpose, key) => { requireUploadScope(); return transport.upload(file, purpose, key); },
      confirm: async id => { requireUploadScope(); return transport.confirm(id); },
      preview: transport.preview && (async id => { requireUploadScope(); return transport.preview!(id); }),
      abandon: async id => {
        if (!canAbandon()) throw Error('当前门店或清理权限已变化。');
        return transport.abandon(id);
      },
    });
  }
  const media = mediaState.session;
  const [imageOperation, setImageOperation] = useState('');
  const [imageError, setImageError] = useState<ImageUploadError | null>(null);
  useEffect(() => {
    media?.activate();
    return () => {
      if (mediaState.retain) media?.releasePreviews();
      else void media?.dispose();
    };
  }, [media, mediaState]);
  const workspaceRoot = useRef<HTMLDivElement>(null), workspaceHeading = useRef<HTMLHeadingElement>(null), layoutRegion = useRef<HTMLElement>(null);
  const focusScope = useRef({ identity, active: false });
  if (focusScope.current.identity !== identity) { focusScope.current.active = false; focusScope.current = { identity, active: false }; }
  const renderedFocusScope = focusScope.current, layoutTitleId = fieldPrefix + '-layout-title';
  useLayoutEffect(() => {
    renderedFocusScope.active = true;
    // Parent layout cleanup runs before its modal children during unmount.
    return () => { renderedFocusScope.active = false; };
  }, [renderedFocusScope]);
  const restoreWorkspaceFocus = (prior: Element | null, closingDialog: HTMLElement | null) => {
    const root = workspaceRoot.current;
    if (!renderedFocusScope.active || focusScope.current !== renderedFocusScope || !current() || !root?.isConnected) return;
    const active = document.activeElement;
    // A new editor or another valid destination may already own focus.
    if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement && active.isConnected && !active.matches(':disabled') && !closingDialog?.contains(active)) return;
    if (prior instanceof HTMLElement && prior.isConnected && root.contains(prior) && !prior.matches(':disabled')) {
      prior.focus({ preventScroll: true });
      if (document.activeElement === prior) return;
    }
    workspaceHeading.current?.focus();
  };
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null), [draft, setDraft] = useState<ServiceWorkspaceDraft | null>(null);
  const [legacyReview, setLegacyReview] = useState<{ draft: ServiceWorkspaceDraft; snapshot: WorkspaceSnapshot } | null>(null);
  const [items, setItems] = useState<ProjectCatalogItem[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [catalogLoading,setCatalogLoading]=useState(false);
  const [snapshotRead, setSnapshotRead] = useState<'idle'|'loading'|'ready'|'error'>('idle'), [catalogRead, setCatalogRead] = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [snapshotError, setSnapshotError] = useState(''), [catalogError, setCatalogError] = useState('');
  const completeCatalog=useRef<{key:string;items:ProjectCatalogItem[]}|null>(null);
  const [search, setSearch] = useState(''), [searchInput, setSearchInput] = useState(''), [status, setStatus] = useState<'all'|'active'|'inactive'>('all'), [visibility, setVisibility] = useState('all');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [unknown, setUnknown] = useState(false), [storageBlocked, setStorageBlocked] = useState(false), [outdated, setOutdated] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [issues, setIssues] = useState<WorkspaceFieldIssue[]>([]), [counter, setCounter] = useState(0);
  const [layout, setLayout] = useState<LayoutDraft | null>(null), [legacy, setLegacy] = useState<LegacyDraft | null>(null);
  const [reviewed, setReviewed] = useState<{ snapshot: WorkspaceSnapshot; receipt: WorkspaceReceipt; attempt: Pending } | null>(null);
  const [navigation, setNavigation] = useState<null | (() => void)>(null), [preview, setPreview] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null), locked = useRef(false), readTicket = useRef(0), catalogTicket = useRef(0), focusHandled = useRef('');
  const draftRef = useRef(draft), snapshotRef = useRef(snapshot); draftRef.current = draft; snapshotRef.current = snapshot;
  const dirty = !!draft && !!snapshot && (!draft.serviceId || workspaceFingerprint(draft) !== workspaceFingerprint(workspaceDraft(snapshot))) || !!layout || !!legacy;
  const draftDirty = dirty || Boolean(media?.hasStagedAssets);
  const operationBusy = busy || !!imageOperation;
  const stateRef = useRef({ dirty: draftDirty, unknown, busy: operationBusy, storageBlocked }); stateRef.current = { dirty: draftDirty, unknown, busy: operationBusy, storageBlocked };
  const blocked = !!props.disabled || !readReady || operationBusy || unknown || storageBlocked || loading || snapshotRead !== 'ready' || catalogRead !== 'ready';
  const reloadBlocked = !!props.disabled || !readReady || operationBusy || unknown || storageBlocked || loading;
  const previewState = unknown || busy || storageBlocked ? '保存结果待核对' : !readReady || snapshotRead !== 'ready' || outdated ? '资料待重新核对' : dirty ? '尚未保存' : '与已保存资料一致';
  const saveState = operationBusy ? 'busy' : unknown ? 'unknown' : storageBlocked ? 'locked' : outdated ? 'outdated' : blocked ? 'unavailable' : draftDirty ? 'dirty' : 'saved';
  const saveStatus = imageOperation ? '正在处理展示图片' : busy ? '正在保存，请勿重复提交' : unknown ? '保存结果待核对，请查询原回执' : storageBlocked ? '恢复记录不可用，保存已锁定' : outdated ? '来源已变化，请核对最新资料' : blocked ? '资料待核对，暂时不能保存' : draftDirty ? '有未保存修改 · 仅保存当前服务' : '与已保存资料一致';
  const sectionId = (section: string) => section === 'rules' ? 'workspace-rules-' + (draft?.serviceId ?? 'new') : fieldPrefix + '-section-' + section;
  const navigateSection = (section: string) => {
    // Local navigation never changes a draft, its operation key, or the route.
    if (!eventCurrent() || !draftRef.current) return;
    const target = document.getElementById(sectionId(section));
    if (!target) return;
    if (target.tagName === 'DETAILS') (target as HTMLDetailsElement).open = true;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    target.focus({ preventScroll: true });
  };
  const issue = (field: string) => issues.find(v => v.field === field)?.message;
  const fieldId = (field: string) => fieldPrefix + '-' + (field === 'requiredStaffCount' ? 'participantCount' : field).replace(/^(variants|addOns|displays|newGroups)\.(\d+)/, (_match, collection: 'variants'|'addOns'|'displays'|'newGroups', index: string) => collection + '-' + (draft?.[collection][Number(index)]?.key ?? index)).replace(/[^a-zA-Z0-9_-]/g, '-');
  const errorSummary = useRef<HTMLParagraphElement>(null), errorSummaryId = fieldPrefix + '-error-summary';
  const layoutOpen = !!layout;
  useLayoutEffect(() => {
    if (layoutOpen && renderedFocusScope.active && focusScope.current === renderedFocusScope && current() && !stateRef.current.unknown) layoutRegion.current?.focus();
    // Focus only when entering this inline editor, never on field edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutOpen, identity]);
  useLayoutEffect(() => {
    if (!issues.length || !current()) return;
    const target = document.getElementById(fieldId(issues[0].field)) ?? errorSummary.current;
    if (!target) return;
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName === 'DETAILS') (ancestor as HTMLDetailsElement).open = true;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.focus({ preventScroll: true });
    // Stable row keys identify the original field even when another row is inserted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues]);
  useLayoutEffect(() => {
    // A definitive rejection or version conflict may not identify a field.
    // Clearing an error while typing must never steal focus from the input.
    if (issues.length || !(error || snapshotError || catalogError) || !current()) return;
    const target = errorSummary.current ?? document.getElementById(errorSummaryId);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' }); target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, snapshotError, catalogError, issues.length]);
  const invalidate = () => { eventRevision.current++; setIssues([]); setNotice(''); setError(''); };
  const change = (edit: (value: ServiceWorkspaceDraft) => ServiceWorkspaceDraft) => { if (!eventCurrent() || blocked || mediaState.busy || live.current.props.disabled || !draftRef.current) return; invalidate(); setDraft(edit(draftRef.current)); };
  const requestNavigate = (run: () => void) => {
    if (!eventCurrent() || live.current.props.disabled || locked.current || mediaState.busy || stateRef.current.unknown || stateRef.current.storageBlocked) return;
    if (stateRef.current.dirty) { setNavigation(() => run); return; } run();
  };
  const startImageOperation = (key: string) => {
    mediaState.busy = true;
    stateRef.current.busy = true;
    setImageOperation(key);
    live.current.props.onLifecycleChange({ dirty: stateRef.current.dirty, busy: true, unknown: stateRef.current.unknown });
  };
  const stopImageOperation = () => {
    mediaState.busy = false;
    if (current()) setImageOperation('');
  };
  const discardNavigation = async () => {
    if (!current() || locked.current || mediaState.busy || stateRef.current.unknown || !navigation) return;
    const run = navigation;
    if (media?.hasStagedAssets) {
      startImageOperation('discard');
      try {
        if (await media.cleanup()) {
          if (current()) { setNavigation(null); setError('暂存图片尚未清理，请重试放弃修改。'); }
          return;
        }
      } finally { stopImageOperation(); }
    }
    if (!current()) return;
    invalidate(); setImageError(null); setDraft(null); setLayout(null); setLegacy(null); setNavigation(null); run();
  };
  const canRead = () => live.current.props.readReady !== false;
  const loadSnapshot = async (serviceId?: string) => {
    if (!canRead()) return;
    const ticket = ++readTicket.current; setLoading(true); setSnapshotRead('loading'); setSnapshotError(''); setError('');
    try {
      const raw = await live.current.props.api.loadSnapshot(serviceId);
      if (!current() || !canRead() || ticket !== readTicket.current) return;
      const next = readWorkspaceSnapshot(raw, shopId, serviceId); invalidate(); setSnapshot(next); setSnapshotRead('ready'); setDraft(serviceId ? workspaceDraft(next) : null); setLayout(null); setLegacy(null); setOutdated(false);
      if (serviceId) live.current.props.onSelectService?.(serviceId);
    } catch (e) { if (current() && canRead() && ticket === readTicket.current) { setSnapshotRead('error'); setSnapshotError('完整价目读取失败，顾客展示数量待核对；已保留上次资料。' + message(e)); } }
    finally { if (current() && ticket === readTicket.current) setLoading(false); }
  };
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; }; }, []);
  useEffect(() => {
    eventRevision.current++; readTicket.current++; catalogTicket.current++; pending.current = null; locked.current = false;
    setPage(1);setSearch('');setSearchInput('');setStatus('all');setVisibility('all');completeCatalog.current=null;
    setSnapshot(null); setSnapshotRead('idle'); setCatalogRead('idle'); setSnapshotError(''); setCatalogError(''); setTotal(0); setDraft(null); setLayout(null); setLegacy(null); setLegacyReview(null); setRemoving(null); setReviewed(null); setUnknown(false); setStorageBlocked(false); setBusy(false); setError(''); setNotice(''); setItems([]); setImageOperation(''); setImageError(null); focusHandled.current = '';
    try {
      const prior = recover(scopeKey, shopId);
      if (prior) {
        pending.current = prior; mediaState.retain = true;
        media?.restoreStagedAssets(prior.media ?? [], 'menu');
        setSnapshot(prior.baseline); setSnapshotRead('ready'); setDraft(prior.draft); setLayout(prior.layout ?? null); setLegacy(prior.legacy ?? null); setUnknown(true); setNotice('上次保存结果尚未核对；已恢复原操作编号和草稿，请核对原操作。'); return;
      }
    } catch (e) { setStorageBlocked(true); setError('无法安全读取本页待核对记录，保存已锁定。' + message(e)); return; }
    void loadSnapshot(focus?.serviceId);
    // Scope invalidation is independent from legitimate StrictMode effect reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  const readinessSeen = useRef({ identity, ready: readReady });
  useEffect(() => {
    const prior = readinessSeen.current; readinessSeen.current = { identity, ready: readReady };
    if (prior.identity !== identity) return;
    if (!readReady) { readTicket.current++; setLoading(false); return; }
    if (prior.ready) return;
    if (!stateRef.current.dirty && !stateRef.current.busy && !stateRef.current.unknown && !stateRef.current.storageBlocked) void loadSnapshot(focus?.serviceId ?? draftRef.current?.serviceId);
    setCounter(value => value + 1);
    // Authorization becoming ready is a read retry, never a remount or a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, readReady]);
  const revisionSeen = useRef(revision);
  useEffect(() => {
    if (revisionSeen.current === revision) return; revisionSeen.current = revision;
    if (stateRef.current.dirty || stateRef.current.busy || stateRef.current.unknown || stateRef.current.storageBlocked) { setOutdated(true); return; }
    void loadSnapshot(draftRef.current?.serviceId); setCounter(v => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController(), ticket = ++catalogTicket.current;
    const valid=()=>current()&&live.current.props.readReady!==false&&!controller.signal.aborted&&ticket===catalogTicket.current;
    if (!readReady) { setCatalogLoading(false); setCatalogRead('idle'); return () => controller.abort(); }
    setCatalogLoading(true); setCatalogRead('loading'); setCatalogError('');
    void (async()=>{
      if(visibility==='all'){
        const query:ProjectCatalogQuery={search,status,page,pageSize:20};
        const result=readProjectCatalogPage(await props.api.loadCatalog(query,controller.signal),shopId,query);
        if(valid()){setItems(result.items);setTotal(result.total);setCatalogRead('ready');}return;
      }
      if(!snapshot)return;
      const cacheKey=JSON.stringify([identity,search,status,counter,snapshot.priceMenuRevision]);
      let rows=completeCatalog.current?.key===cacheKey?completeCatalog.current.items:null;
      if(!rows){
        const query:ProjectCatalogQuery={search,status,page:1,pageSize:50};
        const first=readProjectCatalogPage(await props.api.loadCatalog(query,controller.signal),shopId,query);
        if(!valid())return;
        if(first.total>10000)throw Error('当前筛选需完整读取目录，超过10000项安全上限。请先缩小搜索；未截断或替换资料。');
        rows=[...first.items];
        for(let next=2;rows.length<first.total;next++){
          const nextQuery={...query,page:next};
          const result=readProjectCatalogPage(await props.api.loadCatalog(nextQuery,controller.signal),shopId,nextQuery);
          if(!valid())return;
          if(result.total!==first.total||!result.items.length)throw Error('读取期间服务目录已变化，请重新查询完整目录。');
          rows.push(...result.items);
        }
        if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('读取期间目录位置已变化，请重新查询。');
        completeCatalog.current={key:cacheKey,items:rows};
      }
      const shown=new Set(snapshot.priceMenu.flatMap(g=>g.items.filter(row=>row.isVisible!==false&&row.booking).map(row=>row.booking!.serviceId)));
      const filtered=rows.filter(row=>visibility==='visible'?shown.has(row.id):!shown.has(row.id));
      if(valid()){
        if(page>1&&(page-1)*20>=filtered.length){setPage(1);return;}
        setItems(filtered.slice((page-1)*20,page*20));setTotal(filtered.length);setCatalogRead('ready');
      }
    })().catch(e=>{if(valid()){setCatalogRead('error');setCatalogError('服务目录读取失败，服务总数待核对；已保留上次资料。'+message(e));}}).finally(()=>{if(valid())setCatalogLoading(false);});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, readReady, page, search, status, counter, visibility, snapshot?.priceMenuRevision]);
  const focusKey = JSON.stringify([identity, focus]);
  useEffect(() => {
    if (!readReady || snapshotRead !== 'ready' || !focus || focusHandled.current === focusKey || !snapshot || stateRef.current.busy || stateRef.current.unknown) return;
    if (stateRef.current.dirty && draftRef.current?.serviceId !== focus.serviceId) { setNotice('请先保存或放弃当前服务修改，再定位另一服务。'); return; }
    if (draftRef.current?.serviceId !== focus.serviceId) { void loadSnapshot(focus.serviceId); return; }
    focusHandled.current = focusKey;
    // Focus only within this component; existing variant/display IDs are never inferred from labels.
    const id = focus.itemId ? 'workspace-display-' + focus.itemId : focus.variantId ? 'workspace-variant-' + focus.variantId : focus.pane === 'booking' ? 'workspace-rules-' + focus.serviceId : 'workspace-service-' + focus.serviceId;
    const frame = requestAnimationFrame(() => { if (!current() || live.current.props.readReady === false) return; const element = document.getElementById(id); if (element?.tagName === 'DETAILS') (element as HTMLDetailsElement).open = true; element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); element?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, readReady, snapshotRead, snapshot, draft?.serviceId]);
  useEffect(() => {
    const register = props.onMediaDiscardReady;
    if (!register || !media) return;
    register(async () => {
      if (mediaState.retain || mediaState.busy || locked.current || !current()) return 1;
      return media.cleanup();
    });
    return () => register(null);
    // Register the cleanup for the original actor and shop only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, mediaState, props.onMediaDiscardReady]);
  useEffect(() => { props.onLifecycleChange({ dirty: draftDirty, busy: operationBusy || loading, unknown: unknown || storageBlocked }); }, [draftDirty, operationBusy, loading, unknown, storageBlocked, props.onLifecycleChange]);
  useEffect(() => () => props.onLifecycleChange({ dirty: false, busy: false, unknown: false }), [props.onLifecycleChange]);
  useEffect(() => {
    const stop = (event: BeforeUnloadEvent) => { if (stateRef.current.dirty || stateRef.current.busy || stateRef.current.unknown || stateRef.current.storageBlocked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', stop); return () => window.removeEventListener('beforeunload', stop);
  }, []);
  const complete = async (receipt: WorkspaceReceipt, attempt: Pending) => {
    if (receipt.outcome === 'NOT_EXECUTED') {
      forget(attempt); pending.current = null; mediaState.retain = false; setReviewed(null); setUnknown(false); setNotice('原操作已封存，未执行保存。草稿保留；核对后可重新保存。'); return;
    }
    setNotice('已收到保存回执，正在读取并核对当前资料。');
    const serviceId = receipt.serviceId ?? undefined;
    const next = readWorkspaceSnapshot(await live.current.props.api.loadSnapshot(serviceId), shopId, serviceId);
    if (!current()) return;
    try { verifyWorkspaceReadback(next, attempt.command, receipt); }
    catch (e) { setReviewed({ snapshot: next, receipt, attempt }); setUnknown(true); setError(message(e)); setNotice('原保存已有提交回执，当前资料含后续差异。请对比后明确采用当前资料；不会重新发送原保存。'); return; }
    // Parent only receives a verified menu baseline; it must preserve unrelated profile drafts.
    await live.current.props.onSaved?.({ snapshot: next, receipt }); if (!current()) return;
    const remainingMedia = await media?.saved(menuImageUrls(next)); if (!current()) return;
    forget(attempt); pending.current = null; mediaState.retain = false; eventRevision.current++; setSnapshot(next); setSnapshotRead('ready'); setSnapshotError(''); setDraft(serviceId ? workspaceDraft(next) : null); setLayout(null); setLegacy(null); setReviewed(null); setUnknown(false); setOutdated(false); setCounter(v => v + 1); setImageError(null);
    setNotice('当前服务已保存并读回核对。' + receipt.warnings.join(' ') + (remainingMedia ? '部分未使用的暂存图片将在离开时重试清理。' : ''));
  };
  const dispatch = async (command: WorkspaceCommand, confirmedDraft = draftRef.current) => {
    if (!eventCurrent() || !snapshotRef.current || blocked || locked.current || mediaState.busy || !live.current.props.beforeWrite()) return;
    const staged = media?.stagedAssets;
    const attempt: Pending = { shopId, scope: scopeKey, command: structuredClone(command), baseline: structuredClone(snapshotRef.current), draft: confirmedDraft ? structuredClone(confirmedDraft) : null, layout: layout ? structuredClone(layout) : null, legacy: legacy ? structuredClone(legacy) : null, ...(staged?.length ? { media: staged } : {}) };
    try { retain(attempt); } catch (e) { setError('无法安全保留操作编号，未发送保存请求。' + message(e)); return; }
    if (!current() || live.current.props.disabled || !live.current.props.beforeWrite()) { try { forget(attempt); } catch { setStorageBlocked(true); } return; }
    if (confirmedDraft !== draftRef.current) setDraft(confirmedDraft);
    pending.current = attempt; mediaState.retain = Boolean(staged?.length); locked.current = true; eventRevision.current++; setBusy(true); setUnknown(true); setError(''); setIssues([]);
    let acknowledged = false;
    try {
      const raw = await live.current.props.api.save(attempt.command); if (!current()) return;
      const receipt = readWorkspaceReceipt(raw, shopId, attempt.command); acknowledged = true; await complete(receipt, attempt);
    } catch (e) {
      if (!current()) return;
      if (!acknowledged && workspaceRejected(e)) {
        try { forget(attempt); pending.current = null; mediaState.retain = false; setUnknown(false); } catch { setStorageBlocked(true); }
        setOutdated(true); setError('保存被拒绝，全部草稿保留。请核对字段、权限或最新基线。' + message(e));
      } else { setUnknown(true); setError('保存结果待核对，禁止重复保存或改用新编号。' + message(e)); }
    } finally { if (current()) { locked.current = false; setBusy(false); } }
  };
  const dismissLegacyReview = () => {
    if (!eventCurrent()) return;
    eventRevision.current++;
    setLegacyReview(null);
  };
  const saveService = (visibility?: ReadonlyMap<string, boolean>) => {
    if (!eventCurrent() || !draft || !snapshot || blocked || outdated) return;
    const reviewed = legacyAssociationRows(snapshot, draft);
    let confirmedDraft = draft;
    if (visibility) {
      if (legacyReview?.draft !== draft || legacyReview.snapshot !== snapshot || !reviewed.length || reviewed.some(row => {
        const visible = visibility.get(row.id);
        return typeof visible !== 'boolean' || visible && row.titleNeedsReview;
      })) return;
      confirmedDraft = { ...draft, displays: draft.displays.map(row =>
        row.id && visibility.has(row.id) ? { ...row, isVisible: visibility.get(row.id)! } : row) };
    }
    try {
      const command = buildWorkspaceCommand(snapshot, confirmedDraft, workspaceKey());
      if (!workspaceHasChanges(command)) { setNotice('没有实际变更。'); return; }
      if (reviewed.length && !visibility) {
        eventRevision.current++;
        setLegacyReview({ draft, snapshot });
        return;
      }
      setLegacyReview(null);
      void dispatch(command, confirmedDraft);
    }
    catch (e) { setError(message(e)); setIssues((e as { issues?: WorkspaceFieldIssue[] }).issues ?? []); }
  };
  const reconcile = async (fence: boolean) => {
    const attempt = pending.current; if (!eventCurrent() || !attempt || locked.current || storageBlocked) return;
    locked.current = true; setBusy(true); setError('');
    try { const raw = await (fence ? live.current.props.api.reconcile(attempt.command.idempotencyKey) : live.current.props.api.readReceipt(attempt.command.idempotencyKey)); if (!current()) return; await complete(readWorkspaceReceipt(raw, shopId, attempt.command), attempt); }
    catch (e) { if (current()) { setUnknown(true); setError('原操作仍待核对。未找到回执不代表未保存，草稿与原操作编号继续保留。' + message(e)); } }
    finally { if (current()) { locked.current = false; setBusy(false); } }
  };
  const adoptCurrent = async () => {
    if (!eventCurrent() || !reviewed || locked.current || storageBlocked || pending.current !== reviewed.attempt) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const serviceId = reviewed.receipt.serviceId ?? undefined;
      const next = readWorkspaceSnapshot(await live.current.props.api.loadSnapshot(serviceId), shopId, serviceId);
      if (!current() || pending.current !== reviewed.attempt) return;
      await live.current.props.onSaved?.({ snapshot: next, receipt: reviewed.receipt });
      if (!current() || pending.current !== reviewed.attempt) return;
      const remainingMedia = await media?.saved(menuImageUrls(next));
      if (!current() || pending.current !== reviewed.attempt) return;
      forget(reviewed.attempt); pending.current = null; mediaState.retain = false; eventRevision.current++; setSnapshot(next); setSnapshotRead('ready'); setSnapshotError(''); setDraft(serviceId ? workspaceDraft(next) : null); setLayout(null); setLegacy(null); setReviewed(null); setUnknown(false); setOutdated(false); setCounter(v=>v+1); setImageError(null);
      setNotice('已明确采用当前已保存资料。原操作有提交回执；未再次发送或覆盖后续修改。' + (remainingMedia ? '部分未使用的暂存图片将在离开时重试清理。' : ''));
    } catch (e) { if (current()) setError('暂时无法采用当前资料，原操作编号与草稿仍保留。'+message(e)); }
    finally { if (current()) { locked.current=false;setBusy(false); } }
  };
  const addVariant = () => change(value => { const key = workspaceKey(); const next = { ...value, variants: [...value.variants, { key, name: '', duration: '60', price: '', isActive: true, sortOrder: String(value.variants.length) }] }; return { ...next, displays: [...next.displays, newWorkspaceDisplay(next, { kind: 'VARIANT', tempKey: key })] }; });
  const displayToggle = (target: WorkspaceTarget, visible: boolean) => change(value => {
    const matches = value.displays.filter(row => targetKey(row.target) === targetKey(target));
    // Restore the same stable positions when hidden; do not remove bindings or pause catalog objects.
    if (!matches.length && visible) return { ...value, displays: [...value.displays, newWorkspaceDisplay(value, target)] };
    return { ...value, displays: value.displays.map(row => targetKey(row.target) === targetKey(target) ? { ...row, isVisible: visible } : row) };
  });
  const groupOptions = snapshot ? [...snapshot.priceMenu.map((g,index) => ({ key: 'g:' + index, name: g.category || '未命名分组' })), ...(draft?.newGroups ?? []).map(g => ({ key: 'n:' + g.key, name: g.category || '待命名新分组（未保存）' }))] : [];
  const selectGroup = (value: string, onChange: (next: string) => void) => <select className={control} value={value} onChange={e => onChange(e.target.value)}><option value="">选择分组</option>{groupOptions.map(group => <option key={group.key} value={group.key}>{group.name}</option>)}</select>;
  const imageSource = (value: string) => media?.previewUrls.get(value) ?? (media?.isStagedUrl(value) ? undefined : safePriceMenuImage(value) ?? undefined);
  const shopImages = Array.from(new Set((props.shopImages ?? []).map(safePriceMenuImage).filter((url): url is string => url !== null)));
  const canUploadImage = () => !!media && snapshotRef.current?.canManageCatalog === true && (live.current.props.canUploadMedia?.() ?? live.current.props.beforeWrite());
  const uploadImage = async (field: ImageInput, file: File) => {
    if (!media || !eventCurrent() || blocked || mediaState.busy || !canUploadImage()) return;
    startImageOperation(field.key);
    setImageError(null);
    try {
      const { url, replacesUrl } = await media.upload(file, 'menu');
      if (!eventCurrent() || !canUploadImage()) return;
      invalidate();
      if (field.key === 'legacy') {
        setLegacy(previous => previous ? { ...previous, imageUrl: url } : previous);
      } else {
        setDraft(previous => previous ? {
          ...previous,
          defaultImage: field.key === 'default' || previous.defaultImage === replacesUrl ? url : previous.defaultImage,
          displays: previous.displays.map(row => row.key === field.key || row.imageUrl === replacesUrl ? { ...row, imageUrl: url } : row),
        } : previous);
      }
    } catch (error) {
      if (eventCurrent() && canUploadImage()) setImageError({ ...field, file, message: message(error), restart: error instanceof ShopMediaUploadRecoveryError && error.restart });
    } finally { stopImageOperation(); }
  };
  const imageControl = (key: string, value: string, onChange: (next: string) => void) => {
    const source = imageSource(value);
    const uploading = imageOperation === key;
    const failure = imageError?.key === key && imageError.value === value ? imageError : null;
    const selectImage = (next: string) => { if (failure) setImageError(null); onChange(next); };
    return <div className="min-w-0 space-y-2">
      <select aria-label="从服务图库选择图片" className={control} value={PRICE_MENU_GALLERY.some(image => image.url === value) ? value : ''} onChange={e => selectImage(e.target.value)}>
        <option value="">选择服务图库图片</option>{PRICE_MENU_GALLERY.map(image => <option key={image.key} value={image.url}>{image.titleZh}</option>)}
      </select>
      {!!shopImages.length && <details className="workspace-shop-photos">
        <summary>选择本店已保存的图片</summary>
        <div className="workspace-shop-photo-options">
          {shopImages.map((url, index) => <button key={url} type="button" aria-pressed={value === url} aria-label={`选择本店图片 ${index + 1}`} onClick={() => selectImage(url)}>
            <img alt="" src={url} loading="lazy" />
          </button>)}
        </div>
      </details>}
      <input className={control} placeholder="https://… 或已上传的媒体引用" maxLength={500} value={value} onChange={e => selectImage(e.target.value)} />
      {canUploadImage() && <div className="space-y-1">
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={key === 'default' ? '上传新增展示默认图片' : '上传价目展示图片'} disabled={blocked} className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-2 file:py-1.5 file:text-slate-700 disabled:opacity-40" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploadImage({ key, value }, file);
        }} />
        <p className="text-xs leading-5 text-slate-500">JPEG、PNG 或 WebP，最多 8 MiB。{key === 'default' ? '图片用于新增展示，也可应用到现有展示位置。' : '上传后随本次价目编辑保存。'}</p>
        {uploading && <p role="status" className="text-xs text-slate-600">正在上传并验证图片…</p>}
        {failure && <><p role="alert" className="text-xs text-red-700">{failure.message}</p><button type="button" className={secondary} disabled={blocked} onClick={() => void uploadImage(failure, failure.file)}>{failure.restart ? '重新上传原文件' : '重试上传'}</button></>}
      </div>}
      {source && <img alt="所选服务图片" src={source} className="h-20 w-28 rounded-lg object-cover" />}
      {media?.isStagedUrl(value) && <p className="text-xs text-teal-700">{source ? '已加入图片草稿，保存后生效。' : '已保留暂存图片，保存后可查看。'}</p>}
    </div>;
  };
  const displaysFor = (target: WorkspaceTarget) => draft?.displays.filter(row => targetKey(row.target) === targetKey(target)) ?? [];
  const displayControls = (target: WorkspaceTarget) => { const rows = displaysFor(target); return <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rows.some(row => row.isVisible)} onChange={e => displayToggle(target,e.target.checked)} />顾客价目显示</label><p className="text-xs text-slate-500">显示 {rows.filter(row => row.isVisible).length}/{rows.length} 处；仅影响公开价目。</p></div>; };
  const allMenuRows = snapshot?.priceMenu.flatMap((g,group) => g.items.map((item,position) => ({ item, group, position }))) ?? [];
  const removalItem=allMenuRows.find(row=>row.item.id===removing)?.item;
  const removalBindings=removalItem?.booking?allMenuRows.filter(row=>row.item.booking?.serviceId===removalItem.booking!.serviceId&&row.item.booking.variantId===removalItem.booking!.variantId&&row.item.booking.addOnId===removalItem.booking!.addOnId).length:0;
  const unlinked = allMenuRows.filter(row => !row.item.booking && !row.item.newVariantOf && row.item.bookingEnabled !== true);
  const menuRows = (id: string) => allMenuRows.filter(row => row.item.booking?.serviceId === id);
  const legacyDisplay = (itemId: string,target: WorkspaceTarget): WorkspaceDisplayDraft | null => {
    const row=unlinked.find(row=>row.item.id===itemId); if(!row)return null;
    return { key:itemId,id:itemId,target,group:'g:'+row.group,position:String(row.position),name:row.item.name,description:row.item.description??'',imageUrl:row.item.imageUrl??'',isVisible:row.item.isVisible!==false,titleMode:hasLiteralPrice(row.item.name)?'AUTO':'CUSTOM' };
  };
  const associateLegacy = (itemId:string,target:WorkspaceTarget) => change(value=>{
    if(value.displays.some(row=>row.id===itemId))return value;
    const display=legacyDisplay(itemId,target);return display?{...value,displays:[...value.displays,display]}:value;
  });
  const convertLegacy = (itemId:string) => requestNavigate(()=>{
    const row=unlinked.find(row=>row.item.id===itemId);if(!row||!snapshot)return;
    const base={...snapshot,service:null,selectionRevision:null},next=workspaceDraft(base),variant=next.variants[0];
    const display=legacyDisplay(itemId,{kind:'VARIANT',tempKey:variant.key});if(!display)return;
    const sourceName = row.item.pricing?.baseName || row.item.name;
    next.name = hasLiteralPrice(sourceName) ? '' : sourceName;
    next.description=row.item.description??'';
    variant.name='Standard';variant.price=workspaceMoney(row.item.pricing?.priceCents);
    if(row.item.pricing?.kind==='TIMED'&&row.item.pricing.durationMin!==null)variant.duration=String(row.item.pricing.durationMin);
    if(row.item.pricing&&row.item.pricing.kind!=='ADD_ON')next.durationKind=row.item.pricing.kind;
    next.displays=[display];next.newGroups=[];next.defaultGroup='g:'+row.group;
    invalidate();setSnapshot(base);setDraft(next);setLayout(null);setLegacy(null);setNotice('已准备新服务草稿。请核对服务名称、规格价格和占用分钟，创建前可对照原文并选择展示方式。');
  });
  const removeDisplay = (itemId:string) => requestNavigate(()=>{
    if(!allMenuRows.some(row=>row.item.id===itemId)||!snapshot?.canManageCatalog)return;
    setDraft(null);setLayout(null);setLegacy(null);setRemoving(itemId);
  });
  const visibleItems = items;
  const openLayout = () => requestNavigate(() => { setDraft(null); setLegacy(null); setLayout({ groups: snapshot!.priceMenu.map((group,index) => ({ key: 'g:' + index, index, category: group.category })), moves: [], removals: [] }); });
  const saveLayout = () => {
    if (!layout || !snapshot || !eventCurrent() || blocked) return;
    try {
      const ref = (key: string) => key.startsWith('g:') ? { index: Number(key.slice(2)) } : { tempKey: key.slice(2) };
      if (layout.groups.some(group => !group.category.trim() || group.category.length > 200)) throw Error('分组名称须为 1–200 字。');
      const command: SaveMenuLayout = { action: 'SAVE_MENU_LAYOUT', idempotencyKey: workspaceKey(), expectedPriceMenuRevision: snapshot.priceMenuRevision,
        groups: layout.groups.map(group => ({ ...(group.index === undefined ? { tempKey: group.key.slice(2) } : { index: group.index }), category: group.category.trim() })), groupOrder: layout.groups.map(group => ref(group.key)),
        moves: layout.moves.map(move => ({ itemId: move.itemId, group: ref(move.group), position: Number(move.position) })), removeGroups: layout.removals.map(row => ({ index: row.index, moveTo: ref(row.moveTo) })) };
      if (command.moves?.some(row => !Number.isInteger(row.position) || row.position < 0 || row.position > 1000)) throw Error('位置须为 0–1000 的整数。');
      void dispatch(command);
    } catch (e) { setError(message(e)); }
  };
  const saveLegacy = () => {
    if (!legacy || !snapshot || !eventCurrent() || blocked) return;
    const original = allMenuRows.find(row => row.item.id === legacy.id)?.item; if (!original || original.booking) return;
    if (!legacy.name.trim() || legacy.name.length > 300 || legacy.description.length > 2000 || legacy.priceText.length > 300 || legacy.imageUrl && !safePriceMenuImage(legacy.imageUrl)) { setError('请核对展示标题、说明和图片地址。'); return; }
    const changes: SaveLegacyDisplay['changes'] = {};
    for (const key of ['name','priceText','description','imageUrl','isVisible'] as const) if (legacy[key] !== (key === 'isVisible' ? original.isVisible !== false : original[key] ?? '')) Object.assign(changes,{ [key]: legacy[key] });
    if (!Object.keys(changes).length) { setLegacy(null); return; }
    void dispatch({ action: 'SAVE_LEGACY_DISPLAY', idempotencyKey: workspaceKey(), expectedPriceMenuRevision: snapshot.priceMenuRevision, itemId: legacy.id, changes });
  };
  return <div ref={workspaceRoot} className="service-workspace min-w-0 space-y-5" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); } }}>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 ref={workspaceHeading} tabIndex={-1} className="text-lg font-semibold text-slate-800">服务与价格</h3><p className="mt-1 text-xs leading-6 text-slate-500">编辑当前服务后统一保存。所有美元金额均为整次服务总价。</p></div><div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={reloadBlocked} onClick={()=>requestNavigate(()=>{const serviceId=draftRef.current?.serviceId;invalidate();setDraft(null);setLayout(null);setLegacy(null);setCounter(v=>v+1);void loadSnapshot(serviceId);})}>重新载入</button><button type="button" className={primary} disabled={blocked || !snapshot?.canManageCatalog} onClick={() => requestNavigate(() => { if (!snapshot) return; const base = { ...snapshot, service: null, selectionRevision: null }; invalidate(); setSnapshot(base); setDraft(workspaceDraft(base)); setLayout(null); setLegacy(null); })}>＋ 新增服务</button><button type="button" className={secondary} disabled={blocked || !snapshot?.canManageCatalog} onClick={openLayout}>管理分组与顺序</button></div></header>
    {(error || snapshotError || catalogError) && <p id={errorSummaryId} ref={errorSummary} tabIndex={-1} role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-800">{[error, snapshotError, catalogError].filter(Boolean).join(' ')}</p>}{notice && <p role="status" className="break-words rounded-lg bg-teal-50 p-3 text-sm leading-6 text-teal-800">{notice}</p>}
    {unknown && <section role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><p>原保存结果待核对。关闭编辑区或普通刷新不会撤销保存；重复提交已锁定。原操作编号：<span className="break-all font-mono">{pending.current?.command.idempotencyKey}</span></p><div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={busy || storageBlocked} onClick={() => void reconcile(false)}>查询原保存回执</button><button type="button" className={secondary} disabled={busy || storageBlocked} onClick={() => void reconcile(true)}>核对并封存未执行操作</button></div></section>}
    {reviewed&&<section aria-label="已提交保存与当前资料对比" className="space-y-3 rounded-xl border border-amber-300 bg-white p-4"><h4 className="font-semibold">原保存已提交 · 当前资料存在差异</h4><p className="text-sm text-slate-600">下面是原请求和目前读到的资料。采用当前资料会放弃本地草稿，不重新保存；其他窗口的后续修改会保留。</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><WorkspaceComparison title="原保存草稿" attempt={reviewed.attempt}/><WorkspaceComparison title="当前已保存资料" snapshot={reviewed.snapshot}/></div><button type="button" className={secondary} disabled={busy||storageBlocked} onClick={()=>void adoptCurrent()}>放弃本地草稿，采用当前已保存资料</button></section>}
    {outdated && <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>已保存来源可能变化，本地草稿保留。不会用旧快照覆盖新资料。</p><button type="button" className={secondary} disabled={blocked} onClick={() => requestNavigate(() => void loadSnapshot(draft?.serviceId))}>放弃修改并载入最新基线</button></div>}
    <div className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"><Field label="搜索服务"><input className={control} value={searchInput} maxLength={100} disabled={blocked} onChange={e => setSearchInput(e.target.value)} /></Field><Field label="服务状态"><select className={control} value={status} disabled={blocked} onChange={e => { const value=e.target.value as typeof status; requestNavigate(() => { setStatus(value); setPage(1); }); }}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">暂停</option></select></Field><Field label="顾客展示"><select className={control} value={visibility} disabled={blocked} onChange={e => { const value=e.target.value; requestNavigate(() => {setVisibility(value);setPage(1);}); }}><option value="all">全部</option><option value="visible">有公开展示</option><option value="hidden">未公开展示</option></select></Field><button type="button" className={secondary + ' self-end'} disabled={blocked} onClick={() => requestNavigate(() => { setSearch(searchInput.trim()); setPage(1); setCounter(v=>v+1); })}>查询</button></div>
    {(loading||catalogLoading) && <p role="status" className="text-sm text-slate-500">正在读取完整服务与价目…</p>}
    {draft && snapshot && <section id={'workspace-service-' + (draft.serviceId ?? 'new')} tabIndex={-1} aria-label={draft.serviceId ? '编辑当前服务' : '创建服务'} className="workspace-editor min-w-0 space-y-5 rounded-xl border border-teal-200 bg-white p-4 sm:p-5">
      <div className="workspace-editor-heading"><div><p className="workspace-editor-eyebrow">{draft.serviceId ? '编辑服务' : '创建服务'}</p><h4 className="font-semibold text-slate-800">{draft.name || '未命名服务'}</h4><p className="workspace-editor-state">{previewState} · USD 整次总价</p></div><button type="button" className={secondary} onClick={() => setPreview(v => !v)}>预览顾客页面</button></div>
      <nav aria-label="当前服务页内导航" className="workspace-section-nav">{[['basics','基本资料'],['variants','规格与价格'],['displays','顾客展示'],['rules','预约规则'],['add-ons','附加项目']].map(([key,label])=><button key={key} type="button" aria-controls={sectionId(key)} onClick={()=>navigateSection(key)}>{label}</button>)}</nav>
      <fieldset id={sectionId('basics')} tabIndex={-1} disabled={blocked || !snapshot.canManageCatalog} className="workspace-editor-section workspace-service-basics">
        <Field label="服务名称 *" fieldId={fieldId('name')} issue={issue('name')}><input className={control} maxLength={200} value={draft.name} onChange={e => change(v => ({ ...v,name:e.target.value }))} /></Field>
        <div className="workspace-booking-control" data-enabled={draft.isActive}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => change(v => ({ ...v,isActive:e.target.checked }))} />启用服务，允许接受新预约</label><p>{draft.isActive ? '服务已启用；实际在线可约还需门店开放预约、规格启用及可用时段。' : '服务已暂停；所有规格停止接受新预约。'} 顾客价目显示单独控制。</p></div>
        <details className="workspace-service-description"><summary>分类、服务类型与说明</summary><div className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"><Field label="服务类别" fieldId={fieldId('category')} issue={issue('category')}><select className={control} value={draft.category} onChange={e => change(v => ({ ...v,category:e.target.value }))}>{PROJECT_METADATA_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field><Field label="服务类型" fieldId={fieldId('durationKind')} issue={issue('durationKind')}><select className={control} value={draft.durationKind} onChange={e => change(v => ({ ...v,durationKind:e.target.value }))}><option value="TIMED">固定时长</option><option value="PER_SESSION">按次（预约占用独立填写）</option><option value="VARIABLE">非固定时长（预约预留独立填写）</option></select></Field><div className="sm:col-span-2"><Field label="服务说明" fieldId={fieldId('description')} issue={issue('description')}><textarea className={control} rows={3} maxLength={10000} value={draft.description} onChange={e => change(v => ({ ...v,description:e.target.value }))} /></Field></div></div></details>
      </fieldset>
      {draft.serviceId && !snapshot.service?.hasVariants && <fieldset disabled={blocked || !snapshot.canManageCatalog} className="space-y-3 rounded-lg bg-slate-50 p-4"><h5 className="text-sm font-semibold">现有基础方案</h5><p className="text-xs leading-6 text-slate-500">旧服务目前使用此时长与价格。首次增加规格会保留基础方案及原展示位置，不替换已有编号。</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="预约占用分钟 *" fieldId={fieldId('duration')} issue={issue('duration')}><input className={control} inputMode="numeric" value={draft.duration} onChange={e => change(v => ({ ...v,duration:e.target.value }))} /></Field><Field label="整次价格（USD）*" fieldId={fieldId('price')} issue={issue('price')}><input className={control} inputMode="decimal" value={draft.price} onChange={e => change(v => ({ ...v,price:e.target.value }))} /></Field></div>{displayControls({kind:'SERVICE'})}</fieldset>}
      <section id={sectionId('variants')} tabIndex={-1} className="workspace-editor-section min-w-0 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-semibold text-slate-800">规格与价格 · {draft.variants.length}</h5><button type="button" className={secondary} disabled={blocked || !snapshot.canManageCatalog || draft.variants.length >= 200} onClick={addVariant}>＋ 添加规格</button></div><p className="text-xs leading-6 text-slate-500">每个规格填写整次总价与 5–240 分钟占用时间；金额不按顾客或技师人数相乘。</p>{issue('variants') && <p role="alert" className="text-sm text-red-700">{issue('variants')}</p>}
      {draft.variants.map((row,index) => <fieldset key={row.key} id={'workspace-variant-' + row.key} tabIndex={-1} aria-labelledby={fieldId(`variants.${index}.group-name`)} disabled={blocked || !snapshot.canManageCatalog} className="workspace-variant min-w-0 space-y-3 rounded-xl border border-slate-200 p-4">
        <legend id={fieldId(`variants.${index}.group-name`)} className="text-sm font-semibold text-slate-800">规格 {index + 1}</legend>
        <div className="workspace-variant-main"><Field label="规格名称 *" fieldId={fieldId(`variants.${index}.name`)} issue={issue(`variants.${index}.name`)}><input className={control} maxLength={100} value={row.name} onChange={e => change(v => ({ ...v,variants:v.variants.map(a => a.key===row.key ? {...a,name:e.target.value}:a) }))} /></Field><Field label="预约占用分钟 *" fieldId={fieldId(`variants.${index}.duration`)} issue={issue(`variants.${index}.duration`)}><input className={control} inputMode="numeric" value={row.duration} onChange={e => change(v => ({ ...v,variants:v.variants.map(a => a.key===row.key ? {...a,duration:e.target.value}:a) }))} /></Field><Field label="价格（USD）*" fieldId={fieldId(`variants.${index}.price`)} issue={issue(`variants.${index}.price`)}><input className={control} inputMode="decimal" value={row.price} onChange={e => change(v => ({ ...v,variants:v.variants.map(a => a.key===row.key ? {...a,price:e.target.value}:a) }))} /></Field></div>
        <div className="workspace-variant-controls"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.isActive} onChange={e => change(v => ({ ...v,variants:v.variants.map(a => a.key===row.key ? {...a,isActive:e.target.checked}:a) }))} />启用规格</label>{displayControls(row.id ? {kind:'VARIANT',id:row.id}:{kind:'VARIANT',tempKey:row.key})}{!row.id && <button type="button" className="text-sm text-red-700" onClick={() => change(v => ({...v,variants:v.variants.filter(a=>a.key!==row.key),displays:v.displays.filter(a=>targetKey(a.target)!==targetKey({kind:'VARIANT',tempKey:row.key}))}))}>移除未保存规格</button>}</div>
        <details className="workspace-variant-order"><summary>调整规格顺序</summary><div className="mt-3"><Field label="规格顺序" fieldId={fieldId(`variants.${index}.sortOrder`)} issue={issue(`variants.${index}.sortOrder`)}><input className={control} inputMode="numeric" value={row.sortOrder} onChange={e => change(v => ({ ...v,variants:v.variants.map(a => a.key===row.key ? {...a,sortOrder:e.target.value}:a) }))} /></Field></div></details>
      </fieldset>)}
      </section>
      <details id={sectionId('displays')} tabIndex={-1} className="workspace-editor-section rounded-xl border border-slate-200 p-4" open={focus?.itemId ? true : undefined}><summary className="cursor-pointer text-sm font-semibold">顾客展示 · {draft.displays.length} 处（标题、图片、分组与显示）</summary><fieldset disabled={blocked || !snapshot.canManageCatalog} className="mt-4 min-w-0 space-y-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="新增展示默认分组">{selectGroup(draft.defaultGroup,value=>change(v=>({...v,defaultGroup:value})))}</Field><Field label="新增展示默认图片">{imageControl('default',draft.defaultImage,value=>change(v=>({...v,defaultImage:value})))}</Field></div><button type="button" className={secondary} onClick={()=>change(v=>{const key=workspaceKey();return {...v,newGroups:[...v.newGroups,{key,category:''}],defaultGroup:'n:'+key};})}>＋ 在本次草稿新建分组</button>{draft.newGroups.map((group,index)=><Field key={group.key} label="新分组名称（随本服务保存）" fieldId={fieldId('newGroups.'+index)} issue={issue('newGroups.'+index)}><input className={control} maxLength={200} value={group.category} onChange={e=>change(v=>({...v,newGroups:v.newGroups.map(g=>g.key===group.key?{...g,category:e.target.value}:g)}))}/></Field>)}
      <button type="button" className={secondary} onClick={()=>change(v=>({...v,displays:v.displays.map(row=>({...row,group:v.defaultGroup,imageUrl:v.defaultImage}))}))}>明确应用默认分组与图片到全部展示位置</button><p className="text-xs leading-6 text-slate-500">默认值用于新建展示位置。点击上方按钮可将默认分组与图片应用到所有现有位置。</p>
      {draft.displays.map((row,index)=><DisplayEditor key={row.key} row={row} index={index} fieldId={fieldId} title={workspaceTitle(draft,row)} issue={issue} groups={selectGroup(row.group,value=>change(v=>({...v,displays:v.displays.map(a=>a.key===row.key?{...a,group:value}:a)})))} image={imageControl(row.key,row.imageUrl,value=>change(v=>({...v,displays:v.displays.map(a=>a.key===row.key?{...a,imageUrl:value}:a)})))} onChange={patch=>change(v=>({...v,displays:v.displays.map(a=>a.key===row.key?{...a,...patch}:a)}))} onRemove={row.id?()=>removeDisplay(row.id!):undefined}/>)}
      </fieldset></details>
      <details id={'workspace-rules-'+(draft.serviceId??'new')} tabIndex={-1} className="rounded-xl border border-slate-200 p-4" open={focus?.pane==='booking'?true:undefined}><summary className="cursor-pointer text-sm font-semibold">预约规则 · 顾客人数、技师、场地与缓冲</summary><fieldset disabled={blocked || !snapshot.canConfigurePolicy} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="服务方式" fieldId={fieldId('participantCount')} issue={issue('participantCount') ?? issue('requiredStaffCount')}><select className={control} value={draft.participantCount+':'+draft.requiredStaffCount} onChange={e=>{const [participantCount,requiredStaffCount]=e.target.value.split(':');change(v=>({...v,participantCount,requiredStaffCount,...(participantCount==='2'&&v.requiredRoomType!=='COUPLE'?{requiredRoomType:''}:{})}));}}><option value="1:1">单人 · 1 客 / 1 技师</option><option value="2:2">情侣 · 2 客 / 2 技师</option><option value="1:2">四手 · 1 客 / 2 技师</option></select></Field><Field label="所需场地" fieldId={fieldId('requiredRoomType')} issue={issue('requiredRoomType')}><select className={control} value={draft.requiredRoomType} onChange={e=>change(v=>({...v,requiredRoomType:e.target.value}))}><option value="">不绑定场地</option><option value="COUPLE">双人房</option>{draft.participantCount!=='2'&&<><option value="SINGLE">单人房</option><option value="FOOT_SEAT">独占足疗座位</option></>}</select></Field><Field label="技师收尾缓冲（分钟）" fieldId={fieldId('staffBuffer')} issue={issue('staffBuffer')}><input className={control} inputMode="numeric" value={draft.staffBuffer} onChange={e=>change(v=>({...v,staffBuffer:e.target.value}))}/></Field><Field label="场地清理缓冲（分钟）" fieldId={fieldId('roomBuffer')} issue={issue('roomBuffer')}><input className={control} inputMode="numeric" value={draft.roomBuffer} onChange={e=>change(v=>({...v,roomBuffer:e.target.value}))}/></Field><p className="text-xs leading-6 text-slate-500 sm:col-span-2">此规则由当前服务全部规格共用。不会建立技师排班或修改营业时间；未来有效预约的保护仍由服务端校验。</p></fieldset></details>
      <details id={sectionId('add-ons')} tabIndex={-1} className="workspace-editor-section rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">附加项目（可选）· {draft.addOns.length}</summary><fieldset disabled={blocked||!snapshot.canManageCatalog} className="mt-4 space-y-4"><p className="text-xs leading-6 text-slate-500">附加项为额外美元金额，可为零，不增加独立占用时间。</p>{draft.addOns.map((row,index)=><div key={row.key} className="space-y-3 rounded-lg border border-slate-200 p-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="附加项名称 *" fieldId={fieldId(`addOns.${index}.name`)} issue={issue(`addOns.${index}.name`)}><input className={control} maxLength={100} value={row.name} onChange={e=>change(v=>({...v,addOns:v.addOns.map(a=>a.key===row.key?{...a,name:e.target.value}:a)}))}/></Field><Field label="附加金额（USD）*" fieldId={fieldId(`addOns.${index}.price`)} issue={issue(`addOns.${index}.price`)}><input className={control} inputMode="decimal" value={row.price} onChange={e=>change(v=>({...v,addOns:v.addOns.map(a=>a.key===row.key?{...a,price:e.target.value}:a)}))}/></Field><Field label="顺序" fieldId={fieldId(`addOns.${index}.sortOrder`)} issue={issue(`addOns.${index}.sortOrder`)}><input className={control} inputMode="numeric" value={row.sortOrder} onChange={e=>change(v=>({...v,addOns:v.addOns.map(a=>a.key===row.key?{...a,sortOrder:e.target.value}:a)}))}/></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.isActive} onChange={e=>change(v=>({...v,addOns:v.addOns.map(a=>a.key===row.key?{...a,isActive:e.target.checked}:a)}))}/>启用附加项</label></div><Field label="附加项说明" fieldId={fieldId(`addOns.${index}.description`)} issue={issue(`addOns.${index}.description`)}><textarea className={control} maxLength={1000} value={row.description} onChange={e=>change(v=>({...v,addOns:v.addOns.map(a=>a.key===row.key?{...a,description:e.target.value}:a)}))}/></Field>{displayControls(row.id?{kind:'ADD_ON',id:row.id}:{kind:'ADD_ON',tempKey:row.key})}{!row.id&&<button type="button" className="text-sm text-red-700" onClick={()=>change(v=>({...v,addOns:v.addOns.filter(a=>a.key!==row.key),displays:v.displays.filter(a=>targetKey(a.target)!==targetKey({kind:'ADD_ON',tempKey:row.key}))}))}>移除未保存附加项</button>}</div>)}<button type="button" className={secondary} disabled={draft.addOns.length>=50} onClick={()=>change(v=>({...v,addOns:[...v.addOns,{key:workspaceKey(),name:'',description:'',price:'0.00',isActive:true,sortOrder:String(v.addOns.length)}]}))}>＋ 添加附加项</button></fieldset></details>
      {preview&&<section aria-label={'顾客预览 · ' + previewState} className="space-y-3 rounded-xl border border-dashed border-teal-400 bg-teal-50/40 p-4"><h5 className="text-sm font-semibold text-teal-900">顾客预览 · {previewState}</h5>{draft.displays.filter(row=>row.isVisible).map(row=><article key={row.key} className="flex min-w-0 gap-3 rounded-lg bg-white p-3">{imageSource(row.imageUrl)&&<img alt="" src={imageSource(row.imageUrl)} className="h-16 w-16 shrink-0 rounded-lg object-cover"/>}<div className="min-w-0"><p className="break-words font-semibold">{workspaceTitle(draft,row)}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{row.description}</p><p className="mt-1 text-xs text-slate-500">{groupOptions.find(g=>g.key===row.group)?.name}{!draft.isActive?' · Booking paused':''}</p></div></article>)}{!draft.displays.some(row=>row.isVisible)&&<p className="text-sm text-slate-500">当前草稿没有公开展示位置。</p>}</section>}
      <footer aria-label="当前服务保存" data-save-state={saveState} className="workspace-save-bar"><div className="workspace-save-context"><strong title={draft.name.trim() || '新服务'}>{draft.name.trim() || '新服务'}</strong><p role="status" aria-live="polite">{saveStatus}</p></div><div className="workspace-save-actions"><button type="button" className={secondary} disabled={blocked} onClick={()=>requestNavigate(()=>{invalidate();setDraft(null);setLayout(null);setLegacy(null);})}>放弃本次修改</button><button type="button" className={primary} disabled={blocked||!dirty||outdated} onClick={()=>saveService()}>{busy?'正在保存…':draft.serviceId?'保存当前服务':'创建服务'}</button></div></footer>
    </section>}
    {layout&&snapshot&&<section ref={layoutRegion} tabIndex={-1} role="region" aria-label="管理分组与顺序" aria-labelledby={layoutTitleId} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4"><h4 id={layoutTitleId} className="font-semibold">管理分组与顺序</h4><p className="text-xs text-slate-500">使用完整已保存价目，移动不会删除内容或暂停预约。</p><fieldset disabled={blocked} className="space-y-3">{layout.groups.map((group,index)=><div key={group.key} className="space-y-2 rounded-lg bg-slate-50 p-3"><input aria-label="分组名称" className={control} maxLength={200} value={group.category} onChange={e=>{if(!eventCurrent()||blocked)return;invalidate();setLayout({...layout,groups:layout.groups.map(g=>g.key===group.key?{...g,category:e.target.value}:g)});}}/><div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={!index} onClick={()=>{if(!eventCurrent()||blocked)return;const groups=[...layout.groups];[groups[index-1],groups[index]]=[groups[index],groups[index-1]];invalidate();setLayout({...layout,groups});}}>上移</button><button type="button" className={secondary} disabled={index===layout.groups.length-1} onClick={()=>{if(!eventCurrent()||blocked)return;const groups=[...layout.groups];[groups[index+1],groups[index]]=[groups[index],groups[index+1]];invalidate();setLayout({...layout,groups});}}>下移</button>{group.index!==undefined&&<Field label="移走内容并删除此分组"><select className={control} value="" onChange={e=>{if(!eventCurrent()||blocked||!e.target.value)return;invalidate();setLayout({...layout,groups:layout.groups.filter(g=>g.key!==group.key),removals:[...layout.removals,{index:group.index!,moveTo:e.target.value}]});}}><option value="">选择接收分组后移除…</option>{layout.groups.filter(g=>g.key!==group.key).map(g=><option key={g.key} value={g.key}>{g.category}</option>)}</select></Field>}</div></div>)}<button type="button" className={secondary} onClick={()=>{if(!eventCurrent()||blocked)return;invalidate();setLayout({...layout,groups:[...layout.groups,{key:'n:'+workspaceKey(),category:''}]});}}>＋ 新建分组</button><details><summary className="cursor-pointer text-sm font-semibold">移动展示位置 · {allMenuRows.length} 项</summary><div className="mt-3 space-y-3">{allMenuRows.map(row=><div key={row.item.id??`${row.group}_${row.position}`} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]"><span className="break-words text-sm">{row.item.name}</span><select aria-label="目标分组" className={control} disabled={!row.item.id} value={layout.moves.find(m=>m.itemId===row.item.id)?.group??'g:'+row.group} onChange={e=>{if(!eventCurrent()||blocked||!row.item.id)return;invalidate();setLayout({...layout,moves:[...layout.moves.filter(m=>m.itemId!==row.item.id),{itemId:row.item.id,group:e.target.value,position:layout.moves.find(m=>m.itemId===row.item.id)?.position??String(row.position)}]});}}>{layout.groups.map(g=><option key={g.key} value={g.key}>{g.category}</option>)}</select><input aria-label="目标位置" className={control} disabled={!row.item.id} inputMode="numeric" value={layout.moves.find(m=>m.itemId===row.item.id)?.position??String(row.position)} onChange={e=>{if(!eventCurrent()||blocked||!row.item.id)return;invalidate();setLayout({...layout,moves:[...layout.moves.filter(m=>m.itemId!==row.item.id),{itemId:row.item.id,group:layout.moves.find(m=>m.itemId===row.item.id)?.group??'g:'+row.group,position:e.target.value}]});}}/></div>)}</div></details></fieldset><div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={blocked} onClick={()=>requestNavigate(()=>setLayout(null))}>放弃本次修改</button><button type="button" className={primary} disabled={blocked} onClick={saveLayout}>保存分组与顺序</button></div></section>}
    <div className="min-w-0 space-y-3">{visibleItems.map(item=><article key={item.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words font-semibold text-slate-800">{item.name}</h4><p className="mt-1 text-xs leading-6 text-slate-500">{item.isActive?'启用':'暂停'} · {item.variantCount} 个规格 · {readReady && snapshotRead === 'ready' ? <>顾客价目显示 {menuRows(item.id).filter(row=>row.item.isVisible!==false).length}/{menuRows(item.id).length} 处</> : '顾客展示待核对'}</p><p className="mt-1 break-words text-xs leading-6 text-slate-600">{item.variants.length?item.variants.map(v=>`${v.name} · ${v.durationMin??'待填'} 分钟 · $${workspaceMoney(v.priceCents)}`).join(' / '):`${item.durationMin??'待填'} 分钟 · $${workspaceMoney(item.priceCents)}`}</p></div><button type="button" className={secondary} disabled={blocked} onClick={()=>requestNavigate(()=>void loadSnapshot(item.id))}>编辑</button></div></article>)}{catalogRead==='ready'&&!visibleItems.length&&<p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">当前页没有符合条件的服务。</p>}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500"><span>{catalogRead==='ready' ? <>共 {total} 个服务 · 第 {page} 页（按当前筛选）</> : '服务总数待核对'}</span><div className="flex gap-2"><button type="button" className={secondary} disabled={blocked||page<=1} onClick={()=>requestNavigate(()=>setPage(v=>v-1))}>上一页</button><button type="button" className={secondary} disabled={blocked||page*20>=total} onClick={()=>requestNavigate(()=>setPage(v=>v+1))}>下一页</button></div></div>
    {!!unlinked.length&&snapshot?.canManageCatalog&&<details className="workspace-legacy-tools min-w-0 rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">旧资料与关联 · {unlinked.length} 条待整理</summary><p className="mt-3 text-xs leading-6 text-slate-500">仅展示，暂不可预约。可编辑原文，或展开下方工具关联到具体服务规格。</p>{props.onOpenLegacyTools&&<button type="button" className={secondary} disabled={blocked} onClick={()=>requestNavigate(()=>props.onOpenLegacyTools?.())}>打开受保护的关联与移除工具</button>}<div className="mt-3 space-y-2">{unlinked.map(row=><div key={row.item.id??`${row.group}_${row.position}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"><span className="min-w-0 break-words text-sm">{row.item.name}</span><button type="button" className={secondary} disabled={blocked||!row.item.id} onClick={()=>requestNavigate(()=>{setDraft(null);setLayout(null);setLegacy({id:row.item.id!,name:row.item.name,priceText:row.item.priceText,description:row.item.description??'',imageUrl:row.item.imageUrl??'',isVisible:row.item.isVisible!==false});})}>编辑展示文字</button></div>)}</div><StoreLegacyProjectRepair snapshot={snapshot} disabled={blocked||!!layout||!!legacy} service={draft?.serviceId?snapshot.service:null} variants={draft?.variants??[]} associatedItemIds={new Set(draft?.displays.map(row => row.id))} onAssociate={associateLegacy} onConvert={convertLegacy} onRemove={removeDisplay}/></details>}
    {legacy&&<section aria-label="编辑旧展示文字" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold">编辑展示文字</h4><fieldset disabled={blocked} className="space-y-3"><Field label="标题"><input className={control} maxLength={300} value={legacy.name} onChange={e=>{if(eventCurrent()&&!blocked){invalidate();setLegacy({...legacy,name:e.target.value});}}}/></Field><Field label="原价格文字"><input className={control} maxLength={300} value={legacy.priceText} onChange={e=>{if(eventCurrent()&&!blocked){invalidate();setLegacy({...legacy,priceText:e.target.value});}}}/></Field><Field label="说明"><textarea className={control} maxLength={2000} value={legacy.description} onChange={e=>{if(eventCurrent()&&!blocked){invalidate();setLegacy({...legacy,description:e.target.value});}}}/></Field><Field label="图片">{imageControl('legacy',legacy.imageUrl,value=>{if(eventCurrent()&&!blocked){invalidate();setLegacy({...legacy,imageUrl:value});}})}</Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={legacy.isVisible} onChange={e=>{if(eventCurrent()&&!blocked){invalidate();setLegacy({...legacy,isVisible:e.target.checked});}}}/>顾客价目显示</label></fieldset><div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={blocked} onClick={()=>requestNavigate(()=>setLegacy(null))}>放弃本次修改</button><button type="button" className={primary} disabled={blocked} onClick={saveLegacy}>保存展示文字</button></div></section>}
    {snapshot && draft && legacyReview?.draft === draft && legacyReview.snapshot === snapshot && <WorkspaceModal label="核对旧价目关联" restoreFocus={restoreWorkspaceFocus} disabled={false} onCancel={dismissLegacyReview} wide>
      <LegacyAssociationReview rows={legacyAssociationRows(snapshot, draft)} disabled={blocked || outdated}
        onCancel={dismissLegacyReview} onConfirm={saveService} />
    </WorkspaceModal>}
    {removing&&<WorkspaceModal label="确认永久移除展示位置" restoreFocus={restoreWorkspaceFocus} disabled={blocked} onCancel={()=>setRemoving(null)}><div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl"><h4 className="font-semibold">永久移除此展示位置？</h4><p className="break-words text-sm">{allMenuRows.find(row=>row.item.id===removing)?.item.name}</p><p className="text-sm leading-6 text-amber-900">移除后不再保留此展示位置；服务、规格与历史订单仍保留。若移除最后关联位置，原规则可能暂停对应规格、附加项或旧基础服务，未来有效预约会阻止不安全移除。仅暂时不展示请取消并关闭显示开关。</p>{!!removalItem?.booking&&<p className="text-sm text-amber-900">该来源共有 {removalBindings} 处展示（含隐藏位置），移除后剩余 {Math.max(0,removalBindings-1)} 处。{removalBindings===1?"这是最后一处关联，可能同时暂停新预约。":"其他展示位置继续保留。"}</p>}<div className="flex flex-wrap justify-end gap-2"><button type="button" className={secondary} disabled={blocked} onClick={()=>setRemoving(null)}>取消</button><button type="button" className={primary} disabled={blocked} onClick={()=>{if(!eventCurrent()||blocked||!snapshot)return;const itemId=removing;setRemoving(null);void dispatch({action:'REMOVE_MENU_DISPLAY',idempotencyKey:workspaceKey(),expectedPriceMenuRevision:snapshot.priceMenuRevision,itemId,confirm:true});}}>确认永久移除</button></div></div></WorkspaceModal>}
    {navigation&&<WorkspaceModal label="未保存的服务修改" restoreFocus={restoreWorkspaceFocus} disabled={operationBusy||unknown||storageBlocked} onCancel={()=>setNavigation(null)}><div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl"><h4 className="font-semibold">有未保存修改</h4><p className="text-sm leading-6 text-slate-500">继续编辑，或明确放弃本次修改后再切换。</p><div className="flex flex-wrap justify-end gap-2"><button type="button" className={secondary} disabled={operationBusy} onClick={()=>setNavigation(null)}>继续编辑</button><button type="button" className={primary} disabled={operationBusy} onClick={()=>void discardNavigation()}>{imageOperation === 'discard' ? '正在清理暂存图片…' : '放弃修改并继续'}</button></div></div></WorkspaceModal>}
  </div>;
}

function DisplayEditor({ row,index,title,issue,fieldId,groups,image,onChange,onRemove }: { row:WorkspaceDisplayDraft; index:number; title:string; issue:(field:string)=>string|undefined; fieldId:(field:string)=>string; groups:ReactNode; image:ReactNode; onChange:(patch:Partial<WorkspaceDisplayDraft>)=>void; onRemove?:()=>void }) {
  return <div id={'workspace-display-'+(row.id??row.key)} tabIndex={-1} className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-sm font-semibold">{title||'新展示位置'}</span><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.isVisible} onChange={e=>onChange({isVisible:e.target.checked})}/>显示此位置</label></div><div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><Field label="展示分组" fieldId={fieldId(`displays.${index}.group`)} issue={issue(`displays.${index}.group`)}>{groups}</Field><Field label="分组内位置（0起，留空末尾）" fieldId={fieldId(`displays.${index}.position`)} issue={issue(`displays.${index}.position`)}><input className={control} inputMode="numeric" placeholder="末尾" value={row.position} onChange={e=>onChange({position:e.target.value})}/></Field><Field label="标题方式"><select className={control} value={row.titleMode} onChange={e=>onChange({titleMode:e.target.value as 'AUTO'|'CUSTOM',...(e.target.value==='CUSTOM'&&!row.name?{name:title}:{})})}><option value="AUTO">自动随服务与价格更新</option><option value="CUSTOM">保留自定义文案</option></select></Field><Field label="顾客标题" fieldId={fieldId(`displays.${index}.name`)} issue={issue(`displays.${index}.name`)}><input className={control} maxLength={300} disabled={row.titleMode==='AUTO'} value={row.titleMode==='AUTO'?title:row.name} onChange={e=>onChange({name:e.target.value})}/></Field><div className="sm:col-span-2"><Field label="展示说明" fieldId={fieldId(`displays.${index}.description`)} issue={issue(`displays.${index}.description`)}><textarea className={control} rows={3} maxLength={2000} value={row.description} onChange={e=>onChange({description:e.target.value})}/></Field></div><div className="sm:col-span-2"><Field label="展示图片" fieldId={fieldId(`displays.${index}.imageUrl`)} issue={issue(`displays.${index}.imageUrl`)}>{image}</Field></div></div>{row.titleMode==='CUSTOM'&&<p className="text-xs leading-6 text-amber-700">自定义标题会保留；修改金额或时长后请核对文案，系统不会静默覆盖。</p>}{onRemove&&<button type="button" className="text-sm text-red-700" onClick={onRemove}>永久移除此展示位置…</button>}{!row.id&&!row.key.startsWith('w')&&<p role="alert" className="text-xs text-red-700">此旧位置缺少稳定编号，不能安全修改，请载入最新资料。</p>}</div>;
}
