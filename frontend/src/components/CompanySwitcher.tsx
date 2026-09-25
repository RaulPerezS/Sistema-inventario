import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, Check, ChevronsUpDown, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { fmtRut, ROLE_LABELS } from '@/lib/format';

/** Muestra la empresa activa y permite cambiar a otra a la que el usuario tenga acceso. */
export function CompanySwitcher() {
  const { session, switchCompany } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!session) return null;
  const { company, companies, branchIds, branches } = session;
  const canSwitch = companies.length > 1;

  const pick = async (id: string) => {
    setOpen(false);
    if (id === company?.id) return;
    setBusy(true);
    try {
      await switchCompany(id);
      // Lo abierto pertenece a la empresa anterior: se vuelve al inicio
      navigate('/');
      toast.success('Empresa cambiada');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        disabled={!canSwitch || busy}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex max-w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition',
          canSwitch && 'hover:bg-slate-100 dark:hover:bg-navy-800',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Empresa activa"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy-950 text-brand-400 dark:bg-navy-800">
          <Building2 className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-sm font-bold">{company?.tradeName ?? company?.name ?? 'Sin empresa'}</span>
          <span className="flex items-center gap-1 truncate text-xs text-slate-500">
            {company && `RUT ${fmtRut(company.rut)}`}
            {branchIds && (
              <span className="inline-flex items-center gap-0.5 text-accent-600">
                · <MapPin className="size-3" /> {branches.map((b) => b.name).join(', ')}
              </span>
            )}
          </span>
        </span>
        {canSwitch && <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />}
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-40 mt-1 max-h-80 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-float dark:border-navy-800 dark:bg-navy-900"
        >
          <li className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Cambiar de empresa</li>
          {companies.map((c) => (
            <li key={c.id}>
              <button
                role="option"
                aria-selected={c.id === company?.id}
                onClick={() => pick(c.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-navy-800"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.tradeName ?? c.name}</span>
                  <span className="text-xs text-slate-500">
                    {fmtRut(c.rut)} · {ROLE_LABELS[c.role]}
                  </span>
                </span>
                {c.id === company?.id && <Check className="size-4 shrink-0 text-brand-500" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
