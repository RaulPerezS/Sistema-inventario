import type { Tx } from './prisma.js';

/** Genera números correlativos atómicos (p. ej. OC-000001) dentro de una transacción. */
export async function nextNumber(tx: Tx, key: string, prefix: string, pad = 6): Promise<string> {
  const seq = await tx.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(seq.value).padStart(pad, '0')}`;
}
