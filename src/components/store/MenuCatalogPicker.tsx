import { useEffect, useRef, useState } from 'react';
import { createMenuCatalogReader, type MenuCatalogLoader, type MenuCatalogOption, type MenuCatalogQuery, type MenuCatalogReadState } from '../../utils/catalogSelection';
import { formatPriceMenuDollars } from '../../utils/priceMenuPricing';
import type { PriceMenuItem } from '../../utils/priceMenu';
import './MenuCatalogPicker.css';

export type MenuCatalogPurpose = 'main' | 'variantParent' | 'addOnParent' | 'addOn';
export function catalogPreviewDescription(preview: PriceMenuItem | null): string {
  const pricing = preview?.pricing;
  if (!pricing || pricing.priceCents === null) return '请先完善目录配置';
  const money = `${pricing.kind === 'ADD_ON' ? '+' : ''}$${formatPriceMenuDollars(pricing.priceCents)}`;
  if (pricing.kind === 'ADD_ON') return `${money} · 不增加预约分钟`;
  const minutes = pricing.kind === 'TIMED' ? pricing.durationMin : preview?.reservedDurationMin;
  const mode = preview?.bookingMode === 'COUPLE' ? '情侣按摩' : preview?.bookingMode === 'FOUR_HANDS' ? '四手按摩' : '单人';
  return `${money} 整次价 · ${minutes ?? '待设置'} 分钟${pricing.kind === 'TIMED' ? '' : '预约占用'} · ${mode}`;
}
export interface MenuCatalogPickerProps {
  purpose: MenuCatalogPurpose; loader?: MenuCatalogLoader; shopId?: string; scopeKey?: string; disabled?: boolean; refreshRevision?: number;
  initialService?: { serviceId: string; name: string };
  onSelect: (option: MenuCatalogOption, canConfigurePolicy: boolean) => void; onClose: () => void;
  onPolicyPermission?: (allowed: boolean) => void;
}

