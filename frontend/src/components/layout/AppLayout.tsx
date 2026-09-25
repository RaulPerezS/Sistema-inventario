import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  FolderTree,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  ScrollText,
  ShoppingCart,
  Sun,
  Truck,
  UserCircle,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/format';
import type { Role } from '@/lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  role?: Role;
}

const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'General', items: [{ to: '/', label: 'Dashboard', icon: <LayoutDashboard /> }, { to: '/reports', label: 'Reportes', icon: <BarChart3 /> }] },
  {
    title: 'Inventario',
    items: [
      { to: '/products', label: 'Productos', icon: <Package /> },
      { to: '/stock', label: 'Existencias', icon: <Boxes /> },
      { to: '/movements', label: 'Movimientos', icon: <ArrowLeftRight /> },
    ],
  },
  {
    title: 'Operaciones',
    items: [
      { to: '/purchase-orders', label: 'Órdenes de compra', icon: <ClipboardList /> },
      { to: '/sales-orders', label: 'Órdenes de venta', icon: <ShoppingCart /> },
    ],
  },
  {
    title: 'Maestros',
    items: [
      { to: '/categories', label: 'Categorías', icon: <FolderTree /> },
      { to: '/warehouses', label: 'Almacenes', icon: <Warehouse /> },
      { to: '/suppliers', label: 'Proveedores', icon: <Truck /> },
      { to: '/customers', label: 'Clientes', icon: <Building2 /> },
    ],
  },
  {
    title: 'Administración',
    items: [
      { to: '/users', label: 'Usuarios', icon: <Users />, role: 'ADMIN' },
      { to: '/api-keys', label: 'API Keys', icon: <KeyRound />, role: 'ADMIN' },
      { to: '/audit', label: 'Auditoría', icon: <ScrollText />, role: 'ADMIN' },
    ],
  },
];

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* almacenamiento no disponible */
    }
  };
  return (
    <button onClick={toggle} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800" aria-label="Cambiar tema">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <div className="flex items-center gap-2 px-3">
        <img src="/favicon.svg" alt="" className="size-9" />
        <div>
          <p className="font-display text-lg font-extrabold leading-tight text-white">Inventario</p>
          <p className="text-xs font-medium text-brand-300">HGV Human Technology</p>
        </div>
      </div>
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.role || can(i.role));
        if (!items.length) return null;
        return (
          <div key={group.title}>
            <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400/80">{group.title}</p>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition [&_svg]:size-4.5',
                    isActive
                      ? 'bg-brand-500/15 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-400 [&_svg]:text-brand-400'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-brand-500/20 bg-navy-950 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-[8px]" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-navy-950">
            <button className="absolute right-2 top-2 p-2 text-slate-300" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6 dark:border-navy-800 dark:bg-navy-950/80">
          <button className="rounded-lg p-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NavLink to="/profile" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-navy-800">
              <UserCircle className="size-7 text-brand-500" />
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-tight">{user?.name}</p>
                <p className="text-xs text-slate-500">{user && ROLE_LABELS[user.role]}</p>
              </div>
            </NavLink>
            <button onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800" aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut className="size-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
