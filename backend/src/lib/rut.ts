/**
 * Utilidades para el RUT chileno (Rol Único Tributario).
 * Formato canónico almacenado: "12345678-5" (sin puntos, DV en mayúscula).
 */

export function cleanRut(value: string): string {
  return value.replace(/[^0-9kK]/g, '').toUpperCase();
}

/** Calcula el dígito verificador (módulo 11). */
export function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv);
}

export function isValidRut(value: string): boolean {
  const clean = cleanRut(value);
  if (clean.length < 2 || clean.length > 9) return false;
  const body = clean.slice(0, -1);
  if (!/^\d+$/.test(body)) return false;
  return rutCheckDigit(body) === clean.slice(-1);
}

/** Normaliza a "12345678-5". Asume un RUT válido. */
export function normalizeRut(value: string): string {
  const clean = cleanRut(value);
  return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}

/** Formato de presentación "12.345.678-5". */
export function formatRut(value: string): string {
  const [body, dv] = normalizeRut(value).split('-');
  return `${body!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}
