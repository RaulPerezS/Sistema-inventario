import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, PURCHASE_STATUS, SALES_STATUS } from '@/lib/format';
import type { Party, Product, PurchaseOrder, Role, SalesOrder, Warehouse } from '@/lib/types';
import { useApiMutation, useGet, useList, useOptions } from '@/hooks/useApi';
import { useDebounce } from '@/hooks/useDebounce';
import { ItemsEditor, type ItemRow } from '@/components/ItemsEditor';
import { Badge, Button, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Textarea, type Tone } from '@/components/ui';

type AnyOrder = PurchaseOrder | SalesOrder;

interface Action {
  id: string;
  label: string;
  role: Role;
  from: string[];
  variant?: 'primary' | 'secondary' | 'danger';
  confirm: string;
  method?: 'post' | 'delete';
}

interface OrdersConfig {
  kind: 'purchase' | 'sales';
  title: string;
  description: string;
  resource: string;
  partyResource: string;
  partyLabel: string;
  partyRequired: boolean;
  priceLabel: string;
  priceField: 'unitCost' | 'unitPrice';
  createRole: Role;
  statuses: Record<string, { label: string; tone: string }>;
  actions: Action[];
  defaultPrice: (p: Product) => string;
}

const PURCHASE: OrdersConfig = {
  kind: 'purchase',
  title: 'Órdenes de compra',
  description: 'Abastecimiento desde proveedores con recepción total o parcial',
  resource: '/purchase-orders',
  partyResource: '/suppliers',
  partyLabel: 'Proveedor',
  partyRequired: true,
  priceLabel: 'Costo unitario',
  priceField: 'unitCost',
  createRole: 'MANAGER',
  statuses: PURCHASE_STATUS,
  defaultPrice: (p) => p.costPrice,
  actions: [
    { id: 'order', label: 'Emitir orden', role: 'MANAGER', from: ['DRAFT'], confirm: 'La orden quedará emitida al proveedor y no podrá editarse.' },
    { id: 'receive', label: 'Recibir pendiente', role: 'OPERATOR', from: ['ORDERED', 'PARTIALLY_RECEIVED'], confirm: 'Se ingresará al almacén todo lo pendiente de recibir.' },
    { id: 'cancel', label: 'Cancelar', role: 'MANAGER', from: ['DRAFT', 'ORDERED'], variant: 'secondary', confirm: '¿Cancelar la orden?' },
    { id: 'delete', label: 'Eliminar', role: 'MANAGER', from: ['DRAFT'], variant: 'danger', method: 'delete', confirm: '¿Eliminar el borrador?' },
  ],
};

const SALES: OrdersConfig = {
  kind: 'sales',
  title: 'Órdenes de venta',
  description: 'Pedidos de clientes: confirmación y despacho con descuento de stock',
  resource: '/sales-orders',
  partyResource: '/customers',
  partyLabel: 'Cliente',
  partyRequired: false,
  priceLabel: 'Precio unitario',
  priceField: 'unitPrice',
  createRole: 'OPERATOR',
  statuses: SALES_STATUS,
  defaultPrice: (p) => p.salePrice,
  actions: [
    { id: 'confirm', label: 'Confirmar', role: 'OPERATOR', from: ['DRAFT'], confirm: 'Se validará la disponibilidad de stock.' },
    { id: 'fulfill', label: 'Despachar', role: 'OPERATOR', from: ['CONFIRMED'], confirm: 'Se descontará el stock del almacén.' },
    { id: 'cancel', label: 'Cancelar', role: 'OPERATOR', from: ['DRAFT', 'CONFIRMED'], variant: 'secondary', confirm: '¿Cancelar la orden?' },
    { id: 'delete', label: 'Eliminar', role: 'MANAGER', from: ['DRAFT'], variant: 'danger', method: 'delete', confirm: '¿Eliminar el borrador?' },
  ],
};

const partyOf = (o: AnyOrder) => ('supplier' in o ? o.supplier : o.customer);

