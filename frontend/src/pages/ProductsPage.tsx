import { useState, type FormEvent } from 'react';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import type { Category, Movement, Paginated, Party, Product, Warehouse } from '@/lib/types';
import { useApiMutation, useGet, useList, useOptions } from '@/hooks/useApi';
import { useDebounce } from '@/hooks/useDebounce';
import { ResourceForm, toPayload, type FieldDef } from '@/components/CrudPage';
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Modal, PageHeader, Pagination, SearchInput, Select } from '@/components/ui';
import { MovementBadge } from './DashboardPage';

function ProductDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: p } = useGet<Product>(`/products/${id}`);
  const [page, setPage] = useState(1);
  const kardex = useGet<Paginated<Movement>>(`/products/${id}/movements`, { page, limit: 10 });
  return (
    <Modal open onClose={onClose} title={p ? `${p.name}` : 'Producto'} size="xl">
      {p && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {[
              ['SKU', <span className="font-mono">{p.sku}</span>],
              ['Código de barras', p.barcode ?? '—'],
              ['Categoría', p.category?.name ?? '—'],
              ['Proveedor', p.supplier?.name ?? '—'],
              ['Costo promedio', fmtMoney(p.costPrice)],
              ['Precio de venta', fmtMoney(p.salePrice)],
              ['Stock mín. / máx.', `${p.minStock} / ${p.maxStock ?? '—'}`],
              ['Stock total', <Badge tone={p.isLowStock ? 'amber' : 'green'}>{fmtNumber(p.totalStock)} {p.unit}</Badge>],
            ].map(([label, value], i) => (
              <div key={i}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-0.5 font-medium">{value}</p>
              </div>
            ))}
          </div>
          {p.description && <p className="text-sm text-slate-600 dark:text-slate-300">{p.description}</p>}
          <div>
            <h3 className="mb-2 font-semibold">Existencias por almacén</h3>
            <div className="flex flex-wrap gap-2">
              {p.stocks?.length ? (
                p.stocks.map((s) => (
                  <div key={s.warehouse.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                    <span className="text-slate-500">{s.warehouse.name}:</span> <span className="font-semibold">{fmtNumber(s.quantity)}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Sin existencias registradas</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Kardex</h3>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800">
              <DataTable
                rowKey={(m) => m.id}
                rows={kardex.data?.data}
                loading={kardex.isLoading}
                columns={[
                  { header: 'Fecha', cell: (m) => <span className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</span> },
                  { header: 'Tipo', cell: (m) => <MovementBadge m={m} /> },
                  { header: 'Almacén', cell: (m) => m.warehouse.code },
                  { header: 'Cantidad', className: 'text-right', cell: (m) => (m.quantity > 0 ? `+${m.quantity}` : m.quantity) },
                  { header: 'Saldo', className: 'text-right', cell: (m) => m.balanceAfter },
                  { header: 'Referencia', cell: (m) => m.reference ?? '—' },
                  { header: 'Usuario', cell: (m) => m.user?.name ?? '—' },
                ]}
              />
              <Pagination meta={kardex.data?.meta} onPage={setPage} />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function ProductsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const debounced = useDebounce(search);
  const filters = { search: debounced, categoryId, lowStock: lowStock || undefined };
  const list = useList<Product>('/products', { page, limit: 20, ...filters });

  const categories = useOptions<Category>('/categories');
  const suppliers = useOptions<Party>('/suppliers', { isActive: true });
  const warehouses = useOptions<Warehouse>('/warehouses', { isActive: true });

  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [toDelete, setToDelete] = useState<Product | null>(null);

  const fields: FieldDef[] = [
    { name: 'sku', label: 'SKU', required: true, placeholder: 'LAP-001' },
    { name: 'barcode', label: 'Código de barras' },
    { name: 'name', label: 'Nombre', required: true, full: true },
    { name: 'categoryId', label: 'Categoría', type: 'select', options: categories.data?.data.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'supplierId', label: 'Proveedor', type: 'select', options: suppliers.data?.data.map((s) => ({ value: s.id, label: s.name })) },
    { name: 'unit', label: 'Unidad de medida', placeholder: 'UND, KG, CJA…' },
    { name: 'costPrice', label: 'Costo', type: 'number', step: '0.01' },
    { name: 'salePrice', label: 'Precio de venta', type: 'number', step: '0.01' },
    { name: 'minStock', label: 'Stock mínimo', type: 'number' },
    { name: 'maxStock', label: 'Stock máximo', type: 'number' },
    { name: 'description', label: 'Descripción', type: 'textarea' },
    { name: 'isActive', label: 'Activo', type: 'checkbox' },
  ];
  const initialStockFields: FieldDef[] = [
    { name: 'initialWarehouseId', label: 'Almacén (stock inicial)', type: 'select', options: warehouses.data?.data.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })) },
    { name: 'initialQuantity', label: 'Cantidad inicial', type: 'number' },
  ];

  const save = useApiMutation(
    async (payload: Record<string, unknown>) => (editing ? api.patch(`/products/${editing.id}`, payload) : api.post('/products', payload)),
    { success: 'Producto guardado', invalidate: ['/products', '/reports', '/inventory'], onSuccess: () => setFormOpen(false) },
  );
  const remove = useApiMutation(async (p: Product) => api.delete(`/products/${p.id}`), {
    success: 'Producto eliminado',
    invalidate: ['/products'],
    onSuccess: () => setToDelete(null),
  });

  const openForm = (p: Product | null) => {
    setEditing(p);
    setValues(p ? { ...p } : { unit: 'UND', costPrice: 0, salePrice: 0, minStock: 0, isActive: true });
    setFormOpen(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const payload = toPayload(fields, values, !!editing);
    if (!editing && values.initialWarehouseId && Number(values.initialQuantity) > 0) {
      payload.initialStock = { warehouseId: values.initialWarehouseId, quantity: Number(values.initialQuantity) };
    }
    save.mutate(payload);
  };

  return (
    <>
      <PageHeader
        title="Productos"
        description="Catálogo de productos y sus existencias"
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download('/products/export', filters)}>
              Exportar CSV
            </Button>
            {can('MANAGER') && (
              <Button icon={<Plus className="size-4" />} onClick={() => openForm(null)}>
                Nuevo producto
              </Button>
            )}
          </>
        }
      />
      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center dark:border-slate-800">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Nombre, SKU o código de barras…" />
          <Select className="sm:w-56" value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPage(1))} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {categories.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Checkbox label="Solo stock bajo" checked={lowStock} onChange={(e) => (setLowStock(e.target.checked), setPage(1))} />
        </div>
        <DataTable
          rowKey={(p) => p.id}
          rows={list.data?.data}
          loading={list.isLoading}
          onRowClick={(p) => setDetailId(p.id)}
          columns={[
            { header: 'SKU', cell: (p) => <span className="font-mono text-xs">{p.sku}</span> },
            {
              header: 'Producto',
              cell: (p) => (
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.category?.name ?? 'Sin categoría'}</p>
                </div>
              ),
            },
            { header: 'Costo', className: 'text-right', cell: (p) => fmtMoney(p.costPrice) },
            { header: 'Precio', className: 'text-right', cell: (p) => fmtMoney(p.salePrice) },
            {
              header: 'Stock',
              className: 'text-right',
              cell: (p) => (
                <Badge tone={p.totalStock === 0 ? 'red' : p.isLowStock ? 'amber' : 'green'}>
                  {fmtNumber(p.totalStock)} {p.unit}
                </Badge>
              ),
            },
            { header: 'Estado', cell: (p) => <Badge tone={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'Activo' : 'Inactivo'}</Badge> },
            ...(can('MANAGER')
              ? [
                  {
                    header: '',
                    className: 'w-24 text-right',
                    cell: (p: Product) => (
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={() => openForm(p)} aria-label="Editar">
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(p)} aria-label="Eliminar">
                          <Trash2 className="size-4 text-red-500" />
                        </Button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>

      {detailId && <ProductDetail id={detailId} onClose={() => setDetailId(null)} />}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar producto' : 'Nuevo producto'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="product-form" loading={save.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        <form id="product-form" onSubmit={submit} className="space-y-4">
          <ResourceForm fields={fields} values={values} onChange={setValues} isEdit={!!editing} />
          {!editing && (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700">
              <p className="mb-3 text-sm font-medium">Stock inicial (opcional)</p>
              <ResourceForm fields={initialStockFields} values={values} onChange={setValues} isEdit={false} />
            </div>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
        loading={remove.isPending}
        danger
        title="Eliminar producto"
        message={`¿Eliminar "${toDelete?.name}"? Solo es posible si no tiene existencias.`}
        confirmText="Eliminar"
      />
    </>
  );
}
