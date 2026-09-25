import { Trash2 } from 'lucide-react';
import { fmtMoney } from '@/lib/format';
import type { Product } from '@/lib/types';
import { ProductPicker } from './ProductPicker';
import { Button, Input } from './ui';

export interface ItemRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  price?: string;
  taxExempt?: boolean;
}

/** Editor de líneas de productos (movimientos y órdenes). */
export function ItemsEditor({
  items,
  onChange,
  priceLabel,
  qtyLabel = 'Cantidad',
  defaultPrice,
  taxRate,
}: {
  items: ItemRow[];
  onChange: (items: ItemRow[]) => void;
  /** Si se indica, muestra columna de precio/costo. */
  priceLabel?: string;
  qtyLabel?: string;
  defaultPrice?: (p: Product) => string;
  /** Tasa de IVA (%) para mostrar neto/IVA/total; omitir para no calcular impuestos. */
  taxRate?: number;
}) {
  const update = (idx: number, patch: Partial<ItemRow>) => onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const line = (i: ItemRow) => Number(i.quantity || 0) * Number(i.price || 0);
  const subtotal = items.reduce((acc, i) => acc + line(i), 0);
  // Estimación en pantalla; el cálculo oficial (redondeo SII) lo hace la API
  const tax = taxRate === undefined ? 0 : Math.round(items.filter((i) => !i.taxExempt).reduce((acc, i) => acc + line(i), 0) * (taxRate / 100));

  return (
    <div className="space-y-3">
      <ProductPicker
        excludeIds={items.map((i) => i.productId)}
        onSelect={(p) =>
          onChange([...items, { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, quantity: '1', price: defaultPrice?.(p), taxExempt: p.taxExempt }])
        }
      />
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-navy-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-navy-800/50">
              <tr>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="w-32 px-3 py-2 text-left">{qtyLabel}</th>
                {priceLabel && <th className="w-36 px-3 py-2 text-left">{priceLabel}</th>}
                {priceLabel && <th className="w-32 px-3 py-2 text-right">{taxRate !== undefined ? "Neto" : "Subtotal"}</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-navy-800">
              {items.map((it, idx) => (
                <tr key={it.productId}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.name}</div>
                    <div className="flex items-center gap-2 font-mono text-xs text-slate-500">
                      {it.sku} · {it.unit}
                      {taxRate !== undefined && it.taxExempt && <span className="rounded-full bg-slate-100 px-1.5 font-sans text-[10px] font-bold text-slate-600 dark:bg-navy-800 dark:text-slate-300">EXENTO</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min={0} step={1} required value={it.quantity} onChange={(e) => update(idx, { quantity: e.target.value })} />
                  </td>
                  {priceLabel && (
                    <td className="px-3 py-2">
                      <Input type="number" min={0} step="1" value={it.price ?? ''} onChange={(e) => update(idx, { price: e.target.value })} />
                    </td>
                  )}
                  {priceLabel && <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(line(it))}</td>}
                  <td className="px-2">
                    <Button variant="ghost" size="sm" type="button" onClick={() => onChange(items.filter((_, i) => i !== idx))} aria-label="Quitar">
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            {priceLabel && (
              <tfoot className="text-sm">
                {taxRate !== undefined && (
                  <>
                    <tr className="border-t border-slate-200 dark:border-navy-800">
                      <td colSpan={3} className="px-3 pt-2 text-right text-slate-500">
                        Neto
                      </td>
                      <td className="px-3 pt-2 text-right tabular-nums">{fmtMoney(subtotal)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={3} className="px-3 text-right text-slate-500">
                        IVA {taxRate}%
                      </td>
                      <td className="px-3 text-right tabular-nums">{fmtMoney(tax)}</td>
                      <td />
                    </tr>
                  </>
                )}
                <tr className={taxRate === undefined ? 'border-t border-slate-200 font-semibold dark:border-navy-800' : 'font-semibold'}>
                  <td colSpan={3} className="px-3 py-2 text-right">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(subtotal + tax)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
