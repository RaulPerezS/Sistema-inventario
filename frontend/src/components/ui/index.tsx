import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from 'lucide-react';

// ─────────── Botón ───────────
type Variant = 'primary' | 'navy' | 'outline' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  // CTA principal: Solar Orange con brillo al pasar el cursor
  primary: 'bg-accent-500 text-white hover:bg-accent-600 hover:shadow-cta shadow-sm',
  // Acción estructural: navy corporativo
  navy: 'bg-navy-950 text-white hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500',
  // Acción técnica: contorno azure
  outline: 'border border-brand-500 text-brand-600 hover:bg-brand-500/5 dark:text-brand-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-navy-800 dark:bg-navy-900 dark:text-slate-200 dark:hover:bg-navy-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'min-h-11 px-4 py-2 text-sm',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ─────────── Formularios ───────────
export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input className={clsx('input', className)} {...props} />;
export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={clsx('input min-h-20', className)} {...props} />
);
export const Select = ({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={clsx('input pr-8', className)} {...props}>
    {children}
  </select>
);

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-[18px] rounded accent-brand-500" {...props} />
      {label}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  );
}

// ─────────── Varios ───────────
const tones = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-navy-800 dark:text-slate-300',
  blue: 'bg-brand-500/12 text-sky-700 dark:text-brand-300',
  green: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-accent-500/12 text-accent-700 dark:text-accent-400',
  red: 'bg-red-500/10 text-red-700 dark:text-red-300',
  violet: 'bg-navy-950 text-white dark:bg-brand-500/20 dark:text-brand-200',
};
export type Tone = keyof typeof tones;

export const Badge = ({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-[0.02em]', tones[tone])}>{children}</span>
);

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={clsx('size-5 animate-spin text-brand-500', className)} />;

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-navy-950 sm:text-[32px] sm:leading-10 dark:text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title = 'Sin resultados', description }: { title?: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <Inbox className="mb-3 size-10 text-slate-300 dark:text-slate-600" />
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
  );
}

// ─────────── Modal ───────────
// Pila de modales abiertos: Escape solo cierra el superior
const modalStack: symbol[] = [];

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    modalStack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Cerrar"])');
    (first ?? panelRef.current)?.focus();
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack.at(-1) === id) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
      if (modalStack.length === 0) document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-[8px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={clsx(
          'relative flex max-h-[90vh] w-full flex-col rounded-2xl border border-slate-200 bg-white shadow-modal outline-none dark:border-navy-800 dark:bg-navy-900',
          { md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size],
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-navy-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-navy-800" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (!Array.isArray(footer) || footer.length > 0) && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-navy-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  danger,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
    </Modal>
  );
}

// ─────────── Tabla ───────────
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500 dark:border-navy-800 dark:bg-navy-950/40 dark:text-slate-400">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={clsx('whitespace-nowrap px-4 py-3 font-medium', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-navy-800">
          {loading && !rows ? (
            <tr>
              <td colSpan={columns.length} className="py-14 text-center">
                <Spinner className="mx-auto" />
              </td>
            </tr>
          ) : rows && rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx('transition-colors hover:bg-slate-50 dark:hover:bg-navy-800/40', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td key={c.header} className={clsx('px-4 py-3', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>{empty ?? <EmptyState />}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta?: { page: number; totalPages: number; total: number; limit: number }; onPage: (p: number) => void }) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-navy-800">
      <span>
        {from}–{to} de {meta.total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2">
          {meta.page} / {meta.totalPages}
        </span>
        <Button variant="ghost" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Página siguiente">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'blue',
  hint,
  hero,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: Tone;
  hint?: string;
  /** Panel KPI destacado: degradado navy con acento cian. */
  hero?: boolean;
}) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-2xl p-6',
        hero ? 'bg-gradient-to-br from-navy-950 to-navy-800 text-white shadow-float' : 'card',
      )}
    >
      {hero && <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-400 to-brand-500" aria-hidden />}
      <div className="flex items-start justify-between gap-3">
        <p className={clsx('pt-1 text-sm font-medium', hero ? 'text-brand-200' : 'text-slate-500 dark:text-slate-400')}>{label}</p>
        <div className={clsx('shrink-0 rounded-xl p-2.5', hero ? 'bg-brand-400/15 text-brand-400' : tones[tone])}>{icon}</div>
      </div>
      <p className={clsx('mt-1 font-display text-[26px] font-extrabold leading-tight tabular-nums', hero && 'text-white')}>{value}</p>
      {hint && <p className={clsx('mt-1 text-xs', hero ? 'text-slate-300' : 'text-slate-500')}>{hint}</p>}
    </div>
  );
}
