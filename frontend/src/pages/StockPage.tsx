import { useState } from 'react';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import type { StockLevel, Warehouse } from '@/lib/types';
import { useList, useOptions } from '@/hooks/useApi';
import { useDebounce } from '@/hooks/useDebounce';
import { Badge, Checkbox, DataTable, PageHeader, Pagination, SearchInput, Select } from '@/components/ui';

export default function StockPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const debounced = useDebounce(search);
  const warehouses = useOptions<Warehouse>('/warehouses');
  const list = useList<StockLevel>('/inventory/stock', { page, limit: 25, search: debounced, warehouseId, onlyAvailable: onlyAvailable || undefined, sortBy: 'quantity' });

  return (
    <>
      <PageHeader title="Existencias" description="Stock disponible por producto y almacén" />
      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center dark:border-navy-800">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Producto o SKU…" />
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
            { header: 'SKU', cell: (s) => <span className="font-mono text-xs">{s.product.sku}</span> },
            { header: 'Producto', cell: (s) => <span className="font-medium">{s.product.name}</span> },
            { header: 'Almacén', cell: (s) => s.warehouse.name },
            {
              header: 'Cantidad',
              className: 'text-right',
              cell: (s) => (
                <Badge tone={s.quantity === 0 ? 'red' : s.quantity <= s.product.minStock ? 'amber' : 'green'}>
                  {fmtNumber(s.quantity)} {s.product.unit}
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
