import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { Modal } from 'antd';
import { useBlocker } from 'react-router-dom';
import { isCurrentShop, useShopId } from '../hooks/useShopId';
import { useAuthStore } from '../stores/authStore';
import { createDraftLeaveController, type DraftState } from '../utils/draftLeave';

interface DraftGuardContextValue {
  register: (id: string, read: () => DraftState) => () => void;
  confirmLeave: () => Promise<boolean>;
}
const DraftGuardContext = createContext<DraftGuardContextValue | null>(null);

export function MerchantDraftGuard({ children }: { children: React.ReactNode }) {
  const { shopId } = useShopId();
  const activeShop = useRef(shopId); activeShop.current = shopId;
  const [modal, context] = Modal.useModal();
  const controller = useMemo(() => createDraftLeaveController(() => {
    const actorId = useAuthStore.getState().merchant?.id, currentShop = activeShop.current;
    return actorId && currentShop && isCurrentShop(currentShop) ? { actorId, shopId: currentShop } : null;
  }), []);
  const confirmLeave = useCallback(() => controller.request(
    async () => Boolean(await modal.confirm({ title: '放弃当前门店未保存的修改并离开？', content: '尚未保存的表单和未追加的粘贴内容将被放弃。已保存资料不会改变。', okText: '放弃并离开', cancelText: '继续编辑' })),
    () => { modal.info({ title: '当前操作尚未完成', content: '正在保存、上传或清理本店资料，请完成后再切店、退出或离开页面。', okText: '留在当前页面' }); },
  ), [controller, modal]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search && currentLocation.hash === nextLocation.hash) return false;
    const state = controller.snapshot(); return state.dirty || state.busy;
  });
  const blockerRef = useRef(blocker); blockerRef.current = blocker;
  const handling = useRef<string | null>(null);
  useEffect(() => {
    if (blocker.state !== 'blocked' || handling.current) return;
    const targetKey = blocker.location.key; handling.current = targetKey;
    void confirmLeave().then(allowed => {
      const latest = blockerRef.current;
      if (latest.state === 'blocked') {
        if (allowed && latest.location.key === targetKey) latest.proceed(); else latest.reset();
      }
    }).finally(() => { handling.current = null; });
  }, [blocker, confirmLeave]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { const state = controller.snapshot(); if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [controller]);
  const value = useMemo(() => ({ register: controller.register, confirmLeave }), [controller, confirmLeave]);
  return <DraftGuardContext.Provider value={value}>{context}{children}</DraftGuardContext.Provider>;
}

export function useMerchantLeaveConfirmation() {
  const guard = useContext(DraftGuardContext);
  if (!guard) throw new Error('门店离开保护尚未初始化。');
  return guard.confirmLeave;
}

export function useMerchantDraftProtection(shopId: string, dirty: boolean, busy: boolean, locked?: () => boolean) {
  const guard = useContext(DraftGuardContext), id = useId();
  const actorId = useAuthStore(state => state.merchant?.id) ?? '';
  const state = useRef({ actorId, shopId, dirty, busy, locked }); state.current = { actorId, shopId, dirty, busy, locked };
  useLayoutEffect(() => {
    if (!guard) throw new Error('门店草稿保护尚未初始化。');
    return guard.register(id, () => { const next = state.current; return { actorId: next.actorId, shopId: next.shopId, dirty: next.dirty, busy: next.busy || Boolean(next.locked?.()) }; });
  }, [guard, id, actorId, shopId]);
}
