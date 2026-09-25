export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const Unauthorized = (message = 'No autenticado') => new AppError(401, 'UNAUTHORIZED', message);
export const Forbidden = (message = 'No tiene permisos para realizar esta acción') =>
  new AppError(403, 'FORBIDDEN', message);
export const NotFound = (entity = 'Recurso') => new AppError(404, 'NOT_FOUND', `${entity} no encontrado`);
export const Conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const Unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'UNPROCESSABLE_ENTITY', message, details);
