import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

const DEMO = [
  { email: 'admin@inventario.local', password: 'Admin123!', label: 'Admin' },
  { email: 'gerente@inventario.local', password: 'Gerente123!', label: 'Gerente' },
  { email: 'operador@inventario.local', password: 'Operador123!', label: 'Operador' },
  { email: 'consulta@inventario.local', password: 'Consulta123!', label: 'Consulta' },
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto size-12" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sistema de Inventario</h1>
          <p className="mt-1 text-sm text-slate-500">Ingrese sus credenciales para continuar</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <Field label="Correo electrónico">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" />
          </Field>
          <Field label="Contraseña">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            Iniciar sesión
          </Button>
        </form>
        {import.meta.env.DEV && (
          <div className="mt-6 text-center text-xs text-slate-500">
            <p className="mb-2">Usuarios de demostración:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
