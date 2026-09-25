import type { Tx } from './prisma.js';

/** Genera números correlativos atómicos por empresa (p. ej. OC-000001) dentro de una transacción. */
export async function nextNumber(tx: Tx, companyId: string, name: string, prefix: string, pad = 6): Promise<string> {
  const key = `${companyId}:${name}`;
  const seq = await tx.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(seq.value).padStart(pad, '0')}`;
}
