import { useState } from 'react';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import type { Branch, StockLevel, Warehouse } from '@/lib/types';
import { useList, useOptions } from '@/hooks/useApi';
import { useDebounce } from '@/hooks/useDebounce';
import { Badge, Checkbox, DataTable, PageHeader, Pagination, SearchInput, Select } from '@/components/ui';

export default function StockPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [branchId, setBranchId] = useState('');
  const branches = useOptions<Branch>('/branches');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const debounced = useDebounce(search);
  const warehouses = useOptions<Warehouse>('/warehouses', { branchId });
  const list = useList<StockLevel>('/inventory/stock', { page, limit: 25, search: debounced, branchId, warehouseId, onlyAvailable: onlyAvailable || undefined, sortBy: 'quantity' });

  return (
    <>
      <PageHeader title="Existencias" description="Stock físico, reservado por ventas confirmadas y disponible, por sucursal y almacén" />
      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center dark:border-navy-800">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Producto o SKU…" />
          {(branches.data?.data.length ?? 0) > 1 && (
            <Select className="sm:w-48" value={branchId} onChange={(e) => (setBranchId(e.target.value), setWarehouseId(''), setPage(1))} aria-label="Sucursal">
              <option value="">Todas las sucursales</option>
              {branches.data?.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          <Select className="sm:w-56" value={warehouseId} onChange={(e) => (setWarehouseId(e.target.value), setPage(1))} aria-label="Almacén">
            <option value="">Todos los almacenes</option>
            {warehouses.data?.data.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </Select>
          <Checkbox label="Solo con stock" checked={onlyAvailable} onChange={(e) => (setOnlyAvailable(e.target.checked), setPage(1))} />
        </div>
        <DataTable
          rowKey={(s) => `${s.productId}-${s.warehouseId}`}
          rows={list.data?.data}
          loading={list.isLoading}
          columns={[
            { header: 'SKU', cell: (s) => <span className="whitespace-nowrap font-mono text-xs">{s.product.sku}</span> },
            { header: 'Producto', cell: (s) => <span className="font-medium">{s.product.name}</span> },
            {
              header: 'Sucursal / almacén',
              cell: (s) => (
                <div>
                  <p>{s.warehouse.branch.name}</p>
                  <p className="font-mono text-xs text-slate-500">{s.warehouse.code}</p>
                </div>
              ),
            },
            { header: 'Físico', className: 'text-right tabular-nums', cell: (s) => fmtNumber(s.quantity) },
            {
              header: 'Reservado',
              className: 'text-right tabular-nums',
              cell: (s) => (s.reserved > 0 ? <span className="font-medium text-accent-700 dark:text-accent-400">{fmtNumber(s.reserved)}</span> : <span className="text-slate-400">0</span>),
            },
            {
              header: 'Disponible',
              className: 'text-right',
              cell: (s) => (
                <Badge tone={s.available <= 0 ? 'red' : s.quantity <= s.product.minStock ? 'amber' : 'green'}>
                  {fmtNumber(s.available)} {s.product.unit}
                </Badge>
              ),
            },
            { header: 'Valor (costo)', className: 'text-right', cell: (s) => fmtMoney(s.quantity * Number(s.product.costPrice)) },
            { header: 'Actualizado', cell: (s) => <span className="text-slate-500">{fmtDateTime(s.updatedAt)}</span> },
          ]}
        />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>
    </>
  );
}