export default function MenuCatalogPicker({ purpose, loader, shopId, scopeKey, disabled = false, refreshRevision = 0, initialService, onSelect, onClose, onPolicyPermission }: MenuCatalogPickerProps) {
  const [parent, setParent] = useState(purpose === 'addOnParent' ? undefined : initialService);
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [reader] = useState(createMenuCatalogReader);
  const [response, setResponse] = useState<{ key: string; state: MenuCatalogReadState } | null>(null);
  const kind = parent && purpose !== 'addOnParent' ? purpose === 'addOn' ? 'addOn' : 'variant' : 'service';
  const query: MenuCatalogQuery = { kind, ...(parent && kind !== 'service' ? { serviceId: parent.serviceId } : {}), q: search.trim(), page, pageSize: 10 };
  const queryKey = JSON.stringify([shopId, scopeKey, purpose, query, refreshRevision, retry]);
  const currentKey = useRef(queryKey); currentKey.current = queryKey;
  const current = response?.key === queryKey ? response.state : undefined;
  const title = purpose === 'addOnParent' ? '选择新增附加项的主项目' : purpose === 'addOn' ? '关联本店已有附加项' : purpose === 'variantParent' ? '确认新规格的主项目' : '关联本店服务与规格';
  useEffect(() => { setParent(purpose === 'addOnParent' ? undefined : initialService); setSearch(''); setPage(1); }, [shopId, scopeKey]);
  useEffect(() => {
    reader.cancel();
    if (!loader || !shopId || !scopeKey) { setResponse(null); return; }
    const expectedKey = queryKey;
    setResponse({ key: expectedKey, state: { status: 'loading' } });
    const timer = setTimeout(() => {
      void reader.read(loader, shopId, query, state => { if (currentKey.current === expectedKey) setResponse({ key: expectedKey, state }); });
    }, 220);
    return () => { clearTimeout(timer); reader.cancel(); };
  // queryKey contains every request parameter, scope and explicit refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, reader, queryKey]);
  useEffect(() => { if (current?.status === 'ready') onPolicyPermission?.(current.page.canConfigurePolicy); }, [current, onPolicyPermission]);
  const choose = (option: MenuCatalogOption) => {
    if (disabled || currentKey.current !== queryKey || current?.status !== 'ready') return;
    if (kind === 'service' && purpose !== 'addOnParent' && (purpose === 'addOn' || option.hasVariants)) {
      setParent({ serviceId: option.serviceId, name: option.serviceName }); setSearch(''); setPage(1); return;
    }
    if (purpose !== 'addOnParent' && !option.preview) return;
    onSelect(option, current.page.canConfigurePolicy);
  };
  return <section className="menu-catalog-picker" aria-label={title} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="menu-catalog-heading"><strong>{title}</strong><button type="button" onClick={onClose}>收起目录</button></div>
    {parent && kind !== 'service' && <div className="menu-catalog-parent"><span>主项目：{parent.name}</span><button type="button" disabled={disabled} onClick={() => { setParent(undefined); setSearch(''); setPage(1); }}>选择其他主项目</button></div>}
    <div className="menu-catalog-search"><label><span>{kind === 'service' ? '查找本店主项目' : kind === 'variant' ? '查找该项目规格' : '查找该项目附加项'}</span>
      <input type="search" maxLength={100} value={search} disabled={disabled || !loader || !shopId || !scopeKey} placeholder="按名称搜索" onChange={event => { setSearch(event.target.value); setPage(1); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setPage(1); setRetry(value => value + 1); } }} /></label>
      <button type="button" disabled={disabled || !loader || !shopId || !scopeKey} onClick={() => setRetry(value => value + 1)}>刷新目录</button></div>
    {!loader || !shopId || !scopeKey ? <p className="menu-catalog-message" role="status">本店目录暂不可用，请重新打开当前门店后重试。</p>
      : !current || current.status === 'loading' ? <p className="menu-catalog-message" role="status">正在读取本店目录…</p>
      : current.status === 'error' ? <div className="menu-catalog-message is-error" role="alert"><p>{current.message}</p><button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>重试读取</button></div>
      : <>
        <p className="menu-catalog-count" role="status">共 {current.page.total} 项 · 第 {current.page.page} 页</p>
        {current.page.items.length === 0 ? <p className="menu-catalog-message">{search.trim() ? '没有找到匹配项目，请调整名称搜索。' : kind === 'service' ? '本店还没有可选择的服务目录。' : kind === 'variant' ? '此主项目暂无规格。' : '此主项目暂无附加项；可返回并选择“新增附加项的主项目”。'}</p>
          : <ul className="menu-catalog-options">{current.page.items.map(option => {
            const navigates = kind === 'service' && purpose !== 'addOnParent' && (purpose === 'addOn' || option.hasVariants);
            const selectable = purpose === 'addOnParent' || navigates && (purpose !== 'addOn' || option.addOnCount > 0) || !navigates && !!option.preview;
            return <li key={`${option.serviceId}:${option.variantId ?? ''}:${option.addOnId ?? ''}`}><button type="button" className="menu-catalog-option" disabled={disabled || !selectable} onClick={() => choose(option)}>
              <span className="menu-catalog-option-name">{kind === 'service' ? option.serviceName : option.name}</span>
              <span className="menu-catalog-option-detail">{kind === 'service' && option.hasVariants ? `${option.variantCount} 种规格 · ${option.addOnCount} 个附加项` : catalogPreviewDescription(option.preview)}</span>
              {kind !== 'service' && <span className="menu-catalog-option-parent">{option.serviceName}</span>}
              <span className="menu-catalog-tags"><span className={option.isActive ? 'is-enabled' : ''}>{option.isActive ? '已启用' : '已停用，可配置'}</span>{kind !== 'service' && !option.parentIsActive && <span>主项目已暂停</span>}</span>
              <span className="menu-catalog-option-action">{purpose === 'addOnParent' ? '选择此主项目' : navigates ? purpose === 'addOn' ? option.addOnCount ? '查看附加项 →' : '暂无附加项' : '查看规格 →' : option.preview ? purpose === 'variantParent' ? '确认主项目，保留新规格数值' : '选择并预览' : '需先完善目录配置'}</span>
            </button></li>;
          })}</ul>}
        <div className="menu-catalog-pagination"><button type="button" disabled={disabled || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" disabled={disabled || !current.page.hasMore} onClick={() => setPage(value => value + 1)}>下一页</button></div>
      </>}
    <p className="menu-catalog-footnote">{purpose === 'variantParent' ? '选择一项现有规格以核对主项目；当前新规格的价格和分钟不会被替换。' : '选择后先更新当前草稿。'}刷新只更新可选目录，已选项目与草稿会保留，所有配置仍需明确保存。</p>
  </section>;
}
