import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState, Spinner } from '@/components/ui';
import LoginPage from '@/pages/LoginPage';

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const StockPage = lazy(() => import('@/pages/StockPage'));
const MovementsPage = lazy(() => import('@/pages/MovementsPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const CategoriesPage = lazy(() => import('@/pages/MasterPages').then((m) => ({ default: m.CategoriesPage })));
const WarehousesPage = lazy(() => import('@/pages/MasterPages').then((m) => ({ default: m.WarehousesPage })));
const SuppliersPage = lazy(() => import('@/pages/MasterPages').then((m) => ({ default: m.SuppliersPage })));
const CustomersPage = lazy(() => import('@/pages/MasterPages').then((m) => ({ default: m.CustomersPage })));
const PurchaseOrdersPage = lazy(() => import('@/pages/OrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })));
const SalesOrdersPage = lazy(() => import('@/pages/OrdersPage').then((m) => ({ default: m.SalesOrdersPage })));
const UsersPage = lazy(() => import('@/pages/AdminPages').then((m) => ({ default: m.UsersPage })));
const ApiKeysPage = lazy(() => import('@/pages/AdminPages').then((m) => ({ default: m.ApiKeysPage })));
const AuditPage = lazy(() => import('@/pages/AdminPages').then((m) => ({ default: m.AuditPage })));

const FullSpinner = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <Spinner className="size-8" />
  </div>
);

function Protected({ children, role }: { children: ReactNode; role?: Role }) {
  const { user, loading, can } = useAuth();
  if (loading) return <FullSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && !can(role)) return <EmptyState title="Acceso restringido" description="No tiene permisos para ver esta sección." />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <Protected>
                <AppLayout />
              </Protected>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="movements" element={<MovementsPage />} />
            <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="sales-orders" element={<SalesOrdersPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="warehouses" element={<WarehousesPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="users" element={<Protected role="ADMIN"><UsersPage /></Protected>} />
            <Route path="api-keys" element={<Protected role="ADMIN"><ApiKeysPage /></Protected>} />
            <Route path="audit" element={<Protected role="ADMIN"><AuditPage /></Protected>} />
            <Route path="*" element={<EmptyState title="Página no encontrada" />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
