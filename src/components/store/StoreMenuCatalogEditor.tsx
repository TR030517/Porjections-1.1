import { useCallback, type ComponentProps } from 'react';
import StorePriceMenuEditor from './StorePriceMenuEditor';
import { useBusinessScope } from './businessScope';
import type { ResourceId } from '../../api/resources';
import type { MenuCatalogQuery } from '../../utils/catalogSelection';
import { getMenuCatalog } from '../../api/menuCatalog';

export default function StoreMenuCatalogEditor({ shopId, ...props }: ComponentProps<typeof StorePriceMenuEditor> & { shopId?: ResourceId }) {
  const scope = useBusinessScope(shopId, shopId != null);
  const renderCurrent = scope.captureEvent();
  const loader = useCallback(async (query: MenuCatalogQuery, signal: AbortSignal) => {
    if (shopId == null) throw Error('请先创建门店，再选择本店目录。');
    if (!renderCurrent()) throw Error('目录读取上下文已变化。');
    const current = scope.capture();
    if (!current()) throw Error('目录读取上下文已变化。');
    const result = await getMenuCatalog(shopId, query, signal);
    if (!current()) throw Error('目录读取上下文已变化。');
    return result;
  }, [shopId, scope.capture, renderCurrent]);
  return <StorePriceMenuEditor {...props} onChange={(next, selections) => renderCurrent() && props.onChange(next, selections) === true}
    onPasteTextChange={props.onPasteTextChange ? text => renderCurrent() && props.onPasteTextChange?.(text) === true : undefined}
    onConfigureService={props.onConfigureService ? id => { if (renderCurrent()) props.onConfigureService?.(id); } : undefined}
    onEditService={props.onEditService ? (id, variantId) => { if (renderCurrent()) props.onEditService?.(id, variantId); } : undefined}
    catalogShopId={shopId == null ? undefined : String(shopId)} catalogScopeKey={String(scope.actorId) + ':' + String(shopId)} catalogLoader={shopId == null ? undefined : loader} bookingActivationAllowed={shopId != null} policyEditable />;
}
