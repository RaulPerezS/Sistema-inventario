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
}

/** Editor de líneas de productos (movimientos y órdenes). */
export function ItemsEditor({
  items,
  onChange,
  priceLabel,
  qtyLabel = 'Cantidad',
  defaultPrice,
}: {
  items: ItemRow[];
  onChange: (items: ItemRow[]) => void;
  /** Si se indica, muestra columna de precio/costo. */
  priceLabel?: string;
  qtyLabel?: string;
  defaultPrice?: (p: Product) => string;
}) {
  const update = (idx: number, patch: Partial<ItemRow>) => onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const total = items.reduce((acc, i) => acc + Number(i.quantity || 0) * Number(i.price || 0), 0);

  return (
    <div className="space-y-3">
      <ProductPicker
        excludeIds={items.map((i) => i.productId)}
        onSelect={(p) => onChange([...items, { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, quantity: '1', price: defaultPrice?.(p) }])}
      />
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-navy-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-navy-800/50">
              <tr>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="w-32 px-3 py-2 text-left">{qtyLabel}</th>
                {priceLabel && <th className="w-36 px-3 py-2 text-left">{priceLabel}</th>}
                {priceLabel && <th className="w-32 px-3 py-2 text-right">Subtotal</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-navy-800">
              {items.map((it, idx) => (
                <tr key={it.productId}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.name}</div>
                    <div className="font-mono text-xs text-slate-500">
                      {it.sku} · {it.unit}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min={0} step={1} required value={it.quantity} onChange={(e) => update(idx, { quantity: e.target.value })} />
                  </td>
                  {priceLabel && (
                    <td className="px-3 py-2">
                      <Input type="number" min={0} step="0.01" value={it.price ?? ''} onChange={(e) => update(idx, { price: e.target.value })} />
                    </td>
                  )}
                  {priceLabel && <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(Number(it.quantity || 0) * Number(it.price || 0))}</td>}
                  <td className="px-2">
                    <Button variant="ghost" size="sm" type="button" onClick={() => onChange(items.filter((_, i) => i !== idx))} aria-label="Quitar">
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            {priceLabel && (
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold dark:border-navy-800">
                  <td colSpan={3} className="px-3 py-2 text-right">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(total)}</td>
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
