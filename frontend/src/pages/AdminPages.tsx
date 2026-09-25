import { useState, type FormEvent } from 'react';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDateTime, ROLE_LABELS } from '@/lib/format';
import type { ApiKey, AuditLog, Branch, CompanyUser, Role } from '@/lib/types';
import { useApiMutation, useList, useOptions } from '@/hooks/useApi';
import { CrudPage } from '@/components/CrudPage';
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Select } from '@/components/ui';

const roleOptions = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const roleTone = { ADMIN: 'violet', MANAGER: 'blue', OPERATOR: 'green', VIEWER: 'gray' } as const;

/** Nombres de sucursales a partir de sus IDs (vacío = todas). */
function BranchList({ ids, branches }: { ids: string[]; branches: Branch[] | undefined }) {
  if (!ids.length) return <span className="text-slate-500">Todas</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} tone="amber">
          {branches?.find((b) => b.id === id)?.name ?? '—'}
        </Badge>
      ))}
    </div>
  );
}

export function UsersPage() {
  const branches = useOptions<Branch>('/branches');
  return (
    <CrudPage<CompanyUser>
      title="Usuarios"
      description="Personas con acceso a esta empresa, su rol y las sucursales en que pueden operar"
      entityName="Usuario"
      resource="/users"
      writeRole="ADMIN"
      deleteLabel="Quitar de la empresa"
      defaults={{ role: 'VIEWER', isActive: true, branchIds: [] }}
      searchPlaceholder="Nombre o correo…"
      fromRow={(u) => ({ ...u, password: '' })}
      transform={(payload, isEdit) => {
        // El correo no se edita (identifica a la persona en todas sus empresas)
        if (isEdit) delete payload.email;
        return payload;
      }}
      columns={[
        { header: 'Nombre', cell: (u) => <span className="font-medium">{u.name}</span> },
        { header: 'Correo', cell: (u) => u.email },
        { header: 'Rol', cell: (u) => <Badge tone={roleTone[u.role]}>{ROLE_LABELS[u.role]}</Badge> },
        { header: 'Sucursales', cell: (u) => <BranchList ids={u.branchIds} branches={branches.data?.data} /> },
        { header: 'Último acceso', cell: (u) => <span className="text-slate-500">{fmtDateTime(u.lastLoginAt)}</span> },
        { header: 'Estado', cell: (u) => <Badge tone={u.isActive ? 'green' : 'gray'}>{u.isActive ? 'Activo' : 'Inactivo'}</Badge> },
      ]}
      fields={[
        { name: 'name', label: 'Nombre completo', required: true },
        { name: 'email', label: 'Correo', type: 'email', required: true, createOnly: true, hint: 'Si ya usa el sistema en otra empresa, se le dará acceso a esta.' },
        { name: 'role', label: 'Rol en esta empresa', type: 'select', required: true, options: roleOptions },
        { name: 'password', label: 'Contraseña', type: 'password', hint: 'Mín. 8 caracteres con letras y números. Obligatoria solo para usuarios nuevos; en edición déjela vacía para no cambiarla.' },
        {
          name: 'branchIds',
          label: 'Sucursales permitidas',
          type: 'multiselect',
          hint: 'Sin selección = puede operar todas las sucursales.',
          options: branches.data?.data.map((b) => ({ value: b.id, label: b.name })),
        },
        { name: 'isActive', label: 'Acceso activo', type: 'checkbox' },
      ]}
    />
  );
}