function OrderDetail({ cfg, id, onClose }: { cfg: OrdersConfig; id: string; onClose: () => void }) {
  const { can } = useAuth();
  const { data: order } = useGet<AnyOrder>(`${cfg.resource}/${id}`);
  const [pending, setPending] = useState<Action | null>(null);
  const run = useApiMutation(
    (a: Action) => (a.method === 'delete' ? api.delete(`${cfg.resource}/${id}`) : api.post(`${cfg.resource}/${id}/${a.id}`, {})),
    {
      success: 'Operación realizada',
      invalidate: [cfg.resource, '/products', '/inventory', '/reports'],
      onSuccess: () => {
        if (pending?.method === 'delete') onClose();
        setPending(null);
      },
    },
  );

  const status = order ? cfg.statuses[order.status] : null;
  const actions = order ? cfg.actions.filter((a) => a.from.includes(order.status) && can(a.role)) : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={order ? `Orden ${order.number}` : 'Orden'}
      size="lg"
      footer={actions.map((a) => (
        <Button key={a.id} variant={a.variant ?? 'primary'} onClick={() => setPending(a)}>
          {a.label}
        </Button>
      ))}
    >
      {order && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Estado</p>
              <Badge tone={status?.tone as Tone}>{status?.label}</Badge>
            </div>
            <div>
              <p className="text-xs text-slate-500">{cfg.partyLabel}</p>
              <p className="font-medium">{partyOf(order)?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Almacén</p>
              <p className="font-medium">{order.warehouse.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Creada</p>
              <p className="font-medium">{fmtDateTime(order.createdAt)}</p>
            </div>
          </div>
          {order.notes && <p className="text-sm text-slate-600 dark:text-slate-300">{order.notes}</p>}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800">
            <DataTable
              rowKey={(i) => i.id}
              rows={order.items}
              columns={[
                { header: 'Producto', cell: (i) => `${i.product.sku} — ${i.product.name}` },
                { header: 'Cantidad', className: 'text-right', cell: (i) => i.quantity },
                ...(cfg.kind === 'purchase' ? [{ header: 'Recibido', className: 'text-right', cell: (i: AnyOrder['items'][number]) => i.receivedQuantity ?? 0 }] : []),
                { header: cfg.priceLabel, className: 'text-right', cell: (i) => fmtMoney(i[cfg.priceField]) },
                { header: 'Subtotal', className: 'text-right', cell: (i) => fmtMoney(Number(i[cfg.priceField]) * i.quantity) },
              ]}
            />
            <div className="flex justify-end border-t border-slate-200 px-4 py-3 font-semibold dark:border-slate-800">Total: {fmtMoney(order.total)}</div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => pending && run.mutate(pending)}
        loading={run.isPending}
        title={pending?.label ?? ''}
        message={pending?.confirm}
        danger={pending?.variant === 'danger'}
        confirmText={pending?.label}
      />
    </Modal>
  );
}

function OrderForm({ cfg, onClose, onCreated }: { cfg: OrdersConfig; onClose: () => void; onCreated: (id: string) => void }) {
  const [partyId, setPartyId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const parties = useOptions<Party>(cfg.partyResource, { isActive: true });
  const warehouses = useOptions<Warehouse>('/warehouses', { isActive: true });

  const save = useApiMutation((body: unknown) => api.post<AnyOrder>(cfg.resource, body), {
    success: 'Orden creada',
    invalidate: [cfg.resource],
    onSuccess: (res) => onCreated(res.data.id),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      ...(cfg.kind === 'purchase' ? { supplierId: partyId, expectedDate: expectedDate || undefined } : { customerId: partyId || undefined }),
      warehouseId,
      notes: notes || undefined,
      items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), [cfg.priceField]: i.price === '' || i.price === undefined ? undefined : Number(i.price) })),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Nueva ${cfg.title.toLowerCase().replace('órdenes', 'orden')}`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="order-form" loading={save.isPending} disabled={items.length === 0}>
            Crear borrador
          </Button>
        </>
      }
    >
      <form id="order-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={cfg.partyLabel + (cfg.partyRequired ? ' *' : '')}>
            <Select required={cfg.partyRequired} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">{cfg.partyRequired ? 'Seleccione…' : 'Cliente mostrador'}</option>
              {parties.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Almacén *">
            <Select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Seleccione…</option>
              {warehouses.data?.data.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </Field>
          {cfg.kind === 'purchase' && (
            <Field label="Fecha esperada">
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
          )}
          <Field label="Notas" className="sm:col-span-3">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <ItemsEditor items={items} onChange={setItems} priceLabel={cfg.priceLabel} defaultPrice={cfg.defaultPrice} />
      </form>
    </Modal>
  );
}

function OrdersPage({ cfg }: { cfg: OrdersConfig }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);
  const list = useList<AnyOrder>(cfg.resource, { page, limit: 20, search: debounced, status });

  return (
    <>
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          can(cfg.createRole) && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva orden
            </Button>
          )
        }
      />
      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center dark:border-slate-800">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder={`N° de orden o ${cfg.partyLabel.toLowerCase()}…`} />
          <Select className="sm:w-52" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Estado">
            <option value="">Todos los estados</option>
            {Object.entries(cfg.statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rowKey={(o) => o.id}
          rows={list.data?.data}
          loading={list.isLoading}
          onRowClick={(o) => setDetailId(o.id)}
          columns={[
            { header: 'Número', cell: (o) => <span className="font-mono font-medium">{o.number}</span> },
            { header: 'Fecha', cell: (o) => fmtDate(o.createdAt) },
            { header: cfg.partyLabel, cell: (o) => partyOf(o)?.name ?? 'Cliente mostrador' },
            { header: 'Almacén', cell: (o) => o.warehouse.code },
            { header: 'Ítems', className: 'text-right', cell: (o) => o.items.length },
            { header: 'Total', className: 'text-right', cell: (o) => <span className="font-medium">{fmtMoney(o.total)}</span> },
            { header: 'Estado', cell: (o) => <Badge tone={cfg.statuses[o.status]?.tone as Tone}>{cfg.statuses[o.status]?.label}</Badge> },
          ]}
        />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>
      {creating && (
        <OrderForm
          cfg={cfg}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setDetailId(id);
          }}
        />
      )}
      {detailId && <OrderDetail cfg={cfg} id={detailId} onClose={() => setDetailId(null)} />}
    </>
  );
}

export const PurchaseOrdersPage = () => <OrdersPage cfg={PURCHASE} />;
export const SalesOrdersPage = () => <OrdersPage cfg={SALES} />;
