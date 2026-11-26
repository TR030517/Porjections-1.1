import { useEffect, useRef, useState } from 'react';
import { menuOnlyProjectRows, projectMenuAvailabilityMessage, projectMenuDisplayStatus, readProjectCatalogPage, type ProjectCatalogLoader, type ProjectCatalogPage, type ProjectCatalogQuery, type ProjectMenuAvailability } from '../../utils/projectCatalog';
import type { PriceMenuGroup } from '../../utils/priceMenu';
import { formatPriceMenuDollars } from '../../utils/priceMenuPricing';
import './StoreProjectInventory.css';
export interface StoreProjectInventoryProps {
  shopId: string; scopeKey: string; load: ProjectCatalogLoader; menu: PriceMenuGroup[]; menuAvailability: ProjectMenuAvailability; revision: string | number; disabled?: boolean; selectedServiceId?: string;
  onSelect: (serviceId: string) => void; onLocateMenu: (groupIndex: number, itemIndex: number) => void;
}
function ProjectMenuDisplayLabel({ label, needsReview = false }: { label: string; needsReview?: boolean }) {
  return <small>{label}{needsReview ? ' · 原资料需核对后才能预约' : ''}</small>;
}
export default function StoreProjectInventory({ shopId, scopeKey, load, menu, menuAvailability, revision, disabled = false, selectedServiceId, onSelect, onLocateMenu }: StoreProjectInventoryProps) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState<ProjectCatalogQuery['status']>('all'), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const query: ProjectCatalogQuery = { search: search.trim(), status, page, pageSize: 10 };
  const key = JSON.stringify([shopId, scopeKey, query, revision, reload]);
  const live = useRef(key); live.current = key;
  const [result, setResult] = useState<{ key: string; page?: ProjectCatalogPage; error?: string }>();
  useEffect(() => { setSearch(''); setStatus('all'); setPage(1); }, [shopId, scopeKey]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const timer = setTimeout(() => {
      void load(query, controller.signal).then(raw => {
        if (!active || controller.signal.aborted || live.current !== key) return;
        const value = readProjectCatalogPage(raw, shopId, query);
        if (page > 1 && !value.items.length && value.total) { setPage(Math.max(1, Math.ceil(value.total / query.pageSize))); return; }
        setResult({ key, page: value });
      }).catch(error => { if (active && !controller.signal.aborted && live.current === key) setResult({ key, error: error instanceof Error ? error.message : '本店项目读取失败。' }); });
    }, 180);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  // The key binds every query, revision and explicit business identity.
  }, [key, load, shopId]);
  const current = result?.key === key ? result : undefined;
  const effectiveMenuAvailability: ProjectMenuAvailability = current?.page?.canManageCatalog === false ? { status: 'unavailable', reason: 'permission' } : menuAvailability;
  const knownMenu = effectiveMenuAvailability.status === 'known';
  const unavailableMessage = projectMenuAvailabilityMessage(effectiveMenuAvailability);
  const pending = (knownMenu && status === 'all' ? menuOnlyProjectRows(menu) : []).filter(row => !search.trim() || [row.item.name, row.category].some(text => text.toLowerCase().includes(search.trim().toLowerCase())));
  return <section className="store-project-inventory" aria-label="本店服务与价格">
    <p>{knownMenu ? '选择一个服务，直接维护共同资料、规格价格与预约规则。规格是同一服务的不同时长或选项；展示行是顾客价目中的位置。' : '选择本店服务查看共同资料、规格与预约规则。展示行状态暂未核对，查看不会新增或启用服务。'}</p>
    {unavailableMessage && <p role="status">{unavailableMessage}</p>}
    <div className="store-project-inventory__filters"><label><span>查找本店服务</span><input type="search" maxLength={100} value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><label><span>服务状态</span><select value={status} disabled={disabled} onChange={event => { setStatus(event.target.value as ProjectCatalogQuery['status']); setPage(1); }}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></select></label><button type="button" disabled={disabled} onClick={() => setReload(value => value + 1)}>刷新服务列表</button></div>
    {!current ? <p role="status">正在读取本店项目目录…</p> : current.error ? <p role="alert">{current.error}</p> : current.page && <>
      <p role="status">服务 {current.page.total} 个 · 当前页 {current.page.items.reduce((sum, project) => sum + project.variantCount, 0)} 个规格{knownMenu ? ` · 顾客价目 ${menu.reduce((sum, group) => sum + group.items.length, 0)} 条展示行` : ' · 展示行未核对'} · 第 {page} 页</p>
      {!current.page.items.length && <p>当前筛选没有服务；下方“旧数据关联修复”中的已保存展示行继续保留。</p>}
      <ul className="store-project-inventory__list">{current.page.items.map(project => {
        const display = projectMenuDisplayStatus(menu, project.id, effectiveMenuAvailability), locations = display.locations;
        return <li key={project.id} className={selectedServiceId === project.id ? 'is-selected' : ''}><div><strong>{project.name}</strong><span>1 个服务 · {project.variantCount} 个规格 · {knownMenu ? `${locations.length} 条展示行` : '展示行未核对'} · {project.isActive ? '启用' : '停用'} · {project.addOnCount} 个附加项</span><ProjectMenuDisplayLabel label={display.label} needsReview={!project.preview && !project.hasVariants} /></div><div className="store-project-inventory__actions">{locations[0] && <button type="button" disabled={disabled} onClick={() => onLocateMenu(locations[0].groupIndex, locations[0].itemIndex)}>顾客价目布局</button>}<button type="button" disabled={disabled} onClick={() => onSelect(project.id)}>编辑服务与价格</button></div></li>;
      })}</ul>
      {pending.length > 0 && <details className="store-project-inventory__legacy"><summary>旧数据关联修复（{pending.length} 条展示行）</summary><p>这些展示行尚未建立或关联真实服务、规格。展开后可定位到顾客价目布局的修复区，核对旧内容与本店目录；查看和定位不会自动新增或启用服务。</p><ul className="store-project-inventory__list">{pending.slice(0, 20).map(row => {
        const price = row.item.pricing?.priceCents != null ? `$${formatPriceMenuDollars(row.item.pricing.priceCents)}` : row.item.priceText || '待补充价格';
        return <li key={`menu:${row.groupIndex}:${row.itemIndex}`} className="is-unlinked"><div><strong>{row.item.name || '未命名展示行'}</strong><span>{row.category || '未分组'} · {price}</span><ProjectMenuDisplayLabel label={row.item.isVisible === false ? '当前隐藏 · 尚未关联真实服务或规格' : '仍在顾客页面展示 · 尚不能在线预约'} /></div><div className="store-project-inventory__actions"><button type="button" disabled={disabled} onClick={() => onLocateMenu(row.groupIndex, row.itemIndex)}>定位关联修复</button></div></li>;
      })}</ul>
      {pending.length > 20 && <p>待关联内容还有 {pending.length - 20} 条展示行；请用上方搜索定位。</p>}</details>}
      <div className="store-project-inventory__pagination"><button type="button" disabled={disabled || page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" disabled={disabled || !current.page.hasMore} onClick={() => setPage(value => value + 1)}>下一页</button></div>
    </>}
  </section>;
}
