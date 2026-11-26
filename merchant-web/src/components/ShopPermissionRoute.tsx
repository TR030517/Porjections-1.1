import { Alert, Spin } from 'antd';
import { useShopId } from '../hooks/useShopId';
import { initialShopRoute, type ShopPermission } from '../utils/shopPermissions';
import { Navigate } from 'react-router-dom';
import { useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

export function ShopLanding() {
  const { shop, shopId, loading } = useShopId();
  if (loading) return <Spin />;
  const path = initialShopRoute(shop);
  return path ? <Navigate to={{ pathname: path, search: shopId ? '?shopId=' + encodeURIComponent(shopId) : '' }} replace /> : <Alert type="info" showIcon title="暂无已授权的工作内容" description="请联系门店负责人分配门店与职责，您也可以刷新授权门店或退出登录。" />;
}
export default function ShopPermissionRoute({ permission, anyOf, children, preserveDraft = false }: { permission?: ShopPermission | 'OWNER_ONLY'; anyOf?: readonly ShopPermission[]; children: React.ReactNode; preserveDraft?: boolean }) {
  const { can, loading, shopId } = useShopId();
  const actorId = useAuthStore(state => state.merchant?.id);
  const previouslyAllowed = useRef('');
  const scope = `${actorId}:${shopId}:${permission ?? anyOf?.join(',')}`;
  const allowed = permission ? can(permission) : Boolean(anyOf?.some(item => can(item)));
  if (allowed) previouslyAllowed.current = scope;
  if (loading) return <Spin />;
  // Opt-in editors check fresh permissions before every write. Keep the child
  // at the same React position so a permission refresh cannot erase its draft.
  const preserveReadOnlyDraft = (permission === 'SHOP_SETTINGS_MANAGE' || preserveDraft) && previouslyAllowed.current === scope;
  if (!allowed && !preserveReadOnlyDraft) return <Alert type="warning" showIcon title="当前账号无权访问所选门店的此页面" description="请选择其他已授权门店，或联系负责人更新职责。本次未执行任何操作。" />;
  return <>{!allowed && <Alert type="warning" showIcon title="本店编辑权限已撤销" description="当前草稿保留供您核对，保存和上传已禁用。请联系负责人恢复权限。" />}{children}</>;
}
