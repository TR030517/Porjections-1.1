import { useLayoutEffect, useRef, useState } from 'react';
import { subscribeSession } from '../../api/session';
import { useAuthStore } from '../../stores/authStore';
import { shopStore, useShopStore } from '../../stores/shop';
import type { ResourceId } from '../../api/resources';

export { EMPTY_BUSINESS_LIFECYCLE, type BusinessLifecycle, type BusinessLifecycleListener } from '../../utils/businessLifecycle';

/** Explicit editor scopes are independent of the header's list filter. */
export function businessIdentity(actorId: unknown, explicitShopId: unknown, currentShopId: unknown) {
  const shopId = explicitShopId === undefined ? currentShopId : explicitShopId;
  return actorId != null ? String(actorId) + ':' + (shopId == null ? 'all' : String(shopId)) : null;
}

export function createBusinessFence(readIdentity: () => string | null) {
  let owner = readIdentity(), revision = 0, identityRevision = 0, active = true;
  const sync = () => { const next = readIdentity(); if (next !== owner) { owner = next; revision++; identityRevision++; } };
  return {
    sync,
    activate() { active = true; sync(); },
    dispose() { active = false; revision++; },
    capture() { sync(); const own = owner, generation = revision; return () => { sync(); return active && own !== null && owner === own && revision === generation; }; },
    // Render-bound user events can survive an effect reconnect of this same
    // mounted scope. Unlike async responses, no work began before cleanup.
    // Actual unmount stays inactive; any identity change retires events forever.
    captureEvent() { sync(); const own = owner, generation = identityRevision; return () => { sync(); return active && own !== null && owner === own && identityRevision === generation; }; },
  };
}

export function useBusinessScope(explicitShopId?: ResourceId, scopeToShop = true) {
  const { user } = useAuthStore();
  const { currentStoreId } = useShopStore();
  const shopId = explicitShopId ?? currentStoreId ?? undefined;
  const live = useRef({ actorId: user?.role === 'ADMIN' ? user.id : null, explicitShopId, scopeToShop });
  live.current.actorId = user?.role === 'ADMIN' ? user.id : null;
  live.current.explicitShopId = explicitShopId;
  live.current.scopeToShop = scopeToShop;
  const identity = () => live.current.scopeToShop ? businessIdentity(live.current.actorId, live.current.explicitShopId, shopStore.currentStoreId) : live.current.actorId == null ? null : String(live.current.actorId) + ':platform';
  const [fence] = useState(() => createBusinessFence(identity));
  // Descendant passive effects can start scoped reads immediately, including
  // StrictMode's reconnect. Activate before those effects, while still retiring
  // every capture made by the previous mount/session.
  useLayoutEffect(() => {
    fence.activate();
    const stopSession = subscribeSession(next => { live.current.actorId = next?.role === 'ADMIN' ? next.id : null; fence.sync(); });
    const stopShop = shopStore.subscribe(fence.sync);
    return () => { fence.dispose(); stopSession(); stopShop(); };
  }, [fence]);
  return { shopId, actorId: user?.role === 'ADMIN' ? user.id : null, capture: fence.capture, captureEvent: fence.captureEvent };
}
