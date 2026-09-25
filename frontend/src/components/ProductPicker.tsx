import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useList } from '@/hooks/useApi';
import { useDebounce } from '@/hooks/useDebounce';
import { fmtMoney, fmtNumber } from '@/lib/format';
import type { Product } from '@/lib/types';
import { Input, Spinner } from './ui';

/** Buscador de productos por nombre, SKU o código de barras. */
export function ProductPicker({ onSelect, excludeIds = [] }: { onSelect: (p: Product) => void; excludeIds?: string[] }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(term, 250);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useList<Product>('/products', { search: debounced, limit: 8, isActive: true }, open);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const results = data?.data.filter((p) => !excludeIds.includes(p.id)) ?? [];

  return (
    <div ref={ref} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={term}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        placeholder="Agregar producto: nombre, SKU o código de barras…"
        className="pl-9"
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-navy-800 dark:bg-navy-900">
          {isFetching && !data ? (
            <div className="p-4">
              <Spinner className="mx-auto" />
            </div>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">Sin coincidencias</p>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-navy-800"
                onClick={() => {
                  onSelect(p);
                  setTerm('');
                  setOpen(false);
                }}
              >
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{p.sku}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-slate-500">
                  Stock {fmtNumber(p.totalStock)} · {fmtMoney(p.salePrice)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
