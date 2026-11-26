import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Spin, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import StoreServiceWorkspace from '../../../../src/components/store/StoreServiceWorkspace';
import type { ServiceWorkspaceApi, WorkspaceReceipt, WorkspaceSnapshot } from '../../../../src/types/serviceWorkspace';
import { EMPTY_BUSINESS_LIFECYCLE, type BusinessLifecycle } from '../../../../src/utils/businessLifecycle';
import type { MyShop } from '../../api/merchant';
import { currentShopAllows, isCurrentShop, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { hasShopPermission } from '../../utils/shopPermissions';
import { useMerchantDraftProtection } from '../../components/MerchantDraftGuard';
import { getProjectCatalog } from '../../api/projectCatalog';
import { readServiceWorkspace, saveServiceWorkspace, readServiceWorkspaceOperation, reconcileServiceWorkspaceOperation } from '../../api/reservations';
import { requestedProjectFocus } from '../../utils/projectWorkspace';
import { workspaceProfileMenu } from '../../../../src/utils/serviceWorkspaceProfile';
import type { MediaDraftTransport } from '../../../../src/utils/mediaDraft';
import { abandonShopMedia, confirmShopMedia, previewShopMedia, uploadShopMedia } from '../../api/media';

export default function PriceMenuPage() {
  const { shop, shopId, loading, refreshing, error, retry, updateShop } = useShopId();
  const actor = useAuthStore(state => state.merchant?.id);
  if (loading) return <div style={{ padding: 64, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!shopId || !shop) return error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => void retry()}>重试</Button>} /> : <Alert type="info" showIcon title="请选择已授权门店。" />;
  return <PriceMenuForm key={shopId + ':' + actor} shop={shop} accessReady={!refreshing && !error} accessError={error} updateShop={updateShop} />;
}

