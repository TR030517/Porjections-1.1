import { useCallback, useEffect, useState } from 'react';
import type { PriceMenuGroup, PriceMenuItem } from '../../utils/priceMenu';
import { createMenuCatalogReader, sourceServiceIdForItem, type MenuCatalogLoader, type MenuCatalogOption } from '../../utils/catalogSelection';
import MenuCatalogPicker, { catalogPreviewDescription, type MenuCatalogPurpose } from './MenuCatalogPicker';
import { bookingModeHelp, inheritedBookingMode } from '../../utils/bookingModeHelp';

export interface PriceMenuBookingFieldsProps {
  item: PriceMenuItem; menu: PriceMenuGroup[]; disabled: boolean; onChange: (patch: Partial<PriceMenuItem>) => void;
  onConfigureService?: (serviceId: string) => void;
  catalogLoader?: MenuCatalogLoader; catalogShopId?: string; catalogScopeKey?: string; catalogRefreshRevision?: number;
  catalogConflicted?: boolean; policyEditable?: boolean;
  bookingActivationAllowed?: boolean;
  onCatalogPolicyPermission?: (allowed: boolean) => void;
  onCatalogSelect?: (option: MenuCatalogOption, action: 'bind' | 'addOnParent' | 'variantParent') => void;
}
export default function PriceMenuBookingFields({ item, menu, disabled, onChange, onConfigureService, catalogLoader, catalogShopId, catalogScopeKey, catalogRefreshRevision, onCatalogPolicyPermission,
  catalogConflicted = false, policyEditable = true, bookingActivationAllowed = true, onCatalogSelect }: PriceMenuBookingFieldsProps) {
  const addOn = item.pricing?.kind === 'ADD_ON';
  const parentId = sourceServiceIdForItem(item, menu);
  const knownParent = parentId ? menu.flatMap(group => group.items).find(row => row.booking?.serviceId === parentId && !row.booking?.addOnId && row.pricing?.kind !== 'ADD_ON') : undefined;
  const knownParentName = knownParent?.pricing?.baseName;
  const [parentMetadata, setParentMetadata] = useState<{ scope: string; serviceId: string; name: string; bookingMode?: PriceMenuItem['bookingMode'] } | undefined>(undefined);
  const [picker, setPicker] = useState<MenuCatalogPurpose | null>(null);
  const [catalogPolicy, setCatalogPolicy] = useState<boolean | undefined>(undefined);
  const setPermission = useCallback((allowed: boolean) => { setCatalogPolicy(allowed); onCatalogPolicyPermission?.(allowed); }, [onCatalogPolicyPermission]);
  const [parentReader] = useState(createMenuCatalogReader);
  const identity = `${catalogScopeKey ?? ''}:${item.id ?? `${item.name}:${item.priceText}`}`;
  const parentMode = inheritedBookingMode(item, menu);
  useEffect(() => { setPicker(null); setCatalogPolicy(undefined); }, [identity]);
  useEffect(() => {
    parentReader.cancel(); setParentMetadata(undefined);
    const needsName = addOn && !knownParentName;
    const needsMode = !addOn && !item.bookingMode && !parentMode;
    if (!bookingActivationAllowed || !parentId || !needsName && !needsMode || !catalogLoader || !catalogShopId || !catalogScopeKey) return;
    void parentReader.read(catalogLoader, catalogShopId, { kind: 'service', serviceId: parentId, q: '', page: 1, pageSize: 10 }, state => {
      if (state.status === 'ready') { const row = state.page.items[0]; if (row) setParentMetadata({ scope: catalogScopeKey, serviceId: parentId, name: row.serviceName, bookingMode: row.preview?.bookingMode }); setPermission(state.page.canConfigurePolicy); }
    });
    return () => parentReader.cancel();
  }, [bookingActivationAllowed, addOn, item.bookingMode, parentMode, parentId, knownParentName, catalogLoader, catalogShopId, catalogScopeKey, parentReader, setPermission]);
  const canEditPolicy = policyEditable && catalogPolicy !== false;
  const independent = !item.booking && !item.newVariantOf;
  const defaultSingle = !canEditPolicy && independent && !addOn && !item.bookingMode;
  const mode = defaultSingle ? 'SINGLE' : item.bookingMode ?? '';
  const choose = (option: MenuCatalogOption, canConfigurePolicy: boolean) => {
    if (disabled || !bookingActivationAllowed || !onCatalogSelect) return;
    setPermission(canConfigurePolicy); setParentMetadata({ scope: catalogScopeKey ?? '', serviceId: option.serviceId, name: option.serviceName, bookingMode: option.preview?.bookingMode });
    onCatalogSelect(option, picker === 'addOnParent' ? 'addOnParent' : picker === 'variantParent' ? 'variantParent' : 'bind'); setPicker(null);
  };
  const catalogDisabled = disabled || !bookingActivationAllowed || !onCatalogSelect;
  const currentParentName = knownParentName ?? (parentMetadata && parentMetadata.scope === catalogScopeKey && parentMetadata.serviceId === parentId ? parentMetadata.name : undefined) ?? '已关联的本店主项目';
  return <div className="price-menu-wide price-menu-booking-fields">
    <label><span><input type="checkbox" disabled={disabled || !item.bookingEnabled && (!bookingActivationAllowed || !item.pricing && !item.booking)} checked={item.bookingEnabled === true}
      onChange={event => onChange({ bookingEnabled: event.target.checked, ...(defaultSingle ? { bookingMode: 'SINGLE' as const } : {}) })} /> {addOn ? '启用此附加选项' : item.booking?.variantId || item.newVariantOf ? '启用此规格' : '启用主项目预约'}</span></label>
    {!bookingActivationAllowed && <p role="status">先创建门店，再启用预约；价目可先保存为草稿。</p>}
    {catalogConflicted && <p className="price-menu-catalog-conflict" role="alert">所选目录已变化。当前草稿仍保留，请打开目录核对新名称、价格和分钟，再明确重新选择。</p>}
    {item.bookingEnabled && item.bookingAvailable === false && <p role="status">{item.bookingUnavailableReason === 'PARENT_PAUSED'
      ? '主项目已暂停；此选项的启用配置已保留，须明确恢复主项目后才可预约。'
      : item.bookingUnavailableReason === 'CONFIGURATION_REQUIRED' ? '此选项已启用，预约配置尚未完整，请核对主项目设置。' : '当前尚不可预约，保存后将重新核对可约状态。'}
      {parentId && onConfigureService && <button type="button" disabled={disabled} onClick={() => onConfigureService(parentId)}>主项目预约设置</button>}
    </p>}
    {item.booking && <div className="price-menu-catalog-current"><span>{addOn ? `主项目：${currentParentName}` : '当前关联目录项目'}</span><strong>{item.pricing?.baseName ?? item.name}</strong>
      <span>{catalogPreviewDescription(item)}</span><span>{item.bookingEnabled ? '此选项已启用' : '此选项已停用'}{item.bookingUnavailableReason === 'PARENT_PAUSED' ? ' · 主项目已暂停' : ''}</span></div>}
    {parentId && onConfigureService && !(item.bookingEnabled && item.bookingAvailable === false) && <button type="button" disabled={disabled} onClick={() => onConfigureService(parentId)}>管理此项目与预约规则</button>}
    <div className="price-menu-catalog-buttons">{addOn ? <>
      <button type="button" disabled={catalogDisabled} onClick={() => setPicker('addOnParent')}>{item.booking && !item.booking.addOnId ? '更换新增附加项的主项目' : '为新增附加项选择主项目'}</button>
      <button type="button" disabled={catalogDisabled} onClick={() => setPicker('addOn')}>关联本店已有附加项</button>
    </> : <>{item.newVariantOf && <button type="button" disabled={catalogDisabled} onClick={() => setPicker('variantParent')}>重新确认新规格主项目</button>}
      <button type="button" disabled={catalogDisabled} onClick={() => setPicker('main')}>{item.booking ? '更换关联项目' : '关联本店已有预约项目'}</button></>}</div>
    {picker && bookingActivationAllowed && <MenuCatalogPicker key={`${identity}:${picker}`} purpose={picker} loader={catalogLoader} shopId={catalogShopId} scopeKey={catalogScopeKey} disabled={catalogDisabled}
      refreshRevision={catalogRefreshRevision} initialService={parentId && (picker === 'addOn' || picker === 'variantParent' || picker === 'main' && item.booking?.variantId) ? { serviceId: parentId, name: addOn ? currentParentName : item.pricing?.baseName ?? item.name } : undefined}
      onSelect={choose} onClose={() => setPicker(null)} onPolicyPermission={setPermission} />}
    {!item.pricing && !item.booking && <p>此项目前仅是顾客展示文字，尚未成为预约项目。若本店已有对应服务，请在此关联；关联时会带入该服务的名称、价格与时长，避免重复录入。旧文字仍保留为顾客价目内容。</p>}
    {item.newVariantOf && <p>此项是同一主项目的新规格，共用主项目名称、预约方式与技师资格；价格和时长单独设置。<button type="button" disabled={disabled} onClick={() => onChange({ newVariantOf: undefined, bookingAvailable: undefined, bookingUnavailableReason: undefined })}>改为独立主项目</button></p>}
    {!addOn && item.pricing && <label><span>预约方式（开放预约时必选）</span><select disabled={disabled || !canEditPolicy} value={mode} onChange={event => onChange({ bookingMode: event.target.value ? event.target.value as PriceMenuItem['bookingMode'] : undefined })}>
      <option value="">{item.newVariantOf ? '沿用主项目预约方式' : '请选择预约方式'}</option><option value="SINGLE">单人 · 1位客人／1位技师</option><option value="COUPLE">情侣按摩 · 2位客人／2位技师</option><option value="FOUR_HANDS">四手按摩 · 1位客人／2位技师</option>
    </select><small>{bookingModeHelp(item, menu, defaultSingle, parentMetadata && parentMetadata.scope === catalogScopeKey && parentMetadata.serviceId === parentId ? parentMetadata.bookingMode : undefined)}</small>
      <small>价格为整次订单总价，不按顾客或技师人数重复计算；预约分钟独立设置。</small>
      {!canEditPolicy && <small>预约方式策略为只读；已有项目保留原预约方式，新建独立项目默认单人。</small>}
      {!canEditPolicy && independent && item.bookingMode && item.bookingMode !== 'SINGLE' && <button type="button" disabled={disabled} onClick={() => onChange({ bookingMode: 'SINGLE' })}>使用新建项目的单人默认</button>}
    </label>}
    {item.pricing && !addOn && item.pricing.kind !== 'TIMED' && <label><span>预约占用时间（分钟，开放预约时必填）</span><input type="number" min={5} max={240} step={1} disabled={disabled} value={item.reservedDurationMin ?? ''}
      onChange={event => onChange({ reservedDurationMin: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}
    {item.pricing?.kind === 'TIMED' && <p>预约使用上方填写的固定分钟和价格。关联后可继续编辑，保存一次同步到预约目录。</p>}
    {addOn && <p>新增附加项先选本店主项目；关联已有附加项会载入其真实名称和价格。附加项不增加预约分钟，不能单独预约。</p>}
  </div>;
}
