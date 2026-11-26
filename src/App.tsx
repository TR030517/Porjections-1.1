import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { merchantWorkspaceUrl } from './utils/merchantWorkspaceUrl';
import { ArrowLeft, ShieldAlert, Store } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LoginPage from './components/LoginPage';
import { operations } from './config/operations';
import { ViewId } from './types';
import { Role, useAuthStore } from './stores/authStore';
import { canAccessView } from './permission';
import { ResourceId, ResourceQuery } from './api/resources';
import type { StoreBusinessView } from './components/store/StoreWorkspace';
import type { StoreBusinessTarget } from './components/store/StoreBusinessSettings';
import type { StoreItem } from './components/store/types';
import { shopStore, useShopStore } from './stores/shop';
import { readinessId, type ReadinessAction } from './api/shopReadiness';
import { readinessDestination } from './components/store/readinessModel';
import { ADMIN_ALL_STORES_SCOPE, clearAdminLocation, restoreAdminLocation, safeAdminLocation, writeAdminLocation } from './utils/adminLocation';
import { useConfirmation } from './components/Confirmation';
import { EMPTY_BUSINESS_LIFECYCLE, type BusinessLifecycle } from './components/store/businessScope';

// Keep the authenticated shell mounted while only the selected business module loads.
const Dashboard = Object.assign(lazy(() => import('./components/Dashboard')), { displayName: 'Dashboard' });
const AccountAccessManagement = Object.assign(lazy(() => import('./components/AccountAccessManagement')), { displayName: 'AccountAccessManagement' });
const StoreManagement = Object.assign(lazy(() => import('./components/StoreManagement')), { displayName: 'StoreManagement' });
const AreaManagement = Object.assign(lazy(() => import('./components/AreaManagement')), { displayName: 'AreaManagement' });
const CouponManagement = Object.assign(lazy(() => import('./components/CouponManagement')), { displayName: 'CouponManagement' });
const AuditLogPage = Object.assign(lazy(() => import('./components/AuditLogPage')), { displayName: 'AuditLogPage' });
const NotificationOperations = Object.assign(lazy(() => import('./components/NotificationOperations')), { displayName: 'NotificationOperations' });
const BannerManagement = Object.assign(lazy(() => import('./components/BannerManagement')), { displayName: 'BannerManagement' });
const OperationalPage = Object.assign(lazy(() => import('./components/OperationalPage')), { displayName: 'OperationalPage' });
const AfterSalesManagement = Object.assign(lazy(() => import('./components/AfterSalesManagement')), { displayName: 'AfterSalesManagement' });
const GiftCardManagement = Object.assign(lazy(() => import('./components/GiftCardManagement')), { displayName: 'GiftCardManagement' });

