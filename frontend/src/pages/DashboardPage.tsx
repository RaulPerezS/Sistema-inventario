import { Link } from 'react-router';
import { AlertTriangle, ClipboardList, DollarSign, Package, PackageX, ShoppingCart } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGet } from '@/hooks/useApi';
import { fmtDateTime, fmtMoney, fmtNumber, MOVEMENT_LABELS } from '@/lib/format';
import type { Movement } from '@/lib/types';
import { useThemeColors } from '@/lib/theme';
import { Badge, DataTable, PageHeader, Spinner, StatCard } from '@/components/ui';

interface Dashboard {
  totals: {
    products: number;
    warehouses: number;
    suppliers: number;
    customers: number;
    units: number;
    inventoryValue: string;
    inventoryRetailValue: string;
    lowStock: number;
    outOfStock: number;
    pendingPurchaseOrders: number;
    pendingSalesOrders: number;
  };
  movementsByDay: { date: string; in: number; out: number }[];
  recentMovements: Movement[];
}

interface LowStock {
  id: string;
  sku: string;
  name: string;
  totalStock: number;
  minStock: number;
  suggestedOrder: number;
}

export function MovementBadge({ m }: { m: Pick<Movement, 'type' | 'quantity'> }) {
  return <Badge tone={m.quantity > 0 ? 'green' : 'red'}>{MOVEMENT_LABELS[m.type]}</Badge>;
}

export default function DashboardPage() {
  const { data, isLoading } = useGet<Dashboard>('/reports/dashboard');
  const lowStock = useGet<LowStock[]>('/reports/low-stock');
  const c = useThemeColors();

  if (isLoading || !data) return <Spinner className="mx-auto mt-20 size-8" />;
  const t = data.totals;
  const margin = Number(t.inventoryRetailValue) - Number(t.inventoryValue);

  return (
    <>
      <PageHeader title="Dashboard" description="Resumen general del inventario" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard hero label="Valor del inventario (costo)" value={fmtMoney(t.inventoryValue)} hint={`Margen potencial ${fmtMoney(margin)}`} icon={<DollarSign className="size-5" />} />
        <StatCard label="Productos activos" value={fmtNumber(t.products)} hint={`${fmtNumber(t.units)} unidades en ${t.warehouses} almacenes`} icon={<Package className="size-5" />} />
        <StatCard label="Stock bajo" value={fmtNumber(t.lowStock)} hint="En o por debajo del mínimo" icon={<AlertTriangle className="size-5" />} tone="amber" />
        <StatCard label="Sin stock" value={fmtNumber(t.outOfStock)} icon={<PackageX className="size-5" />} tone="red" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link to="/purchase-orders" className="card flex items-center justify-between p-4 transition hover:border-brand-500 hover:shadow-float">
          <span className="flex items-center gap-3 text-sm">
            <ClipboardList className="size-5 text-brand-600" /> Órdenes de compra pendientes de recepción
          </span>
          <span className="text-xl font-semibold">{t.pendingPurchaseOrders}</span>
        </Link>
        <Link to="/sales-orders" className="card flex items-center justify-between p-4 transition hover:border-brand-500 hover:shadow-float">
          <span className="flex items-center gap-3 text-sm">
            <ShoppingCart className="size-5 text-brand-600" /> Órdenes de venta por despachar
          </span>
          <span className="text-xl font-semibold">{t.pendingSalesOrders}</span>
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <h2 className="mb-4 font-semibold">Unidades que entran y salen (últimos 30 días)</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.movementsByDay} margin={{ left: -10, right: 10 }}>
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c['brand-500']} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={c['brand-500']} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c['accent-500']} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={c['accent-500']} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={c['chart-grid']} vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 12 }} stroke={c['chart-axis']} />
                <YAxis tick={{ fontSize: 12 }} stroke={c['chart-axis']} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="in" name="Entradas" stroke={c['brand-500']} fill="url(#gIn)" strokeWidth={2} />
                <Area type="monotone" dataKey="out" name="Salidas" stroke={c['accent-500']} fill="url(#gOut)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-navy-800">
            <h2 className="font-semibold">Stock bajo</h2>
            <Link to="/reports" className="text-sm text-brand-600 hover:underline">
              Ver todo
            </Link>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-navy-800">
            {lowStock.data?.slice(0, 7).map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="font-mono text-xs text-slate-500">{p.sku}</p>
                </div>
                <div className="text-right">
                  <Badge tone={p.totalStock === 0 ? 'red' : 'amber'}>
                    {p.totalStock} / mín. {p.minStock}
                  </Badge>
                </div>
              </li>
            ))}
            {lowStock.data?.length === 0 && <li className="p-4 text-sm text-slate-500">Todo el inventario está sobre el mínimo 🎉</li>}
          </ul>
        </div>
      </div>

      <div className="card mt-4">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-navy-800">
          <h2 className="font-semibold">Movimientos recientes</h2>
          <Link to="/movements" className="text-sm text-brand-600 hover:underline">
            Ver todos
          </Link>
        </div>
        <DataTable
          rowKey={(m) => m.id}
          rows={data.recentMovements}
          columns={[
            { header: 'Fecha', cell: (m) => <span className="whitespace-nowrap text-slate-500">{fmtDateTime(m.createdAt)}</span> },
            { header: 'Tipo', cell: (m) => <MovementBadge m={m} /> },
            { header: 'Producto', cell: (m) => m.product.name },
            { header: 'Almacén', cell: (m) => m.warehouse.code },
            { header: 'Cantidad', className: 'text-right', cell: (m) => <span className={m.quantity > 0 ? 'text-emerald-600' : 'text-red-600'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
          ]}
        />
      </div>
    </>
  );
}
