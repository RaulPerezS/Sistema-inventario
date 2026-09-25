import { useState, type FormEvent, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { useDebounce } from '@/hooks/useDebounce';
import { useApiMutation, useList } from '@/hooks/useApi';
import { Button, Checkbox, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Textarea, type Column } from './ui';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'password' | 'textarea' | 'select' | 'checkbox' | 'date';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  full?: boolean;
  /** Solo se muestra al crear (p. ej. contraseña inicial). */
  createOnly?: boolean;
  step?: string;
}

type Values = Record<string, unknown>;

export function ResourceForm({ fields, values, onChange, isEdit }: { fields: FieldDef[]; values: Values; onChange: (v: Values) => void; isEdit: boolean }) {
  const set = (name: string, value: unknown) => onChange({ ...values, [name]: value });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields
        .filter((f) => !(f.createOnly && isEdit))
        .map((f) => {
          const value = values[f.name];
          if (f.type === 'checkbox') {
            return (
              <div key={f.name} className="sm:col-span-2">
                <Checkbox label={f.label} checked={Boolean(value)} onChange={(e) => set(f.name, e.target.checked)} />
              </div>
            );
          }
          const common = { id: f.name, required: f.required, placeholder: f.placeholder, value: (value ?? '') as string };
          return (
            <Field key={f.name} label={f.label + (f.required ? ' *' : '')} hint={f.hint} className={f.full || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
              {f.type === 'textarea' ? (
                <Textarea {...common} onChange={(e) => set(f.name, e.target.value)} />
              ) : f.type === 'select' ? (
                <Select {...common} onChange={(e) => set(f.name, e.target.value)}>
                  {!f.required && <option value="">— Ninguno —</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...common} type={f.type ?? 'text'} step={f.step} min={f.type === 'number' ? 0 : undefined} onChange={(e) => set(f.name, e.target.value)} />
              )}
            </Field>
          );
        })}
    </div>
  );
}

/** Convierte los valores del formulario al payload de la API: "" → null y números como number. */
export function toPayload(fields: FieldDef[], values: Values, isEdit: boolean): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.createOnly && isEdit) continue;
    let v = values[f.name];
    if (v === '' || v === undefined) v = f.type === 'password' ? undefined : null;
    else if (f.type === 'number') v = Number(v);
    if (v === null && f.required) continue;
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

interface CrudPageProps<T extends { id: string }> {
  title: string;
  description?: string;
  resource: string;
  columns: Column<T>[];
  fields: FieldDef[];
  entityName: string;
  writeRole?: Role;
  deleteRole?: Role;
  defaults?: Values;
  fromRow?: (row: T) => Values;
  filters?: ReactNode;
  params?: Record<string, unknown>;
  searchPlaceholder?: string;
  /** Transformación adicional del payload antes de enviarlo. */
  transform?: (payload: Values, isEdit: boolean) => Values;
  deleteLabel?: string;
}

export function CrudPage<T extends { id: string }>(p: CrudPageProps<T>) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [editing, setEditing] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [toDelete, setToDelete] = useState<T | null>(null);

  const list = useList<T>(p.resource, { page, limit: 20, search: debounced, ...p.params });

  const save = useApiMutation(
    async (payload: Values) => (editing ? api.patch(`${p.resource}/${editing.id}`, payload) : api.post(p.resource, payload)),
    { success: `${p.entityName} guardado`, invalidate: [p.resource], onSuccess: () => setFormOpen(false) },
  );
  const remove = useApiMutation(async (row: T) => api.delete(`${p.resource}/${row.id}`), {
    success: `${p.entityName} eliminado`,
    invalidate: [p.resource],
    onSuccess: () => setToDelete(null),
  });

  const canWrite = can(p.writeRole ?? 'MANAGER');
  const canDelete = can(p.deleteRole ?? p.writeRole ?? 'MANAGER');

  const openForm = (row: T | null) => {
    setEditing(row);
    setValues(row ? (p.fromRow?.(row) ?? (row as unknown as Values)) : { ...p.defaults });
    setFormOpen(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const payload = toPayload(p.fields, values, !!editing);
    save.mutate(p.transform ? p.transform(payload, !!editing) : payload);
  };

  const columns: Column<T>[] = [
    ...p.columns,
    ...(canWrite || canDelete
      ? [
          {
            header: '',
            className: 'w-24 text-right',
            cell: (row: T) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {canWrite && (
                  <Button variant="ghost" size="sm" onClick={() => openForm(row)} aria-label="Editar">
                    <Pencil className="size-4" />
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" size="sm" onClick={() => setToDelete(row)} aria-label="Eliminar">
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={p.title}
        description={p.description}
        actions={
          canWrite && (
            <Button icon={<Plus className="size-4" />} onClick={() => openForm(null)}>
              Nuevo
            </Button>
          )
        }
      />
      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center dark:border-slate-800">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={p.searchPlaceholder}
          />
          {p.filters}
        </div>
        <DataTable columns={columns} rows={list.data?.data} loading={list.isLoading} rowKey={(r) => r.id} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={`${editing ? 'Editar' : 'Nuevo'} ${p.entityName.toLowerCase()}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="crud-form" loading={save.isPending}>
              Guardar
            </Button>
          </>
        }
      >
        <form id="crud-form" onSubmit={submit}>
          <ResourceForm fields={p.fields} values={values} onChange={setValues} isEdit={!!editing} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
        loading={remove.isPending}
        danger
        title={p.deleteLabel ?? `Eliminar ${p.entityName.toLowerCase()}`}
        message="Esta acción no se puede deshacer. ¿Desea continuar?"
        confirmText={p.deleteLabel ?? 'Eliminar'}
      />
    </>
  );
}
