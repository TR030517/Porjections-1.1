import { useEffect, useId, useRef, useState } from 'react';
import { analyzePriceMenuPaste, appendPriceMenu, PRICE_MENU_LIMITS, PRICE_MENU_TEMPLATE_CONTENT, PRICE_MENU_TEMPLATE_FILENAME, type PriceMenuGroup, type PriceMenuItem } from '../../utils/priceMenu';
import { initialPriceMenuLocation, locatePriceMenuItem, movePriceMenuEntry, PRICE_MENU_PAGE_SIZE, priceMenuPage, searchPriceMenu, type PriceMenuLocation, type PriceMenuSearchMatch } from '../../utils/priceMenuNavigation';
import { PRICE_MENU_CATALOG } from '../../utils/priceMenuCatalog';
import { PRICE_MENU_GALLERY } from '../../utils/priceMenuGallery';
import { cloneNextPriceMenuItem, firstPriceMenuItem } from '../../utils/priceMenuQuickEntry';
import { removePriceMenuDraftGroup, removePriceMenuDraftItem } from '../../utils/priceMenuDraftReferences';
import { applyCatalogOption, applyCatalogPricingPatch, applyCatalogVariantParent, catalogFamilyKeyForItem, conditionForMenu, copyCatalogSelection, inheritCatalogSelections, isExplicitCatalogDescendant, mapCatalogFamily, upsertCatalogSelection, type CatalogSelectionPrecondition, type MenuCatalogLoader, type MenuCatalogOption } from '../../utils/catalogSelection';
import { matchPriceMenuImage, parsePriceMenuStepCents } from '../../utils/priceMenuImageMatch';
import { safePriceMenuImage } from '../../utils/priceMenu';
import PriceMenuSuggestionInput from './PriceMenuSuggestionInput';
import PriceMenuItemPricingFields from './PriceMenuItemPricingFields';
import { formatPriceMenuDollars, formatPriceMenuTitle, PRICE_MENU_KINDS, priceMenuKindLabel, type PriceMenuKind, type PriceMenuPricing } from '../../utils/priceMenuPricing';
import PriceMenuBookingFields from './PriceMenuBookingFields';
import MenuCatalogPicker from './MenuCatalogPicker';
import PriceMenuRemovalConfirmation from './PriceMenuRemovalConfirmation';
import { preparePriceMenuRemoval, priceMenuFamilySize, priceMenuRemovalIsCurrent, type PriceMenuRemovalRequest } from '../../utils/priceMenuEditingImpact';
import './StorePriceMenuEditor.css';

interface FocusTarget extends PriceMenuSearchMatch { sequence: number; }
type ImportAnalysis = ReturnType<typeof analyzePriceMenuPaste>;
interface GroupEntryPreferences { minuteStep: string; priceStep: string; firstKind: PriceMenuKind; }
const EMPTY_ENTRY_PREFERENCES: Readonly<GroupEntryPreferences> = Object.freeze({ minuteStep:'', priceStep:'', firstKind:'TIMED' });
const EMPTY_CATALOG_SELECTIONS: readonly CatalogSelectionPrecondition[] = [];
export interface StorePriceMenuEditorProps {
  value: PriceMenuGroup[]; onChange: (value: PriceMenuGroup[], selections?: CatalogSelectionPrecondition[]) => boolean; disabled?: boolean; pasteText?: string; onPasteTextChange?: (value: string) => boolean; onConfigureService?: (serviceId: string) => void;
  onEditService?: (serviceId: string, variantId?: string) => void;
  catalogLoader?: MenuCatalogLoader; catalogShopId?: string; catalogScopeKey?: string;
  catalogSelections?: readonly CatalogSelectionPrecondition[]; catalogSelectionAllowed?: boolean;
  catalogConflictedItemIds?: readonly string[]; catalogRefreshRevision?: number; policyEditable?: boolean;
  bookingActivationAllowed?: boolean;
  focusRequest?: { groupIndex: number; itemIndex: number; revision: number };
}

/** The download is always a fixed example; no store draft or pasted text enters it. */
export function downloadPriceMenuTemplate(doc: Document = document): void {
  const link = doc.createElement('a');
  link.href = 'data:text/tab-separated-values;charset=utf-8,' + encodeURIComponent(PRICE_MENU_TEMPLATE_CONTENT);
  link.download = PRICE_MENU_TEMPLATE_FILENAME; link.hidden = true;
  doc.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
}

export function PriceMenuImportIssues({ analysis, id }: { analysis: ImportAnalysis; id?: string }) {
  if (!analysis.errorCount) return null;
  const issues = analysis.issues.slice(0, 20), remaining = Math.max(0, analysis.errorCount - issues.length);
  const fields: Record<number, string> = analysis.format === 'STRUCTURED' ? { 1:'大类',2:'项目基础名称',3:'项目类型',4:'时长',5:'价格',6:'说明' } : { 1: '分组', 2: '项目名称', 3: '价格', 4: '说明' };
  return <div className="price-menu-error price-menu-import-issues" role="alert" id={id}>
    <p>检测到 {analysis.errorCount} 处问题，已保留粘贴内容和当前草稿，未生成可追加预览。</p>
    <ul>{issues.map((issue, index) => <li key={index}><strong>第 {issue.line} 行{issue.column ? ` · 第 ${issue.column} 列${fields[issue.column] ? `（${fields[issue.column]}）` : ''}` : ''}</strong><span>{issue.message}</span></li>)}</ul>
    {remaining > 0 && <p>另有 {remaining} 处问题未展开；先修正上述内容，再重新解析。</p>}
  </div>;
}

