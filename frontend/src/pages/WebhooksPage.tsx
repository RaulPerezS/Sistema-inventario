import { useState, type FormEvent } from 'react';
import { Copy, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { Paginated, Webhook, WebhookDelivery } from '@/lib/types';
import { useApiMutation, useGet } from '@/hooks/useApi';
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Select } from '@/components/ui';

const EVENT_LABELS: Record<string, string> = {
  'inventory.movements.created': 'Movimientos de stock',
  'inventory.low_stock': 'Stock bajo el mínimo',
  'product.created': 'Producto creado',
  'product.updated': 'Producto actualizado',
  'product.deleted': 'Producto eliminado',
  'purchase_order.created': 'Orden de compra creada',
  'purchase_order.status_changed': 'Cambio de estado de orden de compra',
  'sales_order.created': 'Orden de venta creada',
  'sales_order.status_changed': 'Cambio de estado de orden de venta',
};

const STATUS = { PENDING: ['Pendiente', 'amber'], SUCCESS: ['Entregado', 'green'], FAILED: ['Fallido', 'red'] } as const;

function SecretModal({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  return (
    <Modal open={!!secret} onClose={onClose} title="Secreto de firma" footer={<Button onClick={onClose}>Entendido</Button>}>
      <div className="space-y-3 text-sm">
        <p className="text-accent-700 dark:text-accent-400">Guárdelo ahora: no se volverá a mostrar.</p>
        <div className="flex gap-2">
          <Input readOnly value={secret ?? ''} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            variant="secondary"
            aria-label="Copiar"
            onClick={() => {
              navigator.clipboard.writeText(secret ?? '');
              toast.success('Copiado');
            }}
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <p className="text-slate-500">Verifique cada envío calculando:</p>
        <pre className="overflow-x-auto rounded-lg bg-navy-950 p-3 text-xs text-slate-100">
          {`firma = "sha256=" + HMAC_SHA256(secreto, X-Webhook-Timestamp + "." + cuerpo)
comparar con la cabecera X-Webhook-Signature`}
        </pre>
      </div>
    </Modal>
  );
}

function Deliveries({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<WebhookDelivery | null>(null);
  const list = useGet<Paginated<WebhookDelivery>>(`/webhooks/${hook.id}/deliveries`, { page, limit: 15, status });
  const retry = useApiMutation((d: WebhookDelivery) => api.post(`/webhooks/deliveries/${d.id}/retry`), {
    success: 'Reintento programado',
    invalidate: ['/webhooks'],
  });
  return (
    <Modal open onClose={onClose} title={`Envíos · ${hook.name}`} size="xl">
      <div className="mb-3 flex items-center gap-2">
        <Select className="w-48" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Estado">
          <option value="">Todos los estados</option>
          <option value="PENDING">Pendientes</option>
          <option value="SUCCESS">Entregados</option>
          <option value="FAILED">Fallidos</option>
        </Select>
        <Button variant="ghost" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => list.refetch()}>
          Actualizar
        </Button>
      </div>
      <div className="rounded-lg border border-slate-200 dark:border-navy-800">
        <DataTable
          rowKey={(d) => d.id}
          rows={list.data?.data}
          loading={list.isLoading}
          onRowClick={setDetail}
          columns={[
            { header: 'Fecha', cell: (d) => <span className="whitespace-nowrap">{fmtDateTime(d.createdAt)}</span> },
            { header: 'Evento', cell: (d) => <code className="text-xs">{d.event}</code> },
            { header: 'Estado', cell: (d) => <Badge tone={STATUS[d.status][1]}>{STATUS[d.status][0]}</Badge> },
            { header: 'Intentos', className: 'text-right', cell: (d) => d.attempts },
            { header: 'Respuesta', cell: (d) => (d.responseStatus ? `HTTP ${d.responseStatus}` : (d.error ?? '—')) },
            {
              header: '',
              className: 'text-right',
              cell: (d) =>
                d.status !== 'SUCCESS' && (
                  <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), retry.mutate(d))}>
                    Reintentar
                  </Button>
                ),
            },
          ]}
        />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.event ?? ''} size="lg">
        <pre className="max-h-96 overflow-auto rounded-lg bg-navy-950 p-3 text-xs text-slate-100">{JSON.stringify(detail?.payload, null, 2)}</pre>
      </Modal>
    </Modal>
  );
}

