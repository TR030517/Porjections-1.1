import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { Link } from 'react-router-dom';
import type { MyShop } from '../api/merchant';
import { hasShopPermission } from '../utils/shopPermissions';
import { orderEmailSettingsApi } from '../api/orderEmailSettings';
import { useAuthStore } from '../stores/authStore';
import { isCurrentShop } from '../hooks/useShopId';
import { orderEmailSettingsSummary, type OrderEmailSettingsView } from '../../../src/utils/orderEmailSettings';

export default function StoreOrderEmailReadiness({ shop, available }: { shop: MyShop | null; available: boolean }) {
  const actorId = useAuthStore(state => state.merchant?.id), canEdit = available && hasShopPermission(shop, 'SHOP_SETTINGS_MANAGE');
  const [state, setState] = useState<{ key: string; view: OrderEmailSettingsView | null }>({ key: '', view: null });
  const [refresh, setRefresh] = useState(0), generation = useRef(0);
  const key = [actorId,shop?.id ?? '',canEdit,available].join(':');
  useEffect(() => {
    const version = ++generation.current, abort = new AbortController(); setState({ key, view: null });
    if (canEdit && shop && actorId) void orderEmailSettingsApi(shop.id).read(abort.signal)
      .then(view => { if (!abort.signal.aborted && generation.current === version && useAuthStore.getState().merchant?.id === actorId && isCurrentShop(shop.id)) setState({ key, view }); })
      .catch(() => { /* Explicit UNKNOWN is retained; never reuse a previous shop's readiness. */ });
    return () => abort.abort();
  }, [key, refresh]);
  const view = state.key === key && available && canEdit ? state.view : null, summary = orderEmailSettingsSummary(view);
  return <Alert className="store-order-email-readiness" showIcon type={summary.level === 'ready' ? 'success' : summary.level === 'unknown' ? 'info' : 'warning'} title={summary.title}
    description={<span>{summary.detail} {!canEdit && '请联系有本店资料编辑权限的账号核对；此处不公开专用收件地址。'} 此设置不改变门店发布、顾客预约或独立账号登录状态。</span>}
    action={canEdit && shop ? <div><Link to={'/settings?shopId='+encodeURIComponent(shop.id)+'&focus=order-email'}>设置预约通知邮箱</Link><Button type="link" onClick={() => setRefresh(value => value + 1)}>重新核对</Button></div> : undefined} />;
}