function historyPosition(identity: string) {
  const state = window.history.state;
  return state?.adminIdentity === identity && Number.isSafeInteger(state.adminPosition) ? state.adminPosition as number : null;
}
function Workspace() {
  const confirm = useConfirmation();
  const { currentRole, user, logout } = useAuthStore();
  const { currentStoreId } = useShopStore();
  const identity = currentRole + ':' + String(user!.id);
  const [initialLocation] = useState(() => {
    const location = restoreAdminLocation(identity, window, view => canAccessView(currentRole, view));
    shopStore.currentStoreId = readinessId(location.query.shopId) ? location.query.shopId : null;
    return location;
  });
  const [currentView, setCurrentView] = useState<ViewId>(initialLocation.view);
  const [viewQuery, setViewQuery] = useState<ResourceQuery | undefined>(initialLocation.query);
  const [locationRevision, setLocationRevision] = useState(0);
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [storeToEdit, setStoreToEdit] = useState<ResourceId | null>(null);
  const [storeBusinessTarget, setStoreBusinessTarget] = useState<StoreBusinessTarget | undefined>();
  const [storeContext, setStoreContext] = useState<Pick<StoreItem, 'id' | 'name'> | null>(null);
  const [navigationMessage, setNavigationMessage] = useState('');
  const settingsLifecycle = useRef<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const storeLifecycle = useRef<BusinessLifecycle>(EMPTY_BUSINESS_LIFECYCLE);
  const readStoreLifecycle = useRef<(() => BusinessLifecycle) | undefined>(undefined);
  const navigationPending = useRef(false);
  const headerLogoutPending = useRef(false);
  const workspaceActive = useRef(true);
  const activeLocation = useRef(initialLocation);
  const activePosition = useRef(historyPosition(identity));
  const historyTransition = useRef<{ origin: number; target: number; restored: boolean; accepted: boolean | null; completing: boolean } | null>(null);
  const settingsChanged = useCallback((state: BusinessLifecycle) => { settingsLifecycle.current = state; }, []);
  const storeChanged = useCallback((state: BusinessLifecycle, readCurrent?: () => BusinessLifecycle) => { storeLifecycle.current = state; readStoreLifecycle.current = readCurrent; }, []);
  const navigationState = useCallback(() => activeLocation.current.view === 'platform-settings' ? settingsLifecycle.current : activeLocation.current.view === 'store-list' ? readStoreLifecycle.current?.() ?? storeLifecycle.current : EMPTY_BUSINESS_LIFECYCLE, []);
  const navigationLabel = () => activeLocation.current.view === 'store-list' ? '门店工作室' : '平台设置';
  useEffect(() => { workspaceActive.current = true; return () => { workspaceActive.current = false; }; }, []);
  const allowNavigation = useCallback(async () => {
    if (navigationPending.current) return false;
    const blocked = () => {
      const state = navigationState();
      if (!state.busy && !state.unknown) return false;
      setNavigationMessage(state.unknown ? navigationLabel() + '保存结果未知，请先在当前表单核对并结束本次操作，再切换页面。' : navigationLabel() + '正在处理，请等待当前操作结束后再切换页面。');
      return true;
    };
    if (blocked()) return false;
    if (navigationState().dirty) {
      navigationPending.current = true;
      let accepted = false;
      try { accepted = await confirm({ title: '离开' + navigationLabel() + '？', message: '当前有未保存修改，离开将丢弃这些修改。', confirmLabel: '丢弃修改并离开' }); }
      finally { navigationPending.current = false; }
      if (!workspaceActive.current || !accepted || blocked()) return false;
    }
    setNavigationMessage('');
    return true;
  }, [confirm, navigationState]);
  const requestLogout = async () => {
    if (!workspaceActive.current || historyTransition.current || headerLogoutPending.current) return;
    headerLogoutPending.current = true;
    try {
      if (!await allowNavigation() || !workspaceActive.current || historyTransition.current) return;
      const state = navigationState();
      if (state.busy || state.unknown) {
        setNavigationMessage(state.unknown ? navigationLabel() + '保存结果未知，请先在当前表单核对并结束本次操作，再切换页面。' : navigationLabel() + '正在处理，请等待当前操作结束后再切换页面。');
        return;
      }
      await logout();
    } finally { headerLogoutPending.current = false; }
  };
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsNavigationOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);
  useEffect(() => {
    const restore = async () => {
      const position = historyPosition(identity), pending = historyTransition.current;
      if (pending) {
        if (pending.completing && position === pending.target) {
          if (navigationState().busy || navigationState().unknown) {
            pending.completing = false; pending.accepted = false; pending.restored = false;
            window.history.go(pending.origin - position); void allowNavigation(); return;
          }
          historyTransition.current = null;
        }
        else {
          if (position !== pending.origin) {
            if (position !== null) window.history.go(pending.origin - position);
            return;
          }
          pending.restored = true;
          if (pending.accepted === null) return;
          if (!pending.accepted) { historyTransition.current = null; return; }
          pending.completing = true; window.history.go(pending.target - pending.origin); return;
        }
      } else if (navigationState().busy || navigationState().unknown || navigationState().dirty) {
        const origin = activePosition.current;
        if (origin !== null && position !== null && origin !== position) {
          const transition = { origin, target: position, restored: false, accepted: null as boolean | null, completing: false };
          historyTransition.current = transition;
          // Return to the retained editor without replacing the user's previous history entry.
          window.history.go(origin - position);
          const accepted = await allowNavigation();
          if (!workspaceActive.current || historyTransition.current !== transition) return;
          transition.accepted = accepted;
          if (transition.restored) {
            if (accepted) { transition.completing = true; window.history.go(position - origin); }
            else historyTransition.current = null;
          }
          return;
        }
        // Legacy entries have no position marker. Preserve the target entry when retaining the editor.
        const accepted = await allowNavigation();
        if (!workspaceActive.current) return;
        if (!accepted) { writeAdminLocation(activeLocation.current, identity, window); activePosition.current = historyPosition(identity); return; }
      }
      const location = restoreAdminLocation(identity, window, view => canAccessView(currentRole, view));
      activeLocation.current = location; activePosition.current = historyPosition(identity);
      shopStore.currentStoreId = readinessId(location.query.shopId) ? location.query.shopId : null;
      setCurrentView(location.view); setViewQuery(location.query); setLocationRevision(value => value + 1);
      setStoreToEdit(null); setStoreBusinessTarget(undefined); setStoreContext(null); setIsNavigationOpen(false);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [identity, currentRole, allowNavigation, navigationState]);
  const preserveQuery = useCallback((query: ResourceQuery) => {
    if (activeLocation.current.view !== currentView) return;
    const nextQuery = { ...query };
    const currentQuery = activeLocation.current.query;
    if (currentQuery.shopScope === ADMIN_ALL_STORES_SCOPE) {
      delete nextQuery.shopId;
      nextQuery.shopScope = ADMIN_ALL_STORES_SCOPE;
    } else if (readinessId(currentQuery.shopId) && !readinessId(nextQuery.shopId)) nextQuery.shopId = currentQuery.shopId;
    activeLocation.current = { view: currentView, query: nextQuery };
    writeAdminLocation({ view: currentView, query: nextQuery }, identity, window, true);
  }, [currentView, identity]);
  const navigate = async (view: ViewId, query?: ResourceQuery, clearContext = false, nextStoreContext?: Pick<StoreItem, 'id' | 'name'>, nextStoreStudio?: { id: ResourceId; businessTarget?: StoreBusinessTarget }, canContinue?: () => boolean) => {
    if (!canAccessView(currentRole, view) || historyTransition.current) return;
    if (!await allowNavigation() || !workspaceActive.current || (canContinue && !canContinue())) return;
    const nextQuery = { ...(query ?? {}) };
    const explicitAllStores = nextQuery.shopScope === ADMIN_ALL_STORES_SCOPE;
    const explicitShop = readinessId(nextQuery.shopId);
    if (!explicitAllStores && !explicitShop) {
      const currentQuery = activeLocation.current.query;
      if (currentQuery.shopScope === ADMIN_ALL_STORES_SCOPE) nextQuery.shopScope = ADMIN_ALL_STORES_SCOPE;
      else if (readinessId(currentQuery.shopId)) nextQuery.shopId = currentQuery.shopId;
      else if (currentStoreId != null) nextQuery.shopId = currentStoreId;
    }
    const allStoresScope = nextQuery.shopScope === ADMIN_ALL_STORES_SCOPE;
    if (clearContext || allStoresScope) setStoreContext(null);
    if (nextStoreContext) setStoreContext(nextStoreContext);
    if (allStoresScope) { setStoreToEdit(null); setStoreBusinessTarget(undefined); shopStore.currentStoreId = null; }
    else if (readinessId(nextQuery.shopId)) shopStore.currentStoreId = nextQuery.shopId;
    if (nextStoreStudio && !allStoresScope) { setStoreToEdit(nextStoreStudio.id); setStoreBusinessTarget(nextStoreStudio.businessTarget); }
    if (view === 'services' || view === 'technicians' || view === 'reservation-settings') {
      const id = allStoresScope ? null : readinessId(nextQuery.shopId) ? nextQuery.shopId : currentStoreId;
      setStoreToEdit(id ?? null); setStoreBusinessTarget(view === 'reservation-settings' ? { tab: 'reservations', reservationTab: query?.tab === 'therapists' || query?.tab === 'rooms' ? query.tab : 'services', serviceId: readinessId(query?.serviceId) ? query.serviceId : undefined, therapistId: readinessId(query?.therapistId) ? query.therapistId : undefined } : view === 'services' ? { tab: 'services', serviceId: readinessId(query?.serviceId) ? query.serviceId : undefined } : { tab: view });
      const scopeQuery = allStoresScope ? { shopScope: ADMIN_ALL_STORES_SCOPE } : readinessId(nextQuery.shopId) ? { shopId: nextQuery.shopId } : {};
      const location = safeAdminLocation('store-list', scopeQuery);
      setCurrentView(location.view); setViewQuery(location.query);
      writeAdminLocation(location, identity, window);
      activeLocation.current = location;
    } else {
      const location = safeAdminLocation(view, nextQuery);
      if (typeof query?.search === 'string') location.query.search = query.search;
      setCurrentView(location.view); setViewQuery(location.query); setLocationRevision(value => value + 1);
      writeAdminLocation(location, identity, window);
      activeLocation.current = location;
    } activePosition.current = historyPosition(identity); setIsNavigationOpen(false); window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const navigateStore = (view: StoreBusinessView, item: StoreItem) => {
    if (!canAccessView(currentRole, view)) return;
    navigate(view, { shopId: item.id }, false, { id: item.id, name: item.name });
  };
  const repairStore = (action: ReadinessAction, item: StoreItem) => {
    const destination = readinessDestination(String(item.id), action);
    if (destination.kind !== 'page' || !canAccessView(currentRole, destination.view)) return;
    navigate(destination.view, destination.query, false, { id: item.id, name: item.name });
  };
  const returnToStore = (id: ResourceId, review = false) => { navigate('store-list', { shopId: String(id), storeSection: review ? 'review' : 'basic' }, false, undefined, { id, businessTarget: undefined }); };
  const renderView = () => {
    if (!canAccessView(currentRole, currentView)) return <p role="alert" className="surface-panel p-6 text-sm text-red-700">当前账户无权访问此页面。</p>;
    if (currentView === 'dashboard') return <Dashboard onNavigate={navigate} />;
    if (currentView === 'store-list') return <StoreManagement onLifecycleChange={storeChanged} initialQuery={viewQuery} onQueryChange={preserveQuery} openStoreId={storeToEdit} initialBusinessTarget={storeBusinessTarget} initialWorkspaceSection={viewQuery?.storeSection === 'review' ? 'review' : 'basic'} onStoreOpened={() => setStoreToEdit(null)} onNavigateStore={navigateStore} onManageAccountAccess={item => navigate('merchant-list', { shopId: String(item.id), returnToStore: true })} onReadinessAction={repairStore} />;
    if (currentView === 'merchant-list') {
      const initialTab = viewQuery?.tab === 'accounts' ? 'accounts' : 'access';
      return <AccountAccessManagement key={String(viewQuery?.shopId ?? 'all') + ':' + initialTab} initialShopId={readinessId(viewQuery?.shopId) ? viewQuery.shopId : undefined} initialTab={initialTab} onBack={readinessId(viewQuery?.shopId) ? () => returnToStore(String(viewQuery?.shopId), viewQuery?.returnToReview === true) : undefined} />;
    }
    if (currentView === 'area-management') return <AreaManagement />;
    if (currentView === 'coupon-management') return <CouponManagement />;
    if (currentView === 'notification-operations') return <NotificationOperations />;
    if (currentView === 'banner-list') return <BannerManagement />;
    if (currentView === 'audit-logs') return <AuditLogPage key={'audit-' + locationRevision} initialQuery={viewQuery} onQueryChange={preserveQuery} />;
    if (currentView === 'post-sales') return <AfterSalesManagement key={'cases-' + String(currentStoreId) + '-' + locationRevision} initialQuery={viewQuery} onClearOrderFilter={() => {
      const query = { ...activeLocation.current.query };
      delete query.bookingId;
      preserveQuery(query);
    }} />;
    if (currentView === 'gift-card-management') return <GiftCardManagement key={'gifts-' + String(currentStoreId)} />;
    const config = operations[currentView];
    if (config) return <>
      {storeContext && String(storeContext.id) === String(currentStoreId) && ['services','technicians','service-orders'].includes(currentView) && <div className="store-context-bar"><span className="flex min-w-0 items-center gap-2 text-sm text-teal-800"><Store className="h-4 w-4 shrink-0" /><span className="truncate">当前门店：{storeContext.name}</span></span><button type="button" onClick={() => returnToStore(storeContext.id, viewQuery?.returnToReview === true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700"><ArrowLeft className="h-4 w-4" />返回门店工作室</button></div>}
      <OperationalPage
        key={currentView + '-' + locationRevision}
        config={config}
        initialQuery={viewQuery}
        onQueryChange={preserveQuery}
        onLifecycleChange={currentView === 'platform-settings' ? settingsChanged : undefined}
        onEditStore={id => { navigate('store-list', { shopId: String(id) }, false, undefined, { id, businessTarget: undefined }); }}
        onManagePriceMenu={() => navigate('services')}
        onConfigureImportedService={(shopId, serviceId) => navigate('services', { shopId, serviceId })}
        onOpenOrderAfterSales={currentView === 'service-orders' && canAccessView(currentRole, 'post-sales') ? (target, canContinue) => {
          void navigate('post-sales', target, false, undefined, undefined, () => activeLocation.current.view === 'service-orders' && canContinue());
        } : undefined}
      />
    </>;
    return <section className="surface-panel p-8"><h1 className="page-heading">功能暂未启用</h1><p className="page-description">此功能尚未连接业务服务，当前不能提交或执行交易。</p></section>;
  };
  return <div className="app-shell">
    {isNavigationOpen && <button className="navigation-backdrop" aria-label="关闭导航" onClick={() => setIsNavigationOpen(false)} />}
    <Sidebar currentView={currentView} onViewChange={view => { void navigate(view, undefined, true); }} isOpen={isNavigationOpen} onClose={() => setIsNavigationOpen(false)} />
    <div className="app-workspace"><Header onMenuToggle={() => setIsNavigationOpen(open => !open)} onLogoutRequest={requestLogout} onSecurityRequest={allowNavigation} allStoresSelected={viewQuery?.shopScope === ADMIN_ALL_STORES_SCOPE} onStoreScopeChange={shopId => {
      const query: ResourceQuery = { ...activeLocation.current.query, page: 1 };
      if (shopId == null || String(shopId) !== String(query.shopId)) delete query.bookingId;
      if (shopId == null) { delete query.shopId; query.shopScope = ADMIN_ALL_STORES_SCOPE; }
      else { query.shopId = String(shopId); delete query.shopScope; }
      void navigate(currentView, query);
    }} /><main className="admin-main">{navigationMessage && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{navigationMessage}</p>}<Suspense fallback={<p role="status" className="surface-panel p-6 text-sm text-slate-500">正在加载页面…</p>}>{renderView()}</Suspense></main></div>
  </div>;
}
export default function App() {
  const { user, loading, currentRole, logout } = useAuthStore();
  const previousIdentity = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const identity = user ? currentRole + ':' + String(user.id) : null;
    if (previousIdentity.current && previousIdentity.current !== identity || user && currentRole !== Role.SUPER_ADMIN) clearAdminLocation(window);
    previousIdentity.current = identity;
  }, [user?.id, currentRole, loading]);
  if (loading) return <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-8"><p role="status" className="text-sm text-slate-500">正在恢复管理会话…</p></main>;
  if (!user) return <LoginPage />;
  if (currentRole !== Role.SUPER_ADMIN) return <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6"><section className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center"><ShieldAlert className="mx-auto mb-4 h-9 w-9 text-amber-600" /><h1 className="text-xl font-semibold text-slate-900">请前往商家工作区</h1><p className="mt-3 text-sm leading-6 text-slate-500">公司管理后台仅供平台管理员使用。商家和员工请使用独立商家工作区，原登录身份不会自动切换。</p><a href={merchantWorkspaceUrl('/')} className="mt-6 inline-flex rounded-lg bg-brand px-5 py-2.5 text-sm text-white">打开商家工作区</a><button type="button" onClick={() => void logout()} className="ml-3 mt-6 rounded-lg bg-brand px-5 py-2.5 text-sm text-white">退出并更换账户</button></section></main>;
  return <Workspace key={currentRole + ':' + String(user.id)} />;
}
