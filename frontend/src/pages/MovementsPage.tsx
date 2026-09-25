import { useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { Download, Plus } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtMoney, MOVEMENT_LABELS } from '@/lib/format';
import type { Movement, MovementType, Role, Warehouse } from '@/lib/types';
import { useApiMutation, useList, useOptions } from '@/hooks/useApi';
import { useDebounce } from '@/hooks/useDebounce';
import { ItemsEditor, type ItemRow } from '@/components/ItemsEditor';
import { Button, DataTable, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select } from '@/components/ui';
import { MovementBadge } from './DashboardPage';

type Kind = 'entries' | 'exits' | 'adjustments' | 'transfers';
const KINDS: { id: Kind; label: string; role: Role; help: string }[] = [
  { id: 'entries', label: 'Entrada', role: 'OPERATOR', help: 'Ingreso de mercadería. Si indica el costo, se recalcula el costo promedio.' },
  { id: 'exits', label: 'Salida', role: 'OPERATOR', help: 'Consumo, merma o salida sin orden de venta.' },
  { id: 'transfers', label: 'Transferencia', role: 'OPERATOR', help: 'Traslado entre almacenes.' },
  { id: 'adjustments', label: 'Ajuste', role: 'MANAGER', help: 'Ingrese la cantidad contada físicamente; el sistema calcula la diferencia.' },
];

function NewMovementModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const [kind, setKind] = useState<Kind>('entries');
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const warehouses = useOptions<Warehouse>('/warehouses', { isActive: true });

  const save = useApiMutation((body: unknown) => api.post(`/inventory/${kind}`, body), {
    success: 'Movimiento registrado',
    invalidate: ['/inventory', '/products', '/reports'],
    onSuccess: onClose,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const common = { reference: reference || undefined, note: note || undefined };
    const body =
      kind === 'transfers'
        ? { ...common, fromWarehouseId: warehouseId, toWarehouseId, items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })) }
        : kind === 'adjustments'
          ? { ...common, warehouseId, items: items.map((i) => ({ productId: i.productId, countedQuantity: Number(i.quantity) })) }
          : {
              ...common,
              warehouseId,
              items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), ...(kind === 'entries' && i.price && { unitCost: Number(i.price) }) })),
            };
    save.mutate(body);
  };

  const whOptions = warehouses.data?.data.map((w) => (
    <option key={w.id} value={w.id}>
      {w.code} — {w.name}
    </option>
  ));

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo movimiento"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="movement-form" loading={save.isPending} disabled={items.length === 0}>
            Registrar
          </Button>
        </>
      }
    >
      <form id="movement-form" onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {KINDS.filter((k) => can(k.role)).map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={clsx('flex-1 rounded-md px-3 py-1.5 text-sm font-medium', kind === k.id ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500')}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-500">{KINDS.find((k) => k.id === kind)?.help}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={kind === 'transfers' ? 'Almacén de origen *' : 'Almacén *'}>
            <Select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Seleccione…</option>
              {whOptions}
            </Select>
          </Field>
          {kind === 'transfers' ? (
            <Field label="Almacén de destino *">
              <Select required value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                <option value="">Seleccione…</option>
                {whOptions}
              </Select>
            </Field>
          ) : (
            <Field label="Referencia" hint="N° de guía, factura, etc.">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          <Field label="Nota" className="sm:col-span-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <ItemsEditor
          key={kind}
          items={items}
          onChange={setItems}
          qtyLabel={kind === 'adjustments' ? 'Cantidad contada' : 'Cantidad'}
          priceLabel={kind === 'entries' ? 'Costo unitario' : undefined}
          defaultPrice={kind === 'entries' ? (p) => p.costPrice : undefined}
        />
      </form>
    </Modal>
  );
}

export default function MovementsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MovementType | ''>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(search);
  const warehouses = useOptions<Warehouse>('/warehouses');
  const filters = { search: debounced, type, warehouseId, from, to };
  const list = useList<Movement>('/inventory/movements', { page, limit: 25, ...filters });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));

  return (
    <>
      <PageHeader
        title="Movimientos"
        description="Historial completo de entradas, salidas, ajustes y transferencias"
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download('/inventory/movements/export', filters)}>
              Exportar CSV
            </Button>
            {can('OPERATOR') && (
              <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
                Nuevo movimiento
              </Button>
            )}
          </>
        }
      />
      <div className="card">
        <div className="flex flex-col flex-wrap gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center dark:border-slate-800">
          <SearchInput value={search} onChange={reset(setSearch)} placeholder="Producto, SKU o referencia…" />
          <Select className="sm:w-44" value={type} onChange={(e) => reset(setType)(e.target.value as MovementType)} aria-label="Tipo">
            <option value="">Todos los tipos</option>
            {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select className="sm:w-48" value={warehouseId} onChange={(e) => reset(setWarehouseId)(e.target.value)} aria-label="Almacén">
            <option value="">Todos los almacenes</option>
            {warehouses.data?.data.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </Select>
          <Input type="date" className="sm:w-40" value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="Desde" />
          <Input type="date" className="sm:w-40" value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label="Hasta" />
        </div>
        <DataTable
          rowKey={(m) => m.id}
          rows={list.data?.data}
          loading={list.isLoading}
          columns={[
            { header: 'Fecha', cell: (m) => <span className="whitespace-nowrap text-slate-500">{fmtDateTime(m.createdAt)}</span> },
            { header: 'Tipo', cell: (m) => <MovementBadge m={m} /> },
            {
              header: 'Producto',
              cell: (m) => (
                <div>
                  <p className="font-medium">{m.product.name}</p>
                  <p className="font-mono text-xs text-slate-500">{m.product.sku}</p>
                </div>
              ),
            },
            { header: 'Almacén', cell: (m) => m.warehouse.code },
            {
              header: 'Cantidad',
              className: 'text-right',
              cell: (m) => <span className={clsx('font-medium tabular-nums', m.quantity > 0 ? 'text-emerald-600' : 'text-red-600')}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>,
            },
            { header: 'Saldo', className: 'text-right tabular-nums', cell: (m) => m.balanceAfter },
            { header: 'Costo', className: 'text-right', cell: (m) => (m.unitCost ? fmtMoney(m.unitCost) : '—') },
            { header: 'Referencia', cell: (m) => <span className="text-slate-500">{m.reference ?? m.note ?? '—'}</span> },
            { header: 'Usuario', cell: (m) => m.user?.name ?? 'API' },
          ]}
        />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>
      {open && <NewMovementModal onClose={() => setOpen(false)} />}
    </>
  );
}
