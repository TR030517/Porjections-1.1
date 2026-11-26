import { getShopDashboard, type DashboardData } from '../../api/merchant';
import { errorMessage } from '../../utils/feedback';

interface DashboardState { data: DashboardData | null; loading: boolean; error: string | null }
const empty: DashboardState = { data: null, loading: true, error: null };

/** The component supplies synchronous actor, shop and fresh-permission checks.
 * A scope change hides data even before the old effect's cleanup can run. */
export function createDashboardModel(shopId: string, isCurrent = () => true) {
  let state = empty, active = true, version = 0;
  let request: AbortController | undefined;
  const listeners = new Set<() => void>();
  const current = (generation: number) => active && version === generation && isCurrent();
  const publish = (next: DashboardState) => { state = next; listeners.forEach(listener => listener()); };
  const load = async () => {
    active = true;
    const generation = ++version;
    request?.abort();
    request = new AbortController();
    publish(empty);
    if (!isCurrent()) return;
    try {
      const data = await getShopDashboard(shopId, undefined, undefined, request.signal);
      if (current(generation)) publish({ data, loading: false, error: null });
    } catch (error) {
      if (current(generation)) publish({ data: null, loading: false, error: errorMessage(error, '经营概览加载失败，请重试。') });
    }
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => active && isCurrent() ? state : empty,
    load,
    dispose: () => { active = false; ++version; request?.abort(); state = empty; },
  };
}
