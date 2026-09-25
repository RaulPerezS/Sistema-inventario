import { Badge } from '@/components/ui';
import { CrudPage } from '@/components/CrudPage';
import { useOptions } from '@/hooks/useApi';
import type { Branch, Category, Party, Warehouse } from '@/lib/types';
import { fmtRut } from '@/lib/format';

const ActiveBadge = ({ active }: { active: boolean }) => <Badge tone={active ? 'green' : 'gray'}>{active ? 'Activo' : 'Inactivo'}</Badge>;

export function CategoriesPage() {
  const parents = useOptions<Category>('/categories');
  return (
    <CrudPage<Category>
      title="Categorías"
      description="Clasificación jerárquica de productos"
      entityName="Categoría"
      resource="/categories"
      columns={[
        { header: 'Nombre', cell: (c) => <span className="font-medium">{c.name}</span> },
        { header: 'Categoría padre', cell: (c) => c.parent?.name ?? '—' },
        { header: 'Descripción', cell: (c) => <span className="text-slate-500">{c.description ?? '—'}</span> },
        { header: 'Productos', className: 'text-right', cell: (c) => c._count.products },
      ]}
      fields={[
        { name: 'name', label: 'Nombre', required: true },
        { name: 'parentId', label: 'Categoría padre', type: 'select', options: parents.data?.data.map((c) => ({ value: c.id, label: c.name })) ?? [] },
        { name: 'description', label: 'Descripción', type: 'textarea' },
      ]}
    />
  );
}

export function WarehousesPage() {
  const branches = useOptions<Branch>('/branches', { isActive: true });
  const options = branches.data?.data.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })) ?? [];
  return (
    <CrudPage<Warehouse>
      title="Almacenes"
      description="Bodegas donde se guarda el inventario; cada una pertenece a una sucursal"
      entityName="Almacén"
      resource="/warehouses"
      deleteRole="ADMIN"
      defaults={{ isActive: true, branchId: options.length === 1 ? options[0]!.value : '' }}
      columns={[
        { header: 'Código', cell: (w) => <span className="font-mono font-medium">{w.code}</span> },
        { header: 'Nombre', cell: (w) => w.name },
        { header: 'Sucursal', cell: (w) => <Badge tone="blue">{w.branch.name}</Badge> },
        { header: 'Dirección', cell: (w) => <span className="text-slate-500">{w.address ?? '—'}</span> },
        { header: 'Estado', cell: (w) => <ActiveBadge active={w.isActive} /> },
      ]}
      fields={[
        { name: 'branchId', label: 'Sucursal', type: 'select', required: true, options },
        { name: 'code', label: 'Código', required: true, placeholder: 'ALM-01' },
        { name: 'name', label: 'Nombre', required: true },
        { name: 'address', label: 'Dirección', full: true },
        { name: 'isActive', label: 'Activo', type: 'checkbox' },
      ]}
    />
  );
}

const partyFields = [
  { name: 'name', label: 'Razón social / Nombre', required: true, full: true },
  { name: 'taxId', label: 'RUT', type: 'rut' as const },
  { name: 'email', label: 'Correo', type: 'email' as const },
  { name: 'phone', label: 'Teléfono' },
  { name: 'address', label: 'Dirección' },
  { name: 'notes', label: 'Notas', type: 'textarea' as const },
  { name: 'isActive', label: 'Activo', type: 'checkbox' as const },
];

const partyColumns = [
  { header: 'Nombre', cell: (p: Party) => <span className="font-medium">{p.name}</span> },
  { header: 'RUT', cell: (p: Party) => <span className="whitespace-nowrap tabular-nums">{fmtRut(p.taxId)}</span> },
  { header: 'Contacto', cell: (p: Party) => <span className="text-slate-500">{[p.email, p.phone].filter(Boolean).join(' · ') || '—'}</span> },
  { header: 'Estado', cell: (p: Party) => <ActiveBadge active={p.isActive} /> },
];

export function SuppliersPage() {
  return (
    <CrudPage<Party>
      title="Proveedores"
      entityName="Proveedor"
      resource="/suppliers"
      defaults={{ isActive: true }}
      searchPlaceholder="Nombre, RUT o correo…"
      columns={[...partyColumns.slice(0, 2), { header: 'Contacto', cell: (p) => p.contactName ?? '—' }, ...partyColumns.slice(2)]}
      fields={[...partyFields.slice(0, 2), { name: 'contactName', label: 'Persona de contacto' }, ...partyFields.slice(2)]}
    />
  );
}

export function CustomersPage() {
  return (
    <CrudPage<Party>
      title="Clientes"
      entityName="Cliente"
      resource="/customers"
      defaults={{ isActive: true }}
      searchPlaceholder="Nombre, RUT o correo…"
      columns={partyColumns}
      fields={partyFields}
    />
  );
}

export function BranchesPage() {
  return (
    <CrudPage<Branch>
      title="Sucursales"
      description="Locales u oficinas de la empresa. Cada almacén pertenece a una sucursal y los usuarios pueden restringirse a ciertas sucursales."
      entityName="Sucursal"
      resource="/branches"
      writeRole="ADMIN"
      defaults={{ isActive: true }}
      searchPlaceholder="Nombre, código o ciudad…"
      columns={[
        { header: 'Código', cell: (b) => <span className="font-mono font-medium">{b.code}</span> },
        { header: 'Nombre', cell: (b) => <span className="font-medium">{b.name}</span> },
        { header: 'Ciudad', cell: (b) => b.city ?? '—' },
        { header: 'Dirección', cell: (b) => <span className="text-slate-500">{b.address ?? '—'}</span> },
        { header: 'Almacenes', className: 'text-right', cell: (b) => b._count.warehouses },
        { header: 'Estado', cell: (b) => <ActiveBadge active={b.isActive} /> },
      ]}
      fields={[
        { name: 'code', label: 'Código', required: true, placeholder: 'STGO-CENTRO' },
        { name: 'name', label: 'Nombre', required: true, placeholder: 'Santiago Centro' },
        { name: 'city', label: 'Ciudad' },
        { name: 'phone', label: 'Teléfono' },
        { name: 'address', label: 'Dirección', full: true },
        { name: 'isActive', label: 'Activa', type: 'checkbox' },
      ]}
    />
  );
}