export default function WebhooksPage() {
  const { data: hooks, isLoading } = useGet<Webhook[]>('/webhooks');
  const events = useGet<string[]>('/webhooks/events');
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', events: [] as string[], isActive: true });
  const [secret, setSecret] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Webhook | null>(null);
  const [viewing, setViewing] = useState<Webhook | null>(null);

  const save = useApiMutation(
    (body: typeof form) => (editing ? api.patch(`/webhooks/${editing.id}`, body) : api.post<Webhook & { secret: string }>('/webhooks', body)),
    {
      success: 'Webhook guardado',
      invalidate: ['/webhooks'],
      onSuccess: (res) => {
        setFormOpen(false);
        const created = res.data as Partial<{ secret: string }>;
        if (created.secret) setSecret(created.secret);
      },
    },
  );
  const remove = useApiMutation((h: Webhook) => api.delete(`/webhooks/${h.id}`), { success: 'Webhook eliminado', invalidate: ['/webhooks'], onSuccess: () => setToDelete(null) });
  const test = useApiMutation((h: Webhook) => api.post(`/webhooks/${h.id}/test`), { success: 'Evento de prueba encolado', invalidate: ['/webhooks'] });
  const rotate = useApiMutation((h: Webhook) => api.post<{ secret: string }>(`/webhooks/${h.id}/rotate-secret`), { onSuccess: (res) => setSecret(res.data.secret) });

  const open = (h: Webhook | null) => {
    setEditing(h);
    setForm(h ? { name: h.name, url: h.url, events: h.events, isActive: h.isActive } : { name: '', url: '', events: [], isActive: true });
    setFormOpen(true);
  };
  const toggleEvent = (e: string, on: boolean) => setForm((f) => ({ ...f, events: on ? [...f.events, e] : f.events.filter((x) => x !== e) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.events.length) return toast.error('Seleccione al menos un evento');
    save.mutate(form);
  };

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Notifique en tiempo real a otros sistemas (ERP, e-commerce, POS) cuando cambia el inventario de esta empresa"
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => open(null)}>
            Nuevo webhook
          </Button>
        }
      />
      <div className="card">
        <DataTable
          rowKey={(h) => h.id}
          rows={hooks}
          loading={isLoading}
          onRowClick={setViewing}
          empty={<p className="p-8 text-center text-sm text-slate-500">Aún no hay webhooks configurados</p>}
          columns={[
            {
              header: 'Destino',
              cell: (h) => (
                <div className="min-w-0">
                  <p className="font-medium">{h.name}</p>
                  <p className="max-w-xs truncate font-mono text-xs text-slate-500">{h.url}</p>
                </div>
              ),
            },
            { header: 'Eventos', cell: (h) => (h.events.includes('*') ? <Badge tone="violet">Todos</Badge> : <span className="text-sm">{h.events.length} evento(s)</span>) },
            {
              header: 'Envíos',
              cell: (h) => (
                <div className="flex gap-1">
                  <Badge tone="green">{h.stats.success} ok</Badge>
                  {h.stats.pending > 0 && <Badge tone="amber">{h.stats.pending} pend.</Badge>}
                  {h.stats.failed > 0 && <Badge tone="red">{h.stats.failed} fallidos</Badge>}
                </div>
              ),
            },
            { header: 'Estado', cell: (h) => <Badge tone={h.isActive ? 'green' : 'gray'}>{h.isActive ? 'Activo' : 'Pausado'}</Badge> },
            {
              header: '',
              className: 'text-right',
              cell: (h) => (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => test.mutate(h)} aria-label="Enviar prueba" title="Enviar prueba">
                    <Send className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => rotate.mutate(h)} aria-label="Regenerar secreto" title="Regenerar secreto">
                    <RefreshCw className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => open(h)} aria-label="Editar">
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setToDelete(h)} aria-label="Eliminar">
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar webhook' : 'Nuevo webhook'}
        size="lg"
        footer={
          <Button type="submit" form="webhook-form" loading={save.isPending}>
            Guardar
          </Button>
        }
      >
        <form id="webhook-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre *">
              <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ERP contable" />
            </Field>
            <Field label="URL de destino *" hint="Recibirá un POST JSON firmado">
              <Input required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://erp.miempresa.cl/webhooks" />
            </Field>
          </div>
          <Field label="Eventos">
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-navy-800">
              <Checkbox label="Todos los eventos (*)" checked={form.events.includes('*')} onChange={(e) => toggleEvent('*', e.target.checked)} />
              <div className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-2 dark:border-navy-800">
                {events.data?.map((ev) => (
                  <Checkbox key={ev} label={EVENT_LABELS[ev] ?? ev} disabled={form.events.includes('*')} checked={form.events.includes(ev)} onChange={(e) => toggleEvent(ev, e.target.checked)} />
                ))}
              </div>
            </div>
          </Field>
          <Checkbox label="Activo" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
        </form>
      </Modal>

      <SecretModal secret={secret} onClose={() => setSecret(null)} />
      {viewing && <Deliveries hook={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
        loading={remove.isPending}
        danger
        title="Eliminar webhook"
        message={`"${toDelete?.name}" dejará de recibir notificaciones y se borrará su historial de envíos.`}
        confirmText="Eliminar"
      />
    </>
  );
}
