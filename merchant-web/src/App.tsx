import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/login';
import ShopPermissionRoute, { ShopLanding } from './components/ShopPermissionRoute';

const DashboardPage = lazy(() => import('./pages/dashboard'));
const BookingsPage = lazy(() => import('./pages/bookings'));
const TechniciansPage = lazy(() => import('./pages/technicians'));
const EarningsPage = lazy(() => import('./pages/earnings'));
const CouponsPage = lazy(() => import('./pages/coupons'));
const SettingsPage = lazy(() => import('./pages/settings'));
const PriceMenuPage = lazy(() => import('./pages/price-menu'));
const ProjectEntryRedirect = lazy(() => import('./components/ProjectEntryRedirect'));
const ReservationEntryRoute = lazy(() => import('./components/ProjectEntryRedirect').then(module => ({ default: module.ReservationEntryRoute })));
const AfterSalesPage = lazy(() => import('./pages/after-sales'));
const GiftsPage = lazy(() => import('./pages/gifts'));
const StaffPage = lazy(() => import('./pages/staff'));
const CopyConfigPanel = lazy(() => import('./components/CopyConfigPanel'));
const MerchantLayout = lazy(() => import('./layouts/MerchantLayout'));

// Permission guards stay outside page Suspense; page loads retain the mounted layout.
const page = (children: ReactNode) => <Suspense fallback={<p role="status" style={{ padding: 24 }}>正在加载页面…</p>}>{children}</Suspense>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            {page(<MerchantLayout />)}
          </ProtectedRoute>
        }
      >
        <Route index element={<ShopLanding />} />
        <Route path="dashboard" element={<ShopPermissionRoute permission="FINANCE_READ">{page(<DashboardPage />)}</ShopPermissionRoute>} />
        <Route path="bookings" element={<ShopPermissionRoute permission="BOOKINGS_READ">{page(<BookingsPage />)}</ShopPermissionRoute>} />
        <Route path="reservations" element={<ShopPermissionRoute permission="RESERVATION_CONFIG">{page(<ReservationEntryRoute />)}</ShopPermissionRoute>} />
        <Route path="after-sales" element={<ShopPermissionRoute permission="OWNER_ONLY">{page(<AfterSalesPage />)}</ShopPermissionRoute>} />
        <Route path="gifts" element={<ShopPermissionRoute permission="OWNER_ONLY">{page(<GiftsPage />)}</ShopPermissionRoute>} />
        <Route path="services" element={<ShopPermissionRoute permission="CATALOG_MANAGE" preserveDraft>{page(<ProjectEntryRedirect pane="metadata" />)}</ShopPermissionRoute>} />
        <Route path="technicians" element={<ShopPermissionRoute permission="CATALOG_MANAGE">{page(<TechniciansPage />)}</ShopPermissionRoute>} />
        <Route path="earnings" element={<ShopPermissionRoute permission="FINANCE_READ">{page(<EarningsPage />)}</ShopPermissionRoute>} />
        <Route path="coupons" element={<ShopPermissionRoute permission="OWNER_ONLY">{page(<CouponsPage />)}</ShopPermissionRoute>} />
        <Route path="settings" element={<ShopPermissionRoute permission="SHOP_SETTINGS_MANAGE">{page(<SettingsPage />)}</ShopPermissionRoute>} />
        <Route path="price-menu" element={<ShopPermissionRoute anyOf={['CATALOG_MANAGE', 'RESERVATION_CONFIG']} preserveDraft>{page(<PriceMenuPage />)}</ShopPermissionRoute>} />
        <Route path="copy-config" element={<ShopPermissionRoute permission="COPY_CONFIG">{page(<CopyConfigPanel />)}</ShopPermissionRoute>} />
        <Route path="staff" element={<ShopPermissionRoute permission="OWNER_ONLY">{page(<StaffPage />)}</ShopPermissionRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
