import { Alert, Spin } from 'antd';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useShopId } from '../hooks/useShopId';
import { projectWorkspaceHref, requestedProjectFocus, type ProjectPane } from '../utils/projectWorkspace';
import ReservationsPage from '../pages/reservations';

export default function ProjectEntryRedirect({ pane }: { pane: ProjectPane }) {
  const { shopId, loading, error } = useShopId();
  const [params] = useSearchParams();
  const { serviceId, variantId, itemId, invalid } = requestedProjectFocus(params.toString());
  if (loading) return <Spin />;
  if (!shopId || error || invalid) return <Alert type="warning" showIcon title={error || '项目入口无效，请明确选择已授权门店、项目、规格与展示位置。'} />;
  return <Navigate to={projectWorkspaceHref(shopId, serviceId ?? undefined, pane, { ...(variantId ? { variantId } : {}), ...(itemId ? { itemId } : {}) })} replace />;
}

export function ReservationEntryRoute() {
  const [params] = useSearchParams();
  return params.get('tab') === 'services' || !params.has('tab') && params.has('serviceId')
    ? <ProjectEntryRedirect pane="booking" /> : <ReservationsPage />;
}
