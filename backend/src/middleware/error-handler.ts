import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `Ruta ${req.method} ${req.originalUrl} no existe`, requestId: req.id ? String(req.id) : undefined },
  } satisfies ErrorBody);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const send = (status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, details, requestId: req.id ? String(req.id) : undefined } } satisfies ErrorBody);

  if (err instanceof AppError) return send(err.statusCode, err.code, err.message, err.details);

  if (err instanceof ZodError) {
    return send(
      400,
      'VALIDATION_ERROR',
      'Datos de entrada inválidos',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target.join(', ') : target;
        return send(409, 'DUPLICATE', `Ya existe un registro con el mismo valor en: ${fields}`, { fields: target });
      }
      case 'P2025':
        return send(404, 'NOT_FOUND', 'Registro no encontrado');
      case 'P2003':
        return send(409, 'FOREIGN_KEY', 'El registro está referenciado por otros datos o la referencia no existe');
    }
  }

  // Cuerpo JSON mal formado
  if (err instanceof SyntaxError && 'body' in err) return send(400, 'INVALID_JSON', 'JSON mal formado');

  logger.error({ err, requestId: req.id ? String(req.id) : undefined }, 'Error no controlado');
  return send(500, 'INTERNAL_ERROR', isProd ? 'Error interno del servidor' : String((err as Error)?.message ?? err));
}
