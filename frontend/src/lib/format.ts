// Configuración regional: Chile (pesos sin decimales). Ajustable vía variables de Vite.
const LOCALE = import.meta.env.VITE_LOCALE ?? 'es-CL';
const CURRENCY = import.meta.env.VITE_CURRENCY ?? 'CLP';
const currency = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: CURRENCY === 'CLP' ? 0 : 2 });
const number = new Intl.NumberFormat(LOCALE);
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });

export const fmtMoney = (v: string | number | null | undefined) => currency.format(Number(v ?? 0));
export const fmtNumber = (v: number | string | null | undefined) => number.format(Number(v ?? 0));
export const fmtDateTime = (v: string | null | undefined) => (v ? dateTime.format(new Date(v)) : '—');
export const fmtDate = (v: string | null | undefined) => (v ? date.format(new Date(v)) : '—');

export const ROLE_LABELS = { ADMIN: 'Administrador', MANAGER: 'Gerente', OPERATOR: 'Operador', VIEWER: 'Consulta' } as const;

export const MOVEMENT_LABELS = {
  IN: 'Entrada',
  OUT: 'Salida',
  ADJUSTMENT: 'Ajuste',
  TRANSFER_IN: 'Transf. entrada',
  TRANSFER_OUT: 'Transf. salida',
  PURCHASE: 'Compra',
  SALE: 'Venta',
} as const;

export const PURCHASE_STATUS = {
  DRAFT: { label: 'Borrador', tone: 'gray' },
  ORDERED: { label: 'Emitida', tone: 'blue' },
  PARTIALLY_RECEIVED: { label: 'Recepción parcial', tone: 'amber' },
  RECEIVED: { label: 'Recibida', tone: 'green' },
  CANCELLED: { label: 'Cancelada', tone: 'red' },
} as const;

export const SALES_STATUS = {
  DRAFT: { label: 'Borrador', tone: 'gray' },
  CONFIRMED: { label: 'Confirmada', tone: 'blue' },
  FULFILLED: { label: 'Despachada', tone: 'green' },
  CANCELLED: { label: 'Cancelada', tone: 'red' },
} as const;

/** RUT "12345678-5" → "12.345.678-5". */
export function fmtRut(rut: string | null | undefined) {
  if (!rut) return '—';
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return rut;
  return `${clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${clean.slice(-1)}`;
}

/** Valida el dígito verificador de un RUT (módulo 11). */
export function isValidRut(rut: string) {
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const dv = 11 - (sum % 11);
  return (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv)) === clean.slice(-1);
}
