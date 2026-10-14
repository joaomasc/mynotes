import { z } from 'zod';

export const API_ERROR_CODES = [
  'bad_request',
  'validation_error',
  'unauthorized',
  'session_expired',
  'forbidden',
  'not_found',
  'conflict',
  'version_conflict',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'idempotency_conflict',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const zApiError = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    /** Validation issues (field path + message) or conflict payload. */
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof zApiError>;

export interface ValidationIssue {
  path: string;
  message: string;
}
