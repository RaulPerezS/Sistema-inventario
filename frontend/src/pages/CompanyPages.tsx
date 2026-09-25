import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtRut } from '@/lib/format';
import type { Company } from '@/lib/types';
import { useApiMutation, useGet } from '@/hooks/useApi';
import { CrudPage, ResourceForm, toPayload, type FieldDef } from '@/components/CrudPage';
import { Badge, Button, PageHeader, Spinner } from '@/components/ui';

const companyFields: FieldDef[] = [
  { name: 'name', label: 'Razón social', required: true, full: true },
  { name: 'tradeName', label: 'Nombre de fantasía' },
  { name: 'giro', label: 'Giro' },
  { name: 'address', label: 'Dirección' },
  { name: 'city', label: 'Ciudad' },
  { name: 'phone', label: 'Teléfono' },
  { name: 'email', label: 'Correo', type: 'email' },
  { name: 'taxRate', label: 'Tasa de IVA (%)', type: 'number', step: '0.01', hint: 'Se aplica a los productos afectos en órdenes nuevas' },
];

function CompanyForm({ company }: { company: Company }) {
  const { reload } = useAuth();
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...company }));
  const save = useApiMutation((body: Record<string, unknown>) => api.patch('/company', body), {
    success: 'Datos de la empresa actualizados',
    invalidate: ['/company'],
    onSuccess: () => reload(),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(toPayload(companyFields, values, true));
  };
  return (
    <form onSubmit={submit} className="card max-w-3xl space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500">RUT</span>
        <span className="font-display text-lg font-bold tabular-nums">{fmtRut(company.rut)}</span>
        <Badge tone="blue">{company._count?.branches} sucursal(es)</Badge>
        <Badge tone="gray">{company._count?.warehouses} almacén(es)</Badge>
        <Badge tone="gray">{company._count?.memberships} usuario(s)</Badge>
      </div>
      <ResourceForm fields={companyFields} values={values} onChange={setValues} isEdit />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

/** Datos de la empresa activa (editable por su administrador). */
export function CompanySettingsPage() {
  const { data } = useGet<Company>('/company');
  return (
    <>
      <PageHeader title="Mi empresa" description="Datos tributarios y de contacto de la empresa activa" />
      {data ? <CompanyForm key={data.id} company={data} /> : <Spinner className="mx-auto mt-20 size-8" />}
    </>
  );
}

/** Administración de empresas de la plataforma (solo administrador de plataforma). */
export function CompaniesPage() {
  const { reload } = useAuth();
  return (
    <CrudPage<Company>
      title="Empresas"
      description="Empresas (clientes) que usan la plataforma. Cada una tiene sus propios datos, sucursales y usuarios, totalmente aislados."
      entityName="Empresa"
      resource="/companies"
      writeRole="VIEWER"
      deleteRole="ADMIN"
      canDelete={false}
      searchPlaceholder="Razón social, fantasía o RUT…"
      defaults={{ taxRate: 19, isActive: true, branchCode: 'MATRIZ', branchName: 'Casa Matriz' }}
      transform={(payload, isEdit) => {
        const { branchCode, branchName, adminEmail, adminName, adminPassword, ...rest } = payload as Record<string, string>;
        if (isEdit) return rest;
        return {
          ...rest,
          branch: { code: branchCode || 'MATRIZ', name: branchName || 'Casa Matriz' },
          ...(adminEmail && { admin: { email: adminEmail, name: adminName || adminEmail, password: adminPassword || undefined } }),
        };
      }}
      onSaved={() => reload()}
      columns={[
        {
          header: 'Empresa',
          cell: (c) => (
            <div>
              <p className="font-medium">{c.tradeName ?? c.name}</p>
              <p className="text-xs text-slate-500">{c.name}</p>
            </div>
          ),
        },
        { header: 'RUT', cell: (c) => <span className="whitespace-nowrap tabular-nums">{fmtRut(c.rut)}</span> },
        { header: 'Ciudad', cell: (c) => c.city ?? '—' },
        { header: 'Sucursales', className: 'text-right', cell: (c) => c._count?.branches ?? 0 },
        { header: 'Usuarios', className: 'text-right', cell: (c) => c._count?.memberships ?? 0 },
        { header: 'Estado', cell: (c) => <Badge tone={c.isActive ? 'green' : 'gray'}>{c.isActive ? 'Activa' : 'Inactiva'}</Badge> },
      ]}
      fields={[
        { name: 'rut', label: 'RUT', type: 'rut', required: true },
        ...companyFields,
        { name: 'isActive', label: 'Activa', type: 'checkbox' },
        { name: 'branchCode', label: 'Código primera sucursal', createOnly: true },
        { name: 'branchName', label: 'Nombre primera sucursal', createOnly: true },
        { name: 'adminEmail', label: 'Correo del administrador', type: 'email', createOnly: true, hint: 'Opcional. Si ya existe, se le da acceso.' },
        { name: 'adminName', label: 'Nombre del administrador', createOnly: true },
        { name: 'adminPassword', label: 'Contraseña del administrador', type: 'password', createOnly: true, hint: 'Obligatoria si el usuario es nuevo' },
      ]}
    />
  );
}