export default function StorePriceMenuEditor({ value, onChange, disabled = false, pasteText, onPasteTextChange, onConfigureService, onEditService, catalogLoader, catalogShopId, catalogScopeKey,
  catalogSelections = EMPTY_CATALOG_SELECTIONS, catalogSelectionAllowed = false, catalogConflictedItemIds, catalogRefreshRevision, policyEditable = true, bookingActivationAllowed = true, focusRequest }: StorePriceMenuEditorProps) {
  const id = useId(), panelId = `${id}-group-panel`;
  const editorRef = useRef<HTMLDivElement>(null), groupHeadingRef = useRef<HTMLHeadingElement>(null), focusSequence = useRef(0);
  const [location, setLocation] = useState<PriceMenuLocation>(() => initialPriceMenuLocation(value));
  const [query, setQuery] = useState(''), [highlight, setHighlight] = useState<PriceMenuSearchMatch | null>(null), [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [localPaste, setLocalPaste] = useState(''), [analysis, setAnalysis] = useState<{ source: string; result: ImportAnalysis } | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const groupPreferences = useRef(new WeakMap<PriceMenuGroup, GroupEntryPreferences>());
  const [, refreshPreferences] = useState(0);
  const [galleryTarget, setGalleryTarget] = useState<string | null>(null), [galleryQuery, setGalleryQuery] = useState('');
  const [bindingTarget, setBindingTarget] = useState<string | null>(null);
  const [catalogPolicyPermission, setCatalogPolicyPermission] = useState<boolean | undefined>(undefined);
  const [pendingRemoval, setPendingRemoval] = useState<PriceMenuRemovalRequest | null>(null);
  const removalMounted = useRef(false), removalGeneration = useRef(0), removalRequest = useRef<PriceMenuRemovalRequest | null>(null);
  const removalContext = useRef({ value, disabled, catalogScopeKey, catalogShopId, groupIndex: location.groupIndex });
  const removalFeedback = useRef<{ value: PriceMenuGroup[]; message: string; catalogScopeKey?: string; catalogShopId?: string } | null>(null);
  useEffect(() => { removalMounted.current = true; return () => { removalMounted.current = false; removalRequest.current = null; }; }, []);
  useEffect(() => { setPendingRemoval(null); setBindingTarget(null); }, [catalogScopeKey]);
  useEffect(() => {
    const feedback = removalFeedback.current;
    if (feedback && (feedback.value !== value || feedback.catalogScopeKey !== catalogScopeKey || feedback.catalogShopId !== catalogShopId)) {
      removalFeedback.current = null;
      setNotice(current => current === feedback.message ? '' : current);
    }
  }, [value, catalogScopeKey, catalogShopId]);
  // View preferences follow item identities through edits/reordering, never enter saved menu data.
  const imageModes = useRef(new WeakMap<PriceMenuItem, boolean>()), imageOrigins = useRef(new WeakMap<PriceMenuItem, 'auto' | 'manual'>());
  const paste = pasteText ?? localPaste;
  const rejected = () => { setNotice(''); setError('当前编辑上下文已变化或父层未接收修改，草稿和粘贴内容已保留。请重新确认当前门店后重试。'); return false; };
  const setPaste = (text: string) => {
    if (onPasteTextChange) { if (onPasteTextChange(text) !== true) return rejected(); }
    else if (pasteText !== undefined) return rejected();
    else setLocalPaste(text);
    return true;
  };
  const visibleAnalysis = analysis?.source === paste ? analysis.result : null;
  const visiblePreview = visibleAnalysis && visibleAnalysis.errorCount === 0 && visibleAnalysis.groups.length > 0 ? visibleAnalysis.groups : null;
  const count = value.reduce((sum, group) => sum + group.items.length, 0);
  const active = priceMenuPage(value, location), entry = value[active.groupIndex];
  // Retained controls belong to one complete controlled draft and editing context.
  // Rotate synchronously, including when an equal snapshot replaces the draft or
  // a temporarily disabled / different-shop editor later returns to the same state.
  const previousRemoval = removalContext.current;
  if (previousRemoval.value !== value || previousRemoval.disabled !== disabled || previousRemoval.catalogScopeKey !== catalogScopeKey || previousRemoval.catalogShopId !== catalogShopId || previousRemoval.groupIndex !== active.groupIndex) {
    removalContext.current = { value, disabled, catalogScopeKey, catalogShopId, groupIndex: active.groupIndex };
    removalGeneration.current++; removalRequest.current = null;
  }
  const removalRender = removalGeneration.current;
  const removalCurrent = () => removalMounted.current && removalGeneration.current === removalRender && !removalContext.current.disabled;
  const visibleRemoval = pendingRemoval && removalRequest.current === pendingRemoval ? pendingRemoval : null;
  const closeRemoval = (request: PriceMenuRemovalRequest) => {
    if (!removalCurrent() || removalRequest.current !== request) return;
    removalRequest.current = null; setPendingRemoval(null);
  };
  const removed = (next: PriceMenuGroup[], message: string) => {
    removalGeneration.current++; removalRequest.current = null; setPendingRemoval(null);
    removalFeedback.current = { value: next, message, catalogScopeKey, catalogShopId }; setNotice(message);
  };
  const { minuteStep, priceStep, firstKind } = entry ? groupPreferences.current.get(entry) ?? EMPTY_ENTRY_PREFERENCES : EMPTY_ENTRY_PREFERENCES;
  const setEntryPreferences = (patch: Partial<GroupEntryPreferences>) => {
    if (disabled || !entry) return;
    groupPreferences.current.set(entry, { ...(groupPreferences.current.get(entry) ?? EMPTY_ENTRY_PREFERENCES), ...patch });
    refreshPreferences(revision => revision + 1);
  };
  const inheritPreferences = (previous: PriceMenuGroup, next: PriceMenuGroup) => {
    const preferences = groupPreferences.current.get(previous);
    if (preferences) groupPreferences.current.set(next, { ...preferences });
  };
  const usesMinutes = entry?.items.length ? !entry.items.at(-1)?.pricing || entry.items.at(-1)?.pricing?.kind === 'TIMED' : firstKind === 'TIMED';
  const search = searchPriceMenu(value, query);

  useEffect(() => { setAnalysis(null); setError(''); }, [paste]);
  useEffect(() => { setCatalogPolicyPermission(undefined); }, [catalogScopeKey]);

  useEffect(() => {
    setLocation(current => {
      const next = priceMenuPage(value, current);
      return next.groupIndex === current.groupIndex && next.page === current.page ? current : { groupIndex: next.groupIndex, page: next.page };
    });
  }, [value]);
  useEffect(() => {
    if (!focusTarget || focusTarget.groupIndex !== active.groupIndex) return;
    if (focusTarget.itemIndex !== null && (focusTarget.itemIndex < active.startIndex || focusTarget.itemIndex >= active.endIndex)) return;
    const row = focusTarget.itemIndex === null ? null : editorRef.current?.querySelector<HTMLElement>(`[data-price-menu-item="${focusTarget.itemIndex}"]`);
    const input = row?.querySelector<HTMLInputElement>('input');
    const target = focusTarget.itemIndex === null ? groupHeadingRef.current : disabled ? row : input;
    target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'nearest' });
    setFocusTarget(null);
  }, [focusTarget, active.groupIndex, active.startIndex, active.endIndex, disabled]);

  const locate = (menu: PriceMenuGroup[], groupIndex: number, itemIndex: number | null) => {
    setGalleryTarget(null); setBindingTarget(null);
    setLocation(locatePriceMenuItem(menu, groupIndex, itemIndex)); setQuery('');
    const target = { groupIndex, itemIndex }; setHighlight(target); setFocusTarget({ ...target, sequence: ++focusSequence.current });
  };
  useEffect(() => { if (focusRequest && value[focusRequest.groupIndex]?.items[focusRequest.itemIndex]) locate(value, focusRequest.groupIndex, focusRequest.itemIndex); }, [focusRequest]);
  const change = (next: PriceMenuGroup[], selections: readonly CatalogSelectionPrecondition[] = catalogSelections, explicitlySelected = false) => {
    if (disabled) return false;
    let cleaned: CatalogSelectionPrecondition[];
    try {
      const inheritedBeforeDelete = inheritCatalogSelections(value, catalogSelections);
      const requestedIds = new Set(selections.map(row => row.itemId));
      const complete = [...selections, ...inheritedBeforeDelete.filter(row => !requestedIds.has(row.itemId))];
      cleaned = conditionForMenu(next, inheritCatalogSelections(next, complete));
    } catch (error) { setError(error instanceof Error ? error.message : '目录版本无法核对，请重新选择。'); return false; }
    // The parent accepts menu and catalog conditions in one synchronous receipt.
    // Calling a callback alone is not evidence that the controlled draft changed.
    const selectionChange = explicitlySelected || JSON.stringify(cleaned) !== JSON.stringify(catalogSelections) ? cleaned : undefined;
    try { if (onChange(next, selectionChange) !== true) return rejected(); }
    catch (error) { setNotice(''); setError(error instanceof Error ? error.message : '父层未接收修改，当前草稿保留。'); return false; }
    setNotice(''); setError(''); return true;
  };
  const replaceGroup = (index: number, next: PriceMenuGroup, selections: readonly CatalogSelectionPrecondition[] = catalogSelections) => {
    if (disabled) return null;
    inheritPreferences(value[index], next);
    const menu = value.map((item, at) => at === index ? next : item);
    return change(menu, selections) ? menu : null;
  };
  const group = (index: number, next: PriceMenuGroup) => replaceGroup(index, next) !== null;
  const automatic = (entryItem: PriceMenuItem) => imageModes.current.get(entryItem) ?? true;
  const item = (groupIndex: number, itemIndex: number, patch: Partial<PriceMenuItem>, mode?: boolean, origin?: 'auto' | 'manual') => {
    const previous = value[groupIndex].items[itemIndex], next = { ...previous, ...patch };
    imageModes.current.set(next, mode ?? automatic(previous)); imageOrigins.current.set(next, origin ?? imageOrigins.current.get(previous) ?? 'manual');
    return group(groupIndex, { ...value[groupIndex], items: value[groupIndex].items.map((entryItem, at) => at === itemIndex ? next : entryItem) });
  };
  const parentKey = (row: PriceMenuItem) => catalogFamilyKeyForItem(row, value);
  const inheritFamilyPreferences = (next: PriceMenuGroup[]) => value.forEach((previousGroup, groupIndex) => {
    inheritPreferences(previousGroup, next[groupIndex]);
    next[groupIndex].items.forEach((row, index) => {
      const previous = previousGroup.items[index];
      if (row !== previous && !imageModes.current.has(row)) { imageModes.current.set(row, automatic(previous)); imageOrigins.current.set(row, imageOrigins.current.get(previous) ?? 'manual'); }
    });
  });
  const pricingItem = (itemIndex: number, patch: Partial<PriceMenuPricing>, customTitle?: string) => {
    if (!entry || disabled) return;
    const previous = entry.items[itemIndex]; if (!previous.pricing) return;
    const sharedKey = parentKey(previous);
    if (sharedKey && !previous.booking?.addOnId && value.some(group => group.items.some(row => row !== previous && parentKey(row) === sharedKey)) && (Object.hasOwn(patch, 'baseName') || Object.hasOwn(patch, 'kind'))) {
      const shared = { ...(Object.hasOwn(patch, 'baseName') ? { baseName: patch.baseName } : {}), ...(Object.hasOwn(patch, 'kind') ? { kind: patch.kind, ...(patch.kind !== 'TIMED' ? { durationMin: null } : {}) } : {}) };
      const next = mapCatalogFamily(value, previous, row => {
        if (!row.pricing) return row;
        const updated = applyCatalogPricingPatch(row, row === previous ? patch : shared), pricing = updated.pricing!;
        const replace = Object.hasOwn(patch, 'baseName') && automatic(row) && (!row.imageUrl || imageOrigins.current.get(row) === 'auto');
        if (replace) updated.imageUrl = matchPriceMenuImage(value.find(group => group.items.includes(row))?.category ?? entry.category, pricing.baseName)?.url ?? '';
        imageModes.current.set(updated, automatic(row)); imageOrigins.current.set(updated, replace ? 'auto' : imageOrigins.current.get(row) ?? 'manual');
        return updated;
      });
      inheritFamilyPreferences(next); change(next);
      return;
    }
    const updated = applyCatalogPricingPatch(previous, patch), pricing = updated.pricing!, name = pricing.titleMode === 'AUTO' ? updated.name : customTitle ?? previous.name;
    const replace = Object.hasOwn(patch,'baseName') && automatic(previous) && (!previous.imageUrl || imageOrigins.current.get(previous) === 'auto');
    const image = replace ? matchPriceMenuImage(entry.category, pricing.baseName) : null;
    item(active.groupIndex, itemIndex, { ...updated, name, priceText:'', pricing, reservedDurationMin: updated.reservedDurationMin, ...(replace ? { imageUrl: image?.url ?? '' } : {}) }, undefined, replace ? 'auto' : undefined);
  };
  const bookingItem = (itemIndex: number, patch: Partial<PriceMenuItem>) => {
    const previous = entry?.items[itemIndex];
    if (previous && parentKey(previous) && !previous.booking?.addOnId && Object.hasOwn(patch, 'bookingMode')) {
      const next = mapCatalogFamily(value, previous, row => ({ ...row, ...(row === previous ? patch : { bookingMode: patch.bookingMode }) }));
      inheritFamilyPreferences(next); change(next);
    } else item(active.groupIndex, itemIndex, patch);
  };
  const selectCatalog = (itemIndex: number, option: MenuCatalogOption, action: 'bind' | 'addOnParent' | 'variantParent') => {
    if (!entry || disabled || !bookingActivationAllowed || !catalogSelectionAllowed) return false;
    const previous = entry.items[itemIndex]; if (!previous) return false;
    const stableId = previous.id ?? crypto.randomUUID();
    let next: PriceMenuItem;
    try {
      if (action === 'addOnParent') {
        if (previous.pricing?.kind !== 'ADD_ON') throw new Error('请先将项目类型设置为附加项目，再选择主项目。');
        next = { ...previous, id: stableId, booking: { serviceId: option.serviceId }, bookingAvailable: false,
          bookingUnavailableReason: !option.isActive ? 'PARENT_PAUSED' : previous.bookingEnabled ? 'CONFIGURATION_REQUIRED' : 'ITEM_PAUSED' };
        delete next.newVariantOf; delete next.reservedDurationMin; delete next.bookingMode;
      } else next = action === 'variantParent' ? applyCatalogVariantParent(previous, option, stableId) : applyCatalogOption(previous, option, stableId);
    } catch (error) { setError(error instanceof Error ? error.message : '所选目录无法核对，当前草稿未替换。'); return false; }
    const replaceImage = action !== 'addOnParent' && previous.pricing?.baseName !== next.pricing?.baseName && automatic(previous) && (!previous.imageUrl || imageOrigins.current.get(previous) === 'auto');
    if (replaceImage) next.imageUrl = matchPriceMenuImage(entry.category, next.pricing?.baseName ?? next.name)?.url ?? '';
    imageModes.current.set(next, automatic(previous)); imageOrigins.current.set(next, replaceImage ? 'auto' : imageOrigins.current.get(previous) ?? 'manual');
    const nextGroup = { ...entry, items: entry.items.map((row, at) => at === itemIndex ? next : row) };
    inheritPreferences(entry, nextGroup);
    let menu = value.map((group, at) => at === active.groupIndex ? nextGroup : group);
    if (previous.id && action !== 'addOnParent' && option.preview?.pricing?.kind !== 'ADD_ON') {
      const descendants = new Set(value.flatMap(group => group.items).filter(row => isExplicitCatalogDescendant(row, previous.id!, value)));
      menu = menu.map(group => ({ ...group, items: group.items.map(row => {
        if (!descendants.has(row) || !row.pricing) return row;
        const updated = applyCatalogVariantParent(row, option, row.id ?? crypto.randomUUID());
        updated.newVariantOf = row.newVariantOf;
        const replace = row.pricing.baseName !== updated.pricing?.baseName && automatic(row) && (!row.imageUrl || imageOrigins.current.get(row) === 'auto');
        if (replace) updated.imageUrl = matchPriceMenuImage(group.category, updated.pricing?.baseName ?? updated.name)?.url ?? '';
        imageModes.current.set(updated, automatic(row)); imageOrigins.current.set(updated, replace ? 'auto' : imageOrigins.current.get(row) ?? 'manual');
        return updated;
      }) }));
      inheritFamilyPreferences(menu);
    }
    const conditions = upsertCatalogSelection(catalogSelections, { itemId: stableId, serviceId: option.serviceId, expectedSelectionRevision: option.selectionRevision });
    if (!change(menu, conditions, true)) return false;
    setNotice(action === 'addOnParent' ? '已选择本店主项目；附加项名称与价格保留在当前草稿，明确保存后才会配置。' : action === 'variantParent' ? '已重新确认新规格的主项目；当前规格的独立价格、分钟与图片说明均保留。' : '已载入所选目录的真实名称、价格和时长；展示标题、图片与说明可继续调整，明确保存后才会同步关联。');
    return true;
  };
  const convertItem = (itemIndex: number) => {
    if (!entry || disabled) return;
    const previous = entry.items[itemIndex], pricing: PriceMenuPricing = {kind:'TIMED',baseName:previous.name,durationMin:null,priceCents:null,titleMode:'AUTO',legacySource:{name:previous.name,priceText:previous.priceText}};
    if (item(active.groupIndex,itemIndex,{name:formatPriceMenuTitle(pricing),priceText:'',pricing})) setNotice('请核对基础名称，移除其中重复的旧时长、价格，并明确设置项目类型与新数值。原内容已保留为参考，不从旧文字猜金额或分钟数。');
  };
  const switchImage = (itemIndex: number, enabled: boolean) => {
    if (!entry || disabled) return;
    const previous = entry.items[itemIndex], match = enabled && !previous.imageUrl ? matchPriceMenuImage(entry.category, previous.pricing?.baseName ?? previous.name) : null;
    if (item(active.groupIndex, itemIndex, enabled ? match ? { imageUrl: match.url } : {} : { imageUrl: '' }, enabled, match ? 'auto' : 'manual')) setNotice(enabled ? '已开启本项自动配图，已有自选图片保留。' : '已关闭本项自动配图并清空图片地址，仍可手动选择图片。');
  };
  const rematchImage = (itemIndex: number) => {
    if (!entry || disabled) return;
    const match = matchPriceMenuImage(entry.category, entry.items[itemIndex].pricing?.baseName ?? entry.items[itemIndex].name);
    if (!match) { setNotice('图库暂无匹配图片，现有图片保持不变，可从图库手动选择。'); return; }
    if (item(active.groupIndex, itemIndex, { imageUrl: match.url }, undefined, 'auto')) setNotice('已按当前项目重新匹配通用图片，保存后才会更新顾客页面。');
  };
  const addGroup = () => {
    if (value.length >= PRICE_MENU_LIMITS.groups) return;
    const next = [...value, { category: '', items: [] }]; if (change(next)) locate(next, next.length - 1, null);
  };
  const moveGroup = (offset: number) => {
    const target = active.groupIndex + offset;
    if (target < 0 || target >= value.length) return;
    const next = movePriceMenuEntry(value, active.groupIndex, target); if (change(next)) locate(next, target, null);
  };
  const removeGroup = () => {
    if (!removalCurrent()) return;
    const next = removePriceMenuDraftGroup(value, active.groupIndex);
    if (next === value) return;
    const previousItems = new Map(value.flatMap(group => group.items.flatMap(row => row.id ? [[row.id, row] as const] : [])));
    next.forEach(group => group.items.forEach(row => {
      const previous = row.id ? previousItems.get(row.id) : undefined;
      if (previous && previous !== row) { imageModes.current.set(row, automatic(previous)); imageOrigins.current.set(row, imageOrigins.current.get(previous) ?? 'manual'); }
    }));
    value.forEach((previous, index) => { if (index !== active.groupIndex) inheritPreferences(previous, next[index < active.groupIndex ? index : index - 1]); });
    if (!change(next)) return;
    removed(next, '已从当前草稿移除分组；其余规格的草稿来源已保留，保存后才会同步。');
    setHighlight(null); setFocusTarget(null); setQuery(''); setGalleryTarget(null);
    setLocation({ groupIndex: next.length ? Math.min(active.groupIndex, next.length - 1) : -1, page: 0 });
  };
  const addItem = () => {
    if (disabled || !entry || count >= PRICE_MENU_LIMITS.items) return;
    let prepared: ReturnType<typeof cloneNextPriceMenuItem>;
    try {
      if (usesMinutes && !/^(?:0|[1-9]\d{0,3})$/.test(minuteStep)) throw new Error('请填写 0–1440 的整数分钟；首个固定时长项目须大于 0。');
      const values = { minutes: usesMinutes ? Number(minuteStep) : 0, priceCents: parsePriceMenuStepCents(priceStep) };
      prepared = entry.items.length ? cloneNextPriceMenuItem(entry.items.at(-1), values) : firstPriceMenuItem(entry.category, values, firstKind);
    } catch (error) { setError(error instanceof Error ? error.message : '请核对递增步长，当前项目未改变。'); return; }
    const itemIndex = entry.items.length;
    const previous = entry.items.at(-1);
    let previousItems = entry.items;
    prepared.item.id = crypto.randomUUID();
    if (previous?.pricing && previous.pricing.kind !== 'ADD_ON' && !previous.booking?.addOnId) {
      const source = previous.id ? previous : { ...previous, id: crypto.randomUUID() };
      previousItems = entry.items.map((row, at) => at === entry.items.length - 1 ? source : row);
      prepared.item.newVariantOf = previous.booking?.serviceId ?? previous.newVariantOf ?? `item:${source.id}`;
      prepared.item.bookingEnabled = false;
    }
    if (!policyEditable && !prepared.item.bookingMode && !prepared.item.newVariantOf && prepared.item.pricing?.kind !== 'ADD_ON') prepared.item.bookingMode = 'SINGLE';
    prepared.item.isVisible = false;
    if (!previous) { const image=matchPriceMenuImage(entry.category,prepared.item.pricing?.baseName??entry.category);if(image)prepared.item.imageUrl=image.url; }
    imageModes.current.set(prepared.item, previous ? automatic(previous) : true);
    imageOrigins.current.set(prepared.item, previous ? imageOrigins.current.get(previous) ?? 'manual' : prepared.item.imageUrl ? 'auto' : 'manual');
    const selections = previous ? copyCatalogSelection(catalogSelections, previous, prepared.item, value) : catalogSelections;
    const next = replaceGroup(active.groupIndex, { ...entry, items: [...previousItems, prepared.item] }, selections);
    if (next) { locate(next, active.groupIndex, itemIndex); setNotice(prepared.notice + (prepared.item.newVariantOf ? ' 新项归属同一主项目的独立规格，预约默认关闭；明确开启后共用技师资格。' : '') + ' 新展示行默认隐藏；请在服务与价格工作区完成关联并核对预约配置后，再开启顾客展示。'); }
  };
  const moveItem = (itemIndex: number, offset: number) => {
    const target = itemIndex + offset;
    if (!entry || target < 0 || target >= entry.items.length) return;
    const next = replaceGroup(active.groupIndex, { ...entry, items: movePriceMenuEntry(entry.items, itemIndex, target) });
    if (next) locate(next, active.groupIndex, target);
  };
  const removeItem = (itemIndex: number) => {
    if (!removalCurrent() || !entry) return;
    const next = removePriceMenuDraftItem(value, active.groupIndex, itemIndex);
    if (next === value) return;
    const previousItems = new Map(value.flatMap(group => group.items.flatMap(row => row.id ? [[row.id, row] as const] : [])));
    next.forEach(group => group.items.forEach(row => {
      const previous = row.id ? previousItems.get(row.id) : undefined;
      if (previous && previous !== row) { imageModes.current.set(row, automatic(previous)); imageOrigins.current.set(row, imageOrigins.current.get(previous) ?? 'manual'); }
    }));
    value.forEach((previous, index) => inheritPreferences(previous, next[index]));
    if (!change(next)) return;
    removed(next, '已从当前草稿移除项目；其余规格已按原有来源重新关联，保存后才会同步。');
    const remaining = next[active.groupIndex].items;
    locate(next, active.groupIndex, remaining.length ? Math.min(itemIndex, remaining.length - 1) : null);
  };
  const requestRemoval = (itemIndex?: number) => {
    if (!removalCurrent()) return;
    const request = preparePriceMenuRemoval(value, active.groupIndex, itemIndex);
    if (!request) return;
    if (request.impacts.every(impact => impact.kind === 'display')) { if (itemIndex === undefined) removeGroup(); else removeItem(itemIndex); return; }
    removalRequest.current = request; setPendingRemoval(request);
  };
  const confirmRemoval = () => {
    if (!removalCurrent() || !visibleRemoval || removalRequest.current !== visibleRemoval) return;
    if (visibleRemoval.groupIndex !== active.groupIndex || !priceMenuRemovalIsCurrent(value, visibleRemoval)) { closeRemoval(visibleRemoval); setError('价目草稿已变化，未移除任何项目。请重新选择并核对移除范围。'); return; }
    const request = visibleRemoval; closeRemoval(request);
    if (request.itemIndex === undefined) removeGroup(); else removeItem(request.itemIndex);
  };
  const showPage = (page: number) => { if (entry) locate(value, active.groupIndex, entry.items.length ? page * PRICE_MENU_PAGE_SIZE : null); };
  const parse = () => {
    if (disabled) return;
    setError(''); setNotice('');
    try { setAnalysis({ source: paste, result: analyzePriceMenuPaste(paste) }); }
    catch (error) { setAnalysis(null); setError(error instanceof Error ? error.message : '粘贴内容无法解析。'); }
  };
  const downloadTemplate = () => {
    if (disabled) return;
    try { downloadPriceMenuTemplate(); }
    catch { setError('模板下载未能开始，请检查浏览器下载设置后重试。现有草稿和粘贴内容已保留。'); }
  };
  const clearPaste = () => { if (disabled || !setPaste('')) return; setAnalysis(null); setError(''); };
  const apply = () => {
    if (!visiblePreview || disabled) return;
    try {
      const added = visiblePreview.reduce((sum, groupEntry) => sum + groupEntry.items.length, 0);
      const importedDraft = visiblePreview.map(groupEntry => ({ ...groupEntry, items: groupEntry.items.map(entryItem => ({ ...entryItem, isVisible: false })) }));
      const next = appendPriceMenu(value, importedDraft);
      // appendPriceMenu clones the full menu. Preserve local image preferences for
      // original coordinates; newly appended items retain their default settings.
      value.forEach((groupEntry, groupIndex) => {
        if (next[groupIndex]) inheritPreferences(groupEntry, next[groupIndex]);
        groupEntry.items.forEach((previous, itemIndex) => {
        const cloned = next[groupIndex]?.items[itemIndex];
        if (cloned) { imageModes.current.set(cloned, automatic(previous)); imageOrigins.current.set(cloned, imageOrigins.current.get(previous) ?? 'manual'); }
      }); });
      const existing = value.findIndex(groupEntry => groupEntry.category === visiblePreview[0].category);
      const groupIndex = existing < 0 ? value.length : existing, itemIndex = existing < 0 ? 0 : value[existing].items.length;
      if (!change(next)) return;
      locate(next, groupIndex, itemIndex); setAnalysis(null);
      if (!setPaste('')) { setError('价目已接收为本地草稿，但粘贴内容未能清除；请勿重复追加，确认当前门店后清除粘贴内容。'); return; }
      setAnalysis(null); setNotice(`已追加 ${added} 条展示行草稿，当前均隐藏，并定位首条新增展示行。请在服务与价格工作区完成关联、核对预约配置后，再开启顾客展示。`);
    } catch (error) { setError(error instanceof Error ? error.message : '无法追加价目。'); }
  };
  const pagination = (position: 'top' | 'bottom') => active.pageCount > 1 && <nav className="price-menu-pagination" aria-label={`当前分组项目分页${position === 'top' ? '顶部' : '底部'}`}>
    <button type="button" disabled={active.page === 0} onClick={() => showPage(active.page - 1)}>上一页</button>
    <label><span className="price-menu-visually-hidden">选择项目页码</span><select aria-label={`选择项目页码${position === 'top' ? '顶部' : '底部'}`} value={active.page} onChange={event => showPage(Number(event.target.value))}>{Array.from({ length: active.pageCount }, (_, page) => <option key={page} value={page}>第 {page + 1} / {active.pageCount} 页</option>)}</select></label>
    <button type="button" disabled={active.page >= active.pageCount - 1} onClick={() => showPage(active.page + 1)}>下一页</button>
  </nav>;

  return <div className="price-menu-editor" ref={editorRef}>
    <div className="price-menu-note">顾客价目布局：在这里调整展示分组、展示行顺序、标题、说明与图片。真实服务的共同资料、规格名称、价格和时长在服务与价格工作区维护；本页只读显示每条关联的目录摘要。旧数据转换与关联修复在各行的独立折叠区，修改先进入草稿，明确保存后才生效。</div>
    <div className="price-menu-toolbar"><strong>顾客价目布局 · {value.length} 个展示分组 · {count} 条展示行</strong><button type="button" disabled={disabled || value.length >= PRICE_MENU_LIMITS.groups} onClick={addGroup}>＋ 新增分组</button></div>
    {value.length > 0 && <div className="price-menu-search"><label htmlFor={`${id}-search`}><span>查找并定位</span><input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目标题、大类、价格或说明" aria-controls={`${id}-search-results`} /></label><p>搜索只用于定位，编辑区始终保留完整分组与项目；点击结果后清除搜索。</p>
      {query.trim() && <div id={`${id}-search-results`} className="price-menu-search-results"><p role="status">找到 {search.total} 处{search.total > search.matches.length ? `，先显示 ${search.matches.length} 处，请补充关键词缩小范围` : ''}。</p><ul>{search.matches.map(match => {
        const foundGroup = value[match.groupIndex], foundItem = match.itemIndex === null ? null : foundGroup.items[match.itemIndex];
        return <li key={`${match.groupIndex}:${match.itemIndex}`}><button type="button" onClick={() => locate(value, match.groupIndex, match.itemIndex)}><span className="price-menu-search-title">{foundItem ? foundItem.name || '待填写名称' : foundGroup.category || '未命名分组'}</span><span>第 {match.groupIndex + 1} 组 · {foundGroup.category || '未命名分组'}{match.itemIndex === null ? ` · ${foundGroup.items.length} 项` : ` · 第 ${match.itemIndex + 1} 项`}</span>{foundItem && <span>{foundItem.pricing ? '' : foundItem.priceText || '价格待设置'}{foundItem.description ? ` · ${foundItem.description}` : ''}</span>}</button></li>;
      })}</ul><button type="button" onClick={() => setQuery('')}>清除搜索</button></div>}
    </div>}
    {!value.length && <div className="price-menu-empty">尚未填写顾客价目布局。可新增展示分组，或从表格批量粘贴展示行。</div>}
    {entry && <div className="price-menu-workspace">
      <nav className="price-menu-group-navigation" aria-label="顾客价目展示分组"><span className="price-menu-navigation-title">展示分组 · {value.length} 组</span><ul>{value.map((groupEntry, groupIndex) => <li key={groupIndex}><button type="button" id={`${id}-group-nav-${groupIndex}`} className={active.groupIndex === groupIndex ? 'is-active' : ''} aria-expanded={active.groupIndex === groupIndex} aria-controls={panelId} onClick={() => locate(value, groupIndex, null)}><span>{groupIndex + 1}. {groupEntry.category || '未命名分组'}</span><small>{groupEntry.items.length} 条展示行{active.groupIndex === groupIndex ? ' · 正在编辑' : ''}</small></button></li>)}</ul></nav>
      <section className="price-menu-group" id={panelId} aria-labelledby={`${id}-group-nav-${active.groupIndex}`} key={active.groupIndex}>
        <div className="price-menu-group-title"><h3 ref={groupHeadingRef} tabIndex={-1}>第 {active.groupIndex + 1} 组 · {entry.category || '未命名分组'}</h3><p>仅展开当前分组，其余 {value.length - 1} 组仍保留在完整草稿中。</p></div>
        <div className="price-menu-group-heading"><label><span>展示分组名称</span><PriceMenuSuggestionInput disabled={disabled} label={`第 ${active.groupIndex + 1} 组名称`} maxLength={PRICE_MENU_LIMITS.category} value={entry.category} placeholder="选择常用分类，或自定义名称" suggestions={PRICE_MENU_CATALOG.map(group => ({ value: group.category, label: group.categoryZh }))} onChange={category => group(active.groupIndex, { ...entry, category })} /></label><div className="price-menu-actions"><button type="button" disabled={disabled || active.groupIndex === 0} onClick={() => moveGroup(-1)}>上移分组</button><button type="button" disabled={disabled || active.groupIndex === value.length - 1} onClick={() => moveGroup(1)}>下移分组</button><button type="button" className="price-menu-remove" disabled={disabled} onClick={() => requestRemoval()}>移除分组</button></div></div>
        <div className="price-menu-range" role="status">{entry.items.length ? `当前显示第 ${active.startIndex + 1}–${active.endIndex} 条 / 本组共 ${active.itemCount} 条展示行，每页最多 ${PRICE_MENU_PAGE_SIZE} 条。` : '本组暂无展示行；展示分组名称会保留，可用于分类或促销说明。'}</div>
        {pagination('top')}
        {entry.items.slice(active.startIndex, active.endIndex).map((entryItem, localIndex) => {
          const itemIndex = active.startIndex + localIndex;
          const binding = entryItem.booking, pricing = entryItem.pricing, repairKey = `${active.groupIndex}:${entryItem.id ?? itemIndex}`;
          return <div className={`price-menu-item${highlight?.groupIndex === active.groupIndex && highlight.itemIndex === itemIndex ? ' is-located' : ''}`} key={entryItem.id ?? itemIndex} data-price-menu-item={itemIndex} tabIndex={-1} aria-label={`本组第 ${itemIndex + 1} 项`}>
            <div className="price-menu-item-title">展示行 {itemIndex + 1}<span>{entryItem.name || '待填写展示标题'}</span></div>
            <div className="price-menu-item-fields">
              {binding && <section className="price-menu-wide price-menu-source-summary" aria-label={`本组第 ${itemIndex + 1} 项关联来源`}>
                <strong>只读目录摘要 · {binding.addOnId ? '附加项' : binding.variantId ? '规格' : '服务'}</strong>
                <p>服务 #{binding.serviceId}{binding.variantId ? ` / 规格 #${binding.variantId}` : binding.addOnId ? ` / 附加项 #${binding.addOnId}` : ''}</p>
                <dl><div><dt>{binding.addOnId ? '附加项名称' : '服务名称'}</dt><dd>{pricing?.baseName || '目录名称待核对'}</dd></div>
                  <div><dt>{binding.addOnId ? '本附加项加价' : binding.variantId ? '本规格金额（整次）' : '本服务金额（整次）'}</dt><dd>{pricing?.priceCents != null ? `USD ${formatPriceMenuDollars(pricing.priceCents)}` : '目录金额待核对'}</dd></div>
                  <div><dt>时长</dt><dd>{!pricing ? '目录时长待核对' : pricing.kind === 'ADD_ON' ? '不增加预约时长' : pricing.kind === 'TIMED' ? pricing.durationMin != null ? `${pricing.durationMin} 分钟` : '目录时长待核对' : `${priceMenuKindLabel(pricing.kind)}${entryItem.reservedDurationMin ? ` · 预约占用 ${entryItem.reservedDurationMin} 分钟` : ' · 预约占用待核对'}`}</dd></div>
                  <div><dt>当前预约配置</dt><dd>{entryItem.bookingEnabled === true ? entryItem.bookingAvailable === false ? '已启用 · 当前不可预约' : '已启用' : entryItem.bookingEnabled === false ? '已停用' : '启用状态待核对'}</dd></div></dl>
                <small>{binding.variantId ? '金额与时长来自本行关联规格；其他规格按各自金额与时长计价。' : binding.addOnId ? '附加项不能独立预约；资料在所属服务维护。' : '此摘要仅对应当前关联服务，不代表其其他规格的报价。'}摘要按当前载入资料显示，实际可约时段另行计算。</small>
                {!!entryItem.id && catalogConflictedItemIds?.includes(entryItem.id) && <p role="alert">所选目录已变化，当前草稿保留。请在旧数据与关联修复中重新核对本店目录。</p>}
                <div className="price-menu-actions">{onEditService && <button type="button" disabled={disabled} aria-label={`本组第 ${itemIndex + 1} 项维护来源`} onClick={() => onEditService(binding.serviceId, binding.variantId)}>{binding.variantId ? '维护此服务与规格' : binding.addOnId ? '维护所属服务' : '维护此服务'}</button>}{onConfigureService && <button type="button" disabled={disabled} onClick={() => onConfigureService(binding.serviceId)}>预约规则</button>}</div>
              </section>}
              {!binding && <p className="price-menu-wide price-menu-layout-unbound">{entryItem.newVariantOf ? '新规格草稿尚未保存：请先核对旧数据与关联修复，或在服务与价格工作区创建规格后关联。' : entryItem.isVisible === false ? '此展示行尚未关联真实服务或规格，当前已隐藏。请在服务与价格工作区完成关联、核对预约配置后，再开启顾客展示。' : '此展示行尚未关联真实服务或规格。顾客可以看到展示内容，但无法在线预约；请先完成关联，再继续使用此显示状态。'}</p>}
              <div className="price-menu-wide price-menu-title-preview"><span>顾客看到的展示标题</span><strong>{entryItem.name || '待填写展示标题'}</strong>
                {pricing ? <><div className="price-menu-actions"><button type="button" disabled={disabled} aria-label={`本组第 ${itemIndex + 1} 项切换展示标题`} onClick={() => pricingItem(itemIndex, { titleMode: pricing.titleMode === 'AUTO' ? 'CUSTOM' : 'AUTO' })}>{pricing.titleMode === 'AUTO' ? '自定义展示标题' : '恢复自动展示标题'}</button></div>
                  {pricing.titleMode === 'CUSTOM' && <input aria-label={`本组第 ${itemIndex + 1} 项展示标题`} disabled={disabled} maxLength={PRICE_MENU_LIMITS.name} value={entryItem.name} onChange={event => pricingItem(itemIndex, {}, event.target.value)} />}
                  <small>{pricing.titleMode === 'AUTO' ? '自动标题使用本行关联资料生成；自定义标题仅改变展示文字。' : '自定义文字不会修改真实名称、价格或时长；手写金额或分钟请自行核对。'}</small></>
                  : <><input aria-label={`本组第 ${itemIndex + 1} 项展示标题`} disabled={disabled} maxLength={PRICE_MENU_LIMITS.name} value={entryItem.name} onChange={event => item(active.groupIndex, itemIndex, { name: event.target.value })} /><small>{entryItem.priceText ? `保留的展示价文字：${entryItem.priceText}` : '尚未配置结构化价格。'}旧内容转换与预约关联在下方修复区。</small></>}
              </div>
              <label className="price-menu-wide"><span>展示行说明</span><textarea disabled={disabled} aria-label={`本组第 ${itemIndex + 1} 项说明`} maxLength={PRICE_MENU_LIMITS.description} rows={2} value={entryItem.description ?? ''} placeholder="顾客看到的补充说明，可留空" onChange={event => item(active.groupIndex, itemIndex, { description: event.target.value })} /></label>
              {catalogSelectionAllowed ? <details className="price-menu-wide price-menu-repair"><summary>旧数据与关联修复</summary>
                <p>仅用于迁移旧内容或修正关联。已关联服务、规格的真实名称、价格与时长须从上方维护入口修改；选择目录只更新当前展示草稿，仍需明确保存。</p>
                {binding ? <><button type="button" disabled={disabled || !bookingActivationAllowed} onClick={() => setBindingTarget(bindingTarget === repairKey ? null : repairKey)}>更换展示行关联</button>
                  {bindingTarget === repairKey && <MenuCatalogPicker purpose={binding.addOnId ? 'addOn' : 'main'} loader={catalogLoader} shopId={catalogShopId} scopeKey={catalogScopeKey} disabled={disabled || !bookingActivationAllowed} refreshRevision={catalogRefreshRevision}
                    initialService={binding.variantId || binding.addOnId ? { serviceId: binding.serviceId, name: pricing?.baseName ?? entryItem.name } : undefined}
                    onSelect={(option, canConfigurePolicy) => { if (selectCatalog(itemIndex, option, 'bind')) { setCatalogPolicyPermission(canConfigurePolicy); setBindingTarget(null); } }} onClose={() => setBindingTarget(null)} onPolicyPermission={setCatalogPolicyPermission} />}</>
                  : <div className="price-menu-item-fields">{priceMenuFamilySize(value, entryItem) > 1 && <p className="price-menu-wide price-menu-family-help">此草稿与同一服务系列的 {priceMenuFamilySize(value, entryItem)} 条展示行有关联。旧数据转换中的基础名称、类型与预约方式可能同步到该系列，请先核对关联再保存。</p>}
                    <PriceMenuItemPricingFields entryItem={entryItem} category={entry.category} itemIndex={itemIndex} disabled={disabled} onPricing={patch => pricingItem(itemIndex, patch)} onTitle={title => pricingItem(itemIndex, {}, title)} onConvert={() => convertItem(itemIndex)} />
                    <PriceMenuBookingFields item={entryItem} menu={value} disabled={disabled} onChange={patch => bookingItem(itemIndex, patch)} onConfigureService={onConfigureService}
                      catalogLoader={catalogLoader} catalogShopId={catalogShopId} catalogScopeKey={catalogScopeKey} catalogRefreshRevision={catalogRefreshRevision} policyEditable={policyEditable && catalogPolicyPermission !== false} onCatalogPolicyPermission={setCatalogPolicyPermission}
                      bookingActivationAllowed={bookingActivationAllowed} catalogConflicted={!!entryItem.id && catalogConflictedItemIds?.includes(entryItem.id)}
                      onCatalogSelect={(option, action) => selectCatalog(itemIndex, option, action)} />
                  </div>}
              </details> : <p className="price-menu-wide price-menu-hint">旧数据与关联修复需要本店目录维护权限，现有关联和展示内容保留。</p>}
              {entryItem.pricing?.legacySource&&<details className="price-menu-wide price-menu-legacy-source"><summary>转换前内容参考</summary><p>{entryItem.pricing.legacySource.name} {entryItem.pricing.legacySource.priceText}</p></details>}
              <div className="price-menu-wide price-menu-image-field"><div className="price-menu-image-heading"><strong>展示行图片（选填）</strong><button type="button" role="switch" aria-label={`本组第 ${itemIndex + 1} 项自动配图`} aria-checked={automatic(entryItem)} disabled={disabled} className={automatic(entryItem) ? 'price-menu-image-switch is-on' : 'price-menu-image-switch'} onClick={() => switchImage(itemIndex, !automatic(entryItem))}><span aria-hidden="true" />自动配图{automatic(entryItem) ? '已开启' : '已关闭'}</button></div>
                <div className="price-menu-image-controls">{entryItem.imageUrl && safePriceMenuImage(entryItem.imageUrl) && <img src={safePriceMenuImage(entryItem.imageUrl)!} alt="当前项目图片" loading="lazy" referrerPolicy="no-referrer" />}<div><label><span>图片地址</span><input disabled={disabled} aria-label={`本组第 ${itemIndex + 1} 项图片地址`} maxLength={PRICE_MENU_LIMITS.imageUrl} value={entryItem.imageUrl ?? ''} placeholder="从图库选择，或填写 HTTPS / 本店受管图片地址" onChange={event => item(active.groupIndex, itemIndex, { imageUrl: event.target.value }, undefined, 'manual')} /></label><div className="price-menu-actions"><button type="button" disabled={disabled} onClick={() => { setGalleryTarget(current => current === `${active.groupIndex}:${itemIndex}` ? null : `${active.groupIndex}:${itemIndex}`); setGalleryQuery(''); }}>从图库选择</button><button type="button" disabled={disabled} onClick={() => rematchImage(itemIndex)}>重新匹配</button></div></div></div>
                {galleryTarget === `${active.groupIndex}:${itemIndex}` && <div className="price-menu-gallery" aria-label={`本组第 ${itemIndex + 1} 项通用图库`}><div className="price-menu-image-heading"><label><span>查找图库</span><input type="search" disabled={disabled} aria-label="查找通用项目图片" placeholder="例如 足部 / 热石 / facial" value={galleryQuery} onChange={event => setGalleryQuery(event.target.value)} /></label><button type="button" onClick={() => setGalleryTarget(null)}>收起图库</button></div><div className="price-menu-gallery-grid">{PRICE_MENU_GALLERY.filter(image => [image.title, image.titleZh, ...image.keywords].join(' ').toLocaleLowerCase().includes(galleryQuery.trim().toLocaleLowerCase())).map(image => <button key={image.key} type="button" disabled={disabled} aria-label={`选择图库图片 ${image.titleZh}`} onClick={() => { if (item(active.groupIndex, itemIndex, { imageUrl: image.url }, undefined, 'manual')) setGalleryTarget(null); }}><img src={image.url} alt={image.titleZh} loading="lazy" /><span>{image.titleZh}</span></button>)}</div><p>通用项目素材；选图只写入当前草稿，手动选图保留。</p></div>}
              </div>
            </div>
            <div className="price-menu-actions"><span>本展示分组中的第 {itemIndex + 1} 条展示行</span><button type="button" disabled={disabled || itemIndex === 0} onClick={() => moveItem(itemIndex, -1)}>上移</button><button type="button" disabled={disabled || itemIndex === entry.items.length - 1} onClick={() => moveItem(itemIndex, 1)}>下移</button><button type="button" className="price-menu-remove" disabled={disabled} onClick={() => requestRemoval(itemIndex)}>移除展示行</button></div>
          </div>;
        })}
        {pagination('bottom')}
        <div className="price-menu-step-settings"><strong>{entry.items.length ? '复制上一展示行并递增' : '设置第 1 条展示行的初始值'}</strong>
          {!entry.items.length && <label className="price-menu-wide"><span>项目类型</span><select disabled={disabled} aria-label="首项项目类型" value={firstKind} onChange={event=>setEntryPreferences({firstKind:event.target.value as PriceMenuKind})}>{PRICE_MENU_KINDS.map(kind=><option key={kind} value={kind}>{priceMenuKindLabel(kind)}</option>)}</select></label>}
          <label><span>{entry.items.length ? '时间步长（分钟）' : '初始时长（分钟）'}</span><input disabled={disabled||!usesMinutes} inputMode="numeric" aria-label={entry.items.length ? '新增项目时间步长' : '首项初始时长'} value={usesMinutes?minuteStep:''} placeholder={usesMinutes?'请输入分钟数':'此类型不填写分钟'} onChange={event => setEntryPreferences({minuteStep:event.target.value})} /></label>
          <label><span>{entry.items.length ? '价格步长（美元）' : '初始价格（美元）'}</span><input disabled={disabled} inputMode="decimal" aria-label={entry.items.length ? '新增项目价格步长' : '首项初始价格'} value={priceStep} placeholder="请输入美元金额" onChange={event => setEntryPreferences({priceStep:event.target.value})} /></label>
          <p>{entry.items.length ? '继续添加将复制本组最后一条展示行，按步长生成新规格草稿。0 表示保持不变；非固定时长类型只递增价格。已有真实规格请在修复区明确关联，避免重复创建；新服务请在服务与价格工作区新增。' : '填写后点击添加，生成第 1 条展示行草稿。之后可调整数值作为递增步长；说明与图片随上一条复制。新服务请在服务与价格工作区新增。'}</p>
        </div>
        <button type="button" className="price-menu-add-item" disabled={disabled || count >= PRICE_MENU_LIMITS.items} onClick={addItem}>＋ 添加展示行并定位</button>
      </section>
    </div>}
    <details className="price-menu-paste" open={paste ? true : undefined}><summary>批量粘贴顾客展示行</summary>
      <div className="price-menu-import-help"><p>使用模板的「大类 → 项目基础名称 → 项目类型 → 时长（分钟）→ 价格（美元）→ 说明」六列，列之间用 Tab 分隔；按次、非固定时长和附加项目的时长留空。旧表格仍可兼容导入，下载不改动现有草稿。</p><button type="button" disabled={disabled} onClick={downloadTemplate}>下载表格模板</button></div>
      <p className="price-menu-import-warning">此操作只追加顾客展示行，新增行默认隐藏；不会创建或启用预约服务。请在服务与价格工作区完成关联、核对预约配置后，再开启顾客展示。日常新增、改价和上架请使用服务与价格工作区。</p><p>先预览，再追加展示行到当前草稿；已有展示行保留。切组与翻页不会清除粘贴内容。错误行号对应原始粘贴内容，空行和带引号的多行说明也会计入。</p>
      <label htmlFor={`${id}-paste`}>表格内容</label><textarea id={`${id}-paste`} disabled={disabled} rows={5} value={paste} aria-invalid={visibleAnalysis?.errorCount ? true : undefined} aria-describedby={visibleAnalysis?.errorCount ? `${id}-import-issues` : undefined} onChange={event => { if (disabled || !setPaste(event.target.value)) return; setAnalysis(null); setError(''); setNotice(''); }} placeholder={'大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明\nBody Massage\tBody Massage\tTIMED\t30\t50\tOptional notes'} /><button type="button" disabled={disabled || !paste.trim()} onClick={parse}>解析并预览</button>{paste && <><button type="button" disabled={disabled} onClick={clearPaste}>清除粘贴内容</button><p role="status">粘贴内容尚未追加。请先预览并追加，或清除后再保存门店。</p></>}
      {visibleAnalysis && <PriceMenuImportIssues analysis={visibleAnalysis} id={`${id}-import-issues`} />}
      {visiblePreview && <div className="price-menu-paste-preview"><p>待追加 {visiblePreview.length} 个顾客展示分组、{visiblePreview.reduce((sum, groupEntry) => sum + groupEntry.items.length, 0)} 条展示行</p><ul>{visiblePreview.flatMap(groupEntry => groupEntry.items.map(entryItem => ({ category: groupEntry.category, ...entryItem }))).slice(0, 8).map((previewItem, index) => <li key={index}>{previewItem.category ? `${previewItem.category} · ` : ''}{previewItem.name}{previewItem.priceText ? ` — ${previewItem.priceText}` : ''}</li>)}</ul><button type="button" disabled={disabled} onClick={apply}>确认追加到本店草稿</button></div>}
    </details>
    {visibleRemoval && <PriceMenuRemovalConfirmation request={visibleRemoval} disabled={disabled} onCancel={() => closeRemoval(visibleRemoval)} onConfirm={confirmRemoval} />}
    {error && <p className="price-menu-error" role="alert">{error}</p>}{notice && <p className="price-menu-note" role="status">{notice}</p>}
    <p className="price-menu-hint">最多 100 个展示分组、1000 条展示行，总内容不超过 768 KiB。导航与搜索只改变查看位置；移除和排序只更改当前草稿，明确保存后才同步到顾客页面。</p>
  </div>;
}