function PriceMenuForm({ shop, accessReady, accessError, updateShop }: { shop: MyShop; accessReady: boolean; accessError: string | null; updateShop: (shop: MyShop) => void }) {
  const shopId = shop.id, actorId = useAuthStore(state => state.merchant?.id);
  const [params] = useSearchParams();
  const alive = useRef(true), sessionRetired = useRef(false);
  const latest = useRef({ shop, accessReady }); latest.current = { shop, accessReady };
  const [lifecycle, setLifecycle] = useState<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const lifecycleRef = useRef(lifecycle);
  const current = useCallback(() => alive.current && !sessionRetired.current && Boolean(actorId) && actorId === useAuthStore.getState().merchant?.id && isCurrentShop(shopId), [actorId, shopId]);
  useLayoutEffect(() => {
    alive.current = true;
    const stop = useAuthStore.subscribe(state => { if (!state.token || state.merchant?.id !== actorId) sessionRetired.current = true; });
    return () => { alive.current = false; stop(); };
  }, [actorId]);
  const changedLifecycle = useCallback((next: BusinessLifecycle) => {
    if (!current()) return;
    lifecycleRef.current = next; setLifecycle(next);
  }, [current]);
  useMerchantDraftProtection(shopId, lifecycle.dirty, lifecycle.busy, () => lifecycleRef.current.busy || lifecycleRef.current.unknown);
  const allowed = useCallback(() => current() && latest.current.accessReady && (currentShopAllows(shopId, 'CATALOG_MANAGE') || currentShopAllows(shopId, 'RESERVATION_CONFIG')), [current, shopId]);
  const canUploadMedia = useCallback(() => current() && latest.current.accessReady && currentShopAllows(shopId, 'CATALOG_MANAGE'), [current, shopId]);
  const canAbandonMedia = useCallback(() =>
    !sessionRetired.current && Boolean(actorId) && actorId === useAuthStore.getState().merchant?.id
    && isCurrentShop(shopId) && currentShopAllows(shopId, 'CATALOG_MANAGE'), [actorId, shopId]);
  const mediaTransport = useMemo<MediaDraftTransport>(() => ({
    upload: (file, purpose, key) => uploadShopMedia(shopId, file, purpose, key),
    confirm: confirmShopMedia,
    preview: previewShopMedia,
    abandon: abandonShopMedia,
  }), [shopId]);
  const savedShopImages = [
    shop.logoUrl || shop.media?.logoUrl || '',
    shop.bannerUrl || shop.media?.coverUrl || '',
    ...(shop.gallery ?? shop.media?.galleryUrls ?? []),
  ];
  const api = useMemo<ServiceWorkspaceApi>(() => {
    const scoped = async (operation: () => Promise<unknown>) => {
      if (!allowed()) throw Error('当前账号、门店或服务编辑权限已变化，请刷新授权后核对。');
      const value = await operation();
      if (!current()) throw Error('原门店或登录状态已变化，未接收其他上下文的结果。');
      return value;
    };
    return {
      loadCatalog: (query, signal) => scoped(() => getProjectCatalog(shopId, query, signal)),
      loadSnapshot: (serviceId, signal) => scoped(() => readServiceWorkspace(shopId, serviceId, signal)),
      save: command => scoped(() => saveServiceWorkspace(shopId, command)),
      readReceipt: (key, signal) => scoped(() => readServiceWorkspaceOperation(shopId, key, signal)),
      reconcile: (key, signal) => scoped(() => reconcileServiceWorkspaceOperation(shopId, key, signal)),
    };
  }, [allowed, current, shopId]);
  const saved = useCallback(({ snapshot }: { snapshot: WorkspaceSnapshot; receipt: WorkspaceReceipt }) => {
    if (!current() || snapshot.shopId !== shopId) throw Error('保存后的门店上下文已变化，未更新当前门店资料。');
    // The workspace owns service drafts. Only its confirmed menu baseline is
    // published to the shell; other shop settings are never replaced or saved.
    updateShop({ ...latest.current.shop, priceMenu: workspaceProfileMenu(snapshot.priceMenu), priceMenuRevision: snapshot.priceMenuRevision });
  }, [current, shopId, updateShop]);
  const { serviceId, variantId, itemId, invalid: invalidEntry } = requestedProjectFocus(params.toString());
  const focus = !invalidEntry && serviceId ? { serviceId, ...(variantId ? { variantId } : {}), ...(itemId ? { itemId } : {}), pane: params.get('pane') === 'booking' ? 'booking' as const : 'metadata' as const, revision: params.toString() } : undefined;
  useEffect(() => { lifecycleRef.current = lifecycle; }, [lifecycle]);
  return <div className="merchant-page">
    <Typography.Paragraph type="secondary">{shop.name}</Typography.Paragraph>
    {accessError && <Alert type="warning" showIcon title="门店授权读取失败，当前草稿保留为只读。" description={accessError} />}
    {invalidEntry && <Alert type="warning" showIcon title="旧链接中的服务、规格或展示位置无效，请明确选择本店服务；不会自动替换为第一项。" />}
    {!hasShopPermission(shop, 'CATALOG_MANAGE') && <Alert type="info" showIcon title="当前账号按预约设置权限查看并编辑服务规则；目录、规格和展示字段保持只读。" />}
    <StoreServiceWorkspace shopId={shopId} scopeKey={'merchant:' + actorId + ':' + shopId} api={api} disabled={!accessReady} readReady={accessReady} isCurrent={current} beforeWrite={allowed} mediaTransport={mediaTransport} canUploadMedia={canUploadMedia} canAbandonMedia={canAbandonMedia} shopImages={savedShopImages} onLifecycleChange={changedLifecycle} onSaved={saved} focus={focus} />
    {hasShopPermission(shop, 'SHOP_SETTINGS_MANAGE') && <Typography.Paragraph style={{ marginTop: 20 }}><Link to={`/settings?shopId=${encodeURIComponent(shopId)}`}>门店基本资料</Link></Typography.Paragraph>}
  </div>;
}
