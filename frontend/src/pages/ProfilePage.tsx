import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, ROLE_LABELS } from '@/lib/format';
import { useApiMutation } from '@/hooks/useApi';
import { Button, Field, Input, PageHeader } from '@/components/ui';

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useApiMutation((body: unknown) => api.patch('/auth/me/password', body), {
    success: 'Contraseña actualizada. Inicie sesión nuevamente.',
    onSuccess: () => logout(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate({ currentPassword: current, newPassword: next });
  };

  return (
    <>
      <PageHeader title="Mi perfil" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-5 text-sm">
          <h2 className="font-semibold">Información de la cuenta</h2>
          <p>
            <span className="text-slate-500">Nombre:</span> {user?.name}
          </p>
          <p>
            <span className="text-slate-500">Correo:</span> {user?.email}
          </p>
          <p>
            <span className="text-slate-500">Rol:</span> {user && ROLE_LABELS[user.role]}
          </p>
          <p>
            <span className="text-slate-500">Último acceso:</span> {fmtDateTime(user?.lastLoginAt)}
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-5">
          <h2 className="font-semibold">Cambiar contraseña</h2>
          <Field label="Contraseña actual">
            <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números">
            <Input type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirmar nueva contraseña" error={confirm && confirm !== next ? 'No coincide' : undefined}>
            <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button type="submit" loading={change.isPending} disabled={!next || next !== confirm}>
            Actualizar contraseña
          </Button>
        </form>
      </div>
    </>
  );
}
