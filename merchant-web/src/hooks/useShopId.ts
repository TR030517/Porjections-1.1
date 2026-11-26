import { useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { getMyShops, type MyShop } from '../api/merchant';
import { currentSessionGeneration, isCurrentSession } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { hasShopPermission, type ShopPermission } from '../utils/shopPermissions';
import { requestedShopId, resolveShopSelection } from '../utils/shopSelection';

interface ShopState {
  shops: MyShop[]; selectedId: string | null; loading: boolean;
  error: string | null; loaded: boolean; ownerId: string | null; sessionGeneration: number | null;
  updateShop: (shop: MyShop) => void;
}
const useShops = create<ShopState>((set, get) => ({
  shops: [], selectedId: null, loading: false, error: null, loaded: false, ownerId: null, sessionGeneration: null,
  updateShop: (shop) => set({ shops: get().shops.map((current) => current.id === String(shop.id) ? {
    ...current, ...shop, id: String(shop.id),
    // Business save responses must not restore permissions captured before a refresh.
    isOwner: current.isOwner, accessType: current.accessType, permissions: current.permissions,
    homeShopId: current.homeShopId, loginAccount: current.loginAccount,
  } : current) }),
}));
const pending = new Map<string, Promise<void>>();
function currentOwner(ownerId: string | undefined, generation: number): boolean {
  const session = useAuthStore.getState();
  return Boolean(ownerId && session.token && session.merchant?.id === ownerId && isCurrentSession(generation));
}
async function loadShops(ownerId: string, generation: number, force = false) {
  if (!currentOwner(ownerId, generation)) return;
  const state = useShops.getState(), sameScope = state.ownerId === ownerId && state.sessionGeneration === generation;
  if (!force && sameScope && state.loaded) return;
  const key = `${generation}:${ownerId}`;
  if (!pending.has(key)) {
    useShops.setState({ ...(sameScope ? {} : { shops: [], selectedId: null, loaded: false }), loading: true, error: null, ownerId, sessionGeneration: generation });
    const current = () => currentOwner(ownerId, generation) && useShops.getState().ownerId === ownerId && useShops.getState().sessionGeneration === generation;
    const request = getMyShops().then((shops) => {
      if (!current()) return;
      useShops.setState({ shops, loaded: true });
    }).catch((error) => {
      if (!current()) return;
      // A failed refresh must not unmount a form and silently discard its draft.
      // Server authorization remains authoritative for every subsequent write.
      useShops.setState({ error: error?.response?.data?.message || '无法加载授权门店。' });
    }).finally(() => {
      if (current() && pending.get(key) === request) useShops.setState({ loading: false });
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
  }
  await pending.get(key);
}
let observedSession = currentSessionGeneration();
useAuthStore.subscribe((state, previous) => {
  const generation = currentSessionGeneration();
  if (generation !== observedSession || state.merchant?.id !== previous.merchant?.id || !state.token) {
    pending.clear();
    useShops.setState({ shops: [], selectedId: null, loaded: false, loading: false, ownerId: null, sessionGeneration: null, error: null });
  }
  observedSession = generation;
});
/** Read the current selection synchronously, including before React commits a shop switch. */
export function isCurrentShop(id: string): boolean {
  const state = useShops.getState();
  const session = useAuthStore.getState();
  return state.selectedId === id && state.ownerId === session.merchant?.id && state.sessionGeneration === currentSessionGeneration() && Boolean(session.token);
}
export function currentShopAllows(id: string, permission: ShopPermission | 'OWNER_ONLY'): boolean {
  const state = useShops.getState();
  return isCurrentShop(id) && !state.loading && !state.error && hasShopPermission(state.shops.find(shop => shop.id === id), permission);
}
export function useShopId() {
  const ownerId = useAuthStore((s) => s.merchant?.id);
  const generation = currentSessionGeneration();
  const location = useLocation(), navigate = useNavigate();
  const state = useShops();
  const ownsState = state.ownerId === ownerId && state.sessionGeneration === generation && currentOwner(ownerId, generation);
  const selected = state.loaded && ownsState ? resolveShopSelection(state.shops, requestedShopId(location.search), state.selectedId) : { selectedId: null, error: null };
  const shop = state.shops.find(item => item.id === selected.selectedId) ?? null;
  useLayoutEffect(() => {
    if (state.loaded && ownsState && currentOwner(ownerId, generation) && useShops.getState().sessionGeneration === generation && useShops.getState().selectedId !== selected.selectedId) useShops.setState({ selectedId: selected.selectedId });
  }, [ownerId, generation, ownsState, state.loaded, selected.selectedId]);
  useEffect(() => { if (ownerId) void loadShops(ownerId, generation); }, [ownerId, generation]);
  return {
    shopId: selected.selectedId, shop,
    can: (permission: ShopPermission | 'OWNER_ONLY') => hasShopPermission(shop, permission),
    shops: ownsState ? state.shops : [],
    selectShop: (id: string) => {
      if (!currentOwner(ownerId, generation) || useShops.getState().sessionGeneration !== generation || !useShops.getState().shops.some(item => item.id === id) || id === useShops.getState().selectedId) return;
      const params = new URLSearchParams(location.search); params.set('shopId', id);
      // The router commits the new context only after its draft blocker allows it.
      navigate({ pathname: location.pathname, search: '?' + params });
    },
    loading: !ownsState || !state.loaded && (state.loading || !state.error), refreshing: ownsState && state.loading && state.loaded,
    error: (ownsState ? state.error : null) || selected.error, retry: () => ownerId && loadShops(ownerId, generation, true),
    updateShop: (updated: MyShop) => { if (currentOwner(ownerId, generation) && useShops.getState().sessionGeneration === generation) state.updateShop(updated); },
    reloadShop: async (id: string) => {
      if (!ownerId || !currentOwner(ownerId, generation)) throw new Error('登录状态已改变，请重新登录。');
      await loadShops(ownerId, generation, true);
      const latest = useShops.getState();
      if (!currentOwner(ownerId, generation) || latest.ownerId !== ownerId || latest.sessionGeneration !== generation) throw new Error('登录会话已改变，未载入价目。');
      if (latest.error) throw new Error(latest.error);
      const result = latest.shops.find(item => item.id === id);
      if (!result) throw new Error('当前门店授权已撤销，未载入其他门店价目。');
      return result;
    },
  };
}