export function ApiKeysPage() {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);
  const [form, setForm] = useState({ name: '', role: 'VIEWER', expiresAt: '', branchIds: [] as string[] });
  const branches = useOptions<Branch>('/branches');
  const list = useList<ApiKey>('/api-keys', { page });

  const create = useApiMutation((body: unknown) => api.post<ApiKey & { key: string }>('/api-keys', body), {
    invalidate: ['/api-keys'],
    onSuccess: (res) => {
      setCreating(false);
      setCreated(res.data.key);
      setForm({ name: '', role: 'VIEWER', expiresAt: '', branchIds: [] });
    },
  });
  const revoke = useApiMutation((k: ApiKey) => api.delete(`/api-keys/${k.id}`), { success: 'API key revocada', invalidate: ['/api-keys'], onSuccess: () => setToRevoke(null) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name: form.name, role: form.role, branchIds: form.branchIds, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined });
  };

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Claves para que sistemas externos (ERP, e-commerce, POS) consuman la API mediante el header X-API-Key"
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nueva API key
          </Button>
        }
      />
      <div className="card">
        <DataTable
          rowKey={(k) => k.id}
          rows={list.data?.data}
          loading={list.isLoading}
          columns={[
            { header: 'Nombre', cell: (k) => <span className="font-medium">{k.name}</span> },
            { header: 'Prefijo', cell: (k) => <code className="text-xs">{k.prefix}…</code> },
            { header: 'Permisos', cell: (k) => <Badge tone={roleTone[k.role]}>{ROLE_LABELS[k.role]}</Badge> },
            { header: 'Sucursales', cell: (k) => <BranchList ids={k.branchIds} branches={branches.data?.data} /> },
            { header: 'Último uso', cell: (k) => <span className="text-slate-500">{fmtDateTime(k.lastUsedAt)}</span> },
            { header: 'Expira', cell: (k) => <span className="text-slate-500">{k.expiresAt ? fmtDateTime(k.expiresAt) : 'Nunca'}</span> },
            {
              header: 'Estado',
              cell: (k) => {
                const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
                return k.revokedAt ? <Badge tone="red">Revocada</Badge> : expired ? <Badge tone="amber">Expirada</Badge> : <Badge tone="green">Activa</Badge>;
              },
            },
            {
              header: '',
              className: 'text-right',
              cell: (k) =>
                !k.revokedAt && (
                  <Button variant="ghost" size="sm" onClick={() => setToRevoke(k)}>
                    Revocar
                  </Button>
                ),
            },
          ]}
        />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nueva API key"
        footer={
          <Button type="submit" form="key-form" loading={create.isPending}>
            Generar
          </Button>
        }
      >
        <form id="key-form" onSubmit={submit} className="space-y-4">
          <Field label="Nombre / sistema *">
            <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tienda online" />
          </Field>
          <Field label="Permisos">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roleOptions
                .filter((r) => r.value !== 'ADMIN')
                .map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Sucursales permitidas" hint="Sin selección = todas las sucursales">
            <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-slate-200 p-3 dark:border-navy-800">
              {branches.data?.data.map((b) => (
                <Checkbox
                  key={b.id}
                  label={b.name}
                  checked={form.branchIds.includes(b.id)}
                  onChange={(e) =>
                    setForm({ ...form, branchIds: e.target.checked ? [...form.branchIds, b.id] : form.branchIds.filter((id) => id !== b.id) })
                  }
                />
              ))}
            </div>
          </Field>
          <Field label="Expira (opcional)">
            <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </Field>
        </form>
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title="API key generada" footer={<Button onClick={() => setCreated(null)}>Entendido</Button>}>
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <KeyRound className="size-4" /> Copie la clave ahora: no se volverá a mostrar.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={created ?? ''} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(created ?? '');
                toast.success('Copiada al portapapeles');
              }}
              aria-label="Copiar"
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`curl -H "X-API-Key: ${created ?? ''}" \\\n  ${location.origin}/api/v1/products`}</pre>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toRevoke}
        onClose={() => setToRevoke(null)}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke)}
        loading={revoke.isPending}
        danger
        title="Revocar API key"
        message={`Los sistemas que usen "${toRevoke?.name}" dejarán de tener acceso inmediatamente.`}
        confirmText="Revocar"
      />
    </>
  );
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const list = useList<AuditLog>('/audit-logs', { page, limit: 25, entity });
  const entities = ['Product', 'Category', 'Branch', 'Warehouse', 'Supplier', 'Customer', 'StockMovement', 'PurchaseOrder', 'SalesOrder', 'User', 'ApiKey', 'Webhook', 'Company'];

  return (
    <>
      <PageHeader title="Auditoría" description="Registro de todas las acciones realizadas en el sistema" />
      <div className="card">
        <div className="border-b border-slate-200 p-4 dark:border-navy-800">
          <Select className="sm:w-56" value={entity} onChange={(e) => (setEntity(e.target.value), setPage(1))} aria-label="Entidad">
            <option value="">Todas las entidades</option>
            {entities.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </Select>
        </div>
        <DataTable
          rowKey={(l) => l.id}
          rows={list.data?.data}
          loading={list.isLoading}
          onRowClick={setDetail}
          columns={[
            { header: 'Fecha', cell: (l) => <span className="whitespace-nowrap text-slate-500">{fmtDateTime(l.createdAt)}</span> },
            { header: 'Acción', cell: (l) => <Badge tone="blue">{l.action}</Badge> },
            { header: 'Entidad', cell: (l) => l.entity },
            { header: 'Actor', cell: (l) => l.user?.name ?? (l.apiKey ? `API: ${l.apiKey.name}` : '—') },
            { header: 'IP', cell: (l) => <span className="font-mono text-xs text-slate-500">{l.ip ?? '—'}</span> },
          ]}
        />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`${detail?.action} · ${detail?.entity}`} size="lg">
        <p className="mb-2 text-sm text-slate-500">ID: {detail?.entityId ?? '—'}</p>
        <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(detail?.changes, null, 2)}</pre>
      </Modal>
    </>
  );
}
