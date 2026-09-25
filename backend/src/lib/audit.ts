import type { Request } from 'express';
import { prisma, Prisma, type Tx } from './prisma.js';
import { logger } from './logger.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  changes?: unknown;
}

/** Registra una acción en la bitácora de auditoría. Nunca interrumpe la operación principal. */
export async function audit(req: Request, entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        changes: entry.changes === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(entry.changes)) as Prisma.InputJsonValue),
        companyId: req.auth?.companyId ?? null,
        userId: req.auth?.userId ?? null,
        apiKeyId: req.auth?.apiKeyId ?? null,
        ip: req.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, 'No se pudo registrar la auditoría');
  }
}
