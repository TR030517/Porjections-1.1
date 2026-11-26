import { getShopBookingPage, type BookingListFilters, type BookingPage, type BookingPageQuery } from '../../api/merchant';
import { errorMessage } from '../../utils/feedback';

interface BookingPageState { query: BookingPageQuery; data: BookingPage | null; loading: boolean; error: string }

/** One selected shop owns the page, its filter total and all in-flight requests. */
export function createBookingPageModel(shopId: string, isCurrentShop = () => true) {
  let state: BookingPageState = { query: { page: 1, pageSize: 25 }, data: null, loading: true, error: '' };
  let active = true, version = 0;
  let request: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<BookingPageState>) => {
    if (!active || !isCurrentShop()) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const load = async (query: BookingPageQuery): Promise<void> => {
    const current = ++version;
    request?.abort(); request = new AbortController();
    update({ query, data: null, loading: true, error: '' });
    try {
      const data = await getShopBookingPage(shopId, query, request.signal);
      if (!active || !isCurrentShop() || current !== version) return;
      // A mutation can remove the last row on a page. Re-fetch its last valid page.
      if (query.page > 1 && !data.items.length && query.page > Math.max(1, data.totalPages)) {
        return load({ ...query, page: Math.max(1, data.totalPages) });
      }
      update({ data, loading: false, error: '' });
    } catch (error) {
      if (active && isCurrentShop() && current === version) update({ data: null, loading: false, error: errorMessage(error) });
    }
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    load: () => { active = true; return load(state.query); },
    refresh: () => load(state.query),
    setPage: (page: number, pageSize: number) => load({ ...state.query, page: pageSize === state.query.pageSize ? page : 1, pageSize }),
    setFilters: (filters: BookingListFilters) => load({ ...filters, page: 1, pageSize: state.query.pageSize }),
    dispose: () => { active = false; ++version; request?.abort(); },
  };
}
