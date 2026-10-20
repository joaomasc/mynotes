import type { ApiErrorCode, ValidationIssue } from '@mynotes/shared';

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_error: 400,
  unauthorized: 401,
  session_expired: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  version_conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  idempotency_conflict: 422,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
};

/** An error that is safe to show to the client. */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = STATUS[code];
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError('bad_request', message, details);
export const validationError = (issues: ValidationIssue[]) =>
  new ApiError('validation_error', 'Dados inválidos', issues);
export const unauthorized = (message = 'Autenticação necessária') => new ApiError('unauthorized', message);
export const notFound = (what = 'Recurso') => new ApiError('not_found', `${what} não encontrado`);
export const conflict = (message: string, details?: unknown) => new ApiError('conflict', message, details);
export const versionConflict = (current: unknown) =>
  new ApiError(
    'version_conflict',
    'O item foi alterado em outro dispositivo. Revise as alterações antes de salvar.',
    { current },
  );
export const tooLarge = (message: string) => new ApiError('payload_too_large', message);
export const rateLimited = (retryAfterSeconds: number) =>
  new ApiError('rate_limited', 'Muitas tentativas. Aguarde antes de tentar novamente.', undefined, {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
