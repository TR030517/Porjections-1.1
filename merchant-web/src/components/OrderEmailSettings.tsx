import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from 'antd';
import StoreOrderEmailSettings from '../../../src/components/store/StoreOrderEmailSettings';
import { orderEmailSettingsApi } from '../api/orderEmailSettings';
import { useAuthStore } from '../stores/authStore';
import { currentShopAllows, isCurrentShop } from '../hooks/useShopId';
import { useMerchantDraftProtection } from './MerchantDraftGuard';
import type { BusinessLifecycle } from '../../../src/utils/businessLifecycle';

export default function OrderEmailSettings({ shopId, disabled = false }: { shopId: string; disabled?: boolean }) {
  const actorId = useAuthStore(state => state.merchant?.id), [modal, context] = Modal.useModal();
  const [lifecycle, setLifecycle] = useState<BusinessLifecycle>({ dirty: false, busy: false, unknown: false });
  const api = useMemo(() => orderEmailSettingsApi(shopId), [shopId]);
  const isCurrent = useCallback(() => actorId === useAuthStore.getState().merchant?.id && isCurrentShop(shopId), [actorId, shopId]);
  const onLifecycleChange = useCallback((value: BusinessLifecycle) => setLifecycle(value), []);
  useMerchantDraftProtection(shopId, lifecycle.dirty, lifecycle.busy, () => lifecycle.unknown || lifecycle.busy);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('focus') === 'order-email') document.getElementById(`order-email-heading-${shopId}`)?.focus(); }, [shopId]);
  return <>{context}<StoreOrderEmailSettings key={`${actorId}:${shopId}`} shopId={shopId} scopeKey={`${actorId}:${shopId}`} api={api} isCurrent={isCurrent}
    disabled={disabled || !currentShopAllows(shopId, 'SHOP_SETTINGS_MANAGE')} onLifecycleChange={onLifecycleChange}
    confirmEndReview={async () => Boolean(await modal.confirm({ title: '结束本次通知邮箱核对？', content: '当前读回版本不能确认原请求的结果，原请求仍可能稍后生效。结束后保留草稿，不会自动重发，请先重新读取最新配置再决定后续操作。', okText: '结束核对并保留草稿', cancelText: '继续核对' }))} /></>;
}
