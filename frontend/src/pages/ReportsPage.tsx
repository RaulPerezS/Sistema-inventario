import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtMoney, fmtNumber, MOVEMENT_LABELS } from '@/lib/format';
import { useGet } from '@/hooks/useApi';
import { Badge, DataTable, Field, Input, PageHeader, Select } from '@/components/ui';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16'];

interface Valuation {
  id: string | null;
  name: string;
  units: number;
  costValue: string;
  retailValue: string;
}
interface Top {
  id: string;
  sku: string;
  name: string;
  units: number;
  revenue: string;
}
interface LowStock {
  id: string;
  sku: string;
  name: string;
  unit: string;
  minStock: number;
  totalStock: number;
  suggestedOrder: number;
  supplierName: string | null;
}
interface MovSummary {
  byType: { type: keyof typeof MOVEMENT_LABELS; count: number; units: number; value: string }[];
}
interface Sales {
  totalOrders: number;
  totalRevenue: string;
  byDay: { date: string; orders: number; revenue: string }[];
}

const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

export default function ReportsPage() {
  const [groupBy, setGroupBy] = useState<'category' | 'warehouse'>('category');
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = { from, to };
  const valuation = useGet<Valuation[]>('/reports/valuation', { groupBy });
  const top = useGet<Top[]>('/reports/top-products', { ...range, limit: 10 });
  const low = useGet<LowStock[]>('/reports/low-stock');
  const movements = useGet<MovSummary>('/reports/movements-summary', range);
  const sales = useGet<Sales>('/reports/sales-summary', range);

  const pieData = valuation.data?.map((v) => ({ name: v.name, value: Number(v.costValue) })) ?? [];

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Análisis del inventario, rotación y ventas"
        actions={
          <div className="flex items-end gap-2">
            <Field label="Desde">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Hasta">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Valorización del inventario</h2>
            <Select className="w-40" value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'category' | 'warehouse')} aria-label="Agrupar por">
              <option value="category">Por categoría</option>
              <option value="warehouse">Por almacén</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmtMoney(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2 text-sm">
              {valuation.data?.map((v, i) => (
                <li key={v.id ?? 'none'} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {v.name}
                  </span>
                  <span className="font-medium tabular-nums">{fmtMoney(v.costValue)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Productos con mayor salida</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top.data ?? []} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} stroke="#94a3b8" allowDecimals={false} />
                <YAxis type="category" dataKey="sku" tick={{ fontSize: 12 }} stroke="#94a3b8" width={70} />
                <Tooltip formatter={(v) => fmtNumber(Number(v))} labelFormatter={(sku) => top.data?.find((t) => t.sku === sku)?.name ?? sku} />
                <Bar dataKey="units" name="Unidades" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {top.data?.length === 0 && <p className="text-center text-sm text-slate-500">Sin salidas en el periodo</p>}
        </div>

        <div className="card p-5">
          <h2 className="mb-1 font-semibold">Ventas despachadas</h2>
          <p className="mb-4 text-sm text-slate-500">
            {sales.data?.totalOrders ?? 0} órdenes · <span className="font-medium text-slate-900 dark:text-slate-100">{fmtMoney(sales.data?.totalRevenue)}</span>
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sales.data?.byDay.map((d) => ({ ...d, revenue: Number(d.revenue) })) ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <Tooltip formatter={(v) => fmtMoney(Number(v))} />
                <Bar dataKey="revenue" name="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="border-b border-slate-200 p-4 font-semibold dark:border-slate-800">Movimientos por tipo</h2>
          <DataTable
            rowKey={(r) => r.type}
            rows={movements.data?.byType}
            loading={movements.isLoading}
            columns={[
              { header: 'Tipo', cell: (r) => MOVEMENT_LABELS[r.type] ?? r.type },
              { header: 'Operaciones', className: 'text-right', cell: (r) => fmtNumber(r.count) },
              { header: 'Unidades', className: 'text-right', cell: (r) => fmtNumber(r.units) },
              { header: 'Valor (costo)', className: 'text-right', cell: (r) => fmtMoney(r.value) },
            ]}
          />
        </div>
      </div>

      <div className="card mt-4">
        <h2 className="border-b border-slate-200 p-4 font-semibold dark:border-slate-800">Reposición sugerida (stock bajo)</h2>
        <DataTable
          rowKey={(r) => r.id}
          rows={low.data}
          loading={low.isLoading}
          empty={<p className="p-6 text-center text-sm text-slate-500">No hay productos por debajo del mínimo</p>}
          columns={[
            { header: 'SKU', cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
            { header: 'Producto', cell: (r) => r.name },
            { header: 'Proveedor', cell: (r) => r.supplierName ?? '—' },
            { header: 'Stock', className: 'text-right', cell: (r) => <Badge tone={r.totalStock === 0 ? 'red' : 'amber'}>{r.totalStock}</Badge> },
            { header: 'Mínimo', className: 'text-right', cell: (r) => r.minStock },
            { header: 'Sugerido comprar', className: 'text-right', cell: (r) => <span className="font-semibold">{fmtNumber(r.suggestedOrder)} {r.unit}</span> },
          ]}
        />
      </div>
    </>
  );
}
