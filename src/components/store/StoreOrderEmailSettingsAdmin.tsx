import { useCallback, useMemo } from 'react';
import StoreOrderEmailSettings from './StoreOrderEmailSettings';
import { orderEmailSettingsApi } from '../../api/orderEmailSettings';
import { useBusinessScope, type BusinessLifecycleListener } from './businessScope';
import { useConfirmation } from '../Confirmation';
import type { ResourceId } from '../../api/resources';

export default function StoreOrderEmailSettingsAdmin({ shopId, disabled, onLifecycleChange, onSaved }: { shopId: ResourceId; disabled?: boolean; onLifecycleChange?: BusinessLifecycleListener; onSaved?: () => void }) {
  const scope = useBusinessScope(shopId), confirm = useConfirmation();
  const api = useMemo(() => orderEmailSettingsApi(String(shopId)), [shopId]);
  const owner = useMemo(() => scope.captureEvent(), [scope.actorId, shopId, scope.captureEvent]);
  const isCurrent = useCallback(() => owner(), [owner]);
  return <StoreOrderEmailSettings key={`${scope.actorId}:${shopId}`} shopId={String(shopId)} scopeKey={`${scope.actorId}:${shopId}`} api={api} isCurrent={isCurrent}
    disabled={disabled} onLifecycleChange={onLifecycleChange} onSaved={onSaved}
    confirmEndReview={() => confirm({ title: '结束本次通知邮箱核对？', message: '当前版本尚不能确认原请求结果，原请求仍可能稍后生效。确认后保留草稿，不会自动重发；请先重新读取最新配置再决定后续操作。', confirmLabel: '结束核对并保留草稿' })} />;
}
