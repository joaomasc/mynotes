import { z } from 'zod';
import { KDF_BOUNDS } from '../constants';
import { zBase64, zDateTime, zId } from './common';

export const zUsername = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9._-]+$/, 'Use apenas letras, números, ponto, hífen e sublinhado');

export const zKdfParams = z.object({
  alg: z.literal('argon2id'),
  salt: zBase64(128),
  memoryKiB: z.number().int().min(KDF_BOUNDS.minMemoryKiB).max(KDF_BOUNDS.maxMemoryKiB),
  iterations: z.number().int().min(KDF_BOUNDS.minIterations).max(KDF_BOUNDS.maxIterations),
  parallelism: z.number().int().min(1).max(4),
  hashLength: z.literal(32),
});
export type KdfParams = z.infer<typeof zKdfParams>;

/** Base64 of the 32-byte client-derived key. */
export const zVerifier = zBase64(64).refine((v) => v.replace(/=+$/, '').length === 43, 'Verificador inválido');

/** Public half of the device-bound ECDSA P-256 key, as JWK. */
export const zPublicJwk = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: zBase64(64),
    y: zBase64(64),
  })
  .strip();
export type PublicJwk = z.infer<typeof zPublicJwk>;

export const zPreloginRequest = z.object({ username: zUsername });
export const zPreloginResponse = z.object({ kdf: zKdfParams });

export const zLoginRequest = z.object({
  username: zUsername,
  verifier: zVerifier,
  publicKey: zPublicJwk,
  deviceLabel: z.string().trim().max(120).optional(),
});

export const zUser = z.object({
  id: zId,
  username: z.string(),
  displayName: z.string().nullable(),
  createdAt: zDateTime,
  passwordChangedAt: zDateTime,
});
export type User = z.infer<typeof zUser>;

export const zAuthResponse = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: zDateTime,
  sessionId: zId,
  sessionExpiresAt: zDateTime,
  user: zUser,
});
export type AuthResponse = z.infer<typeof zAuthResponse>;

export const zChallengeResponse = z.object({
  challenge: z.string(),
  expiresAt: zDateTime,
});

export const zRefreshRequest = z.object({
  sessionId: zId,
  challenge: z.string().max(512),
  /** ECDSA P-256 / SHA-256 signature (IEEE P1363, base64url) over `challenge`. */
  signature: zBase64(256),
});

export const zChangePasswordRequest = z.object({
  currentVerifier: zVerifier,
  newVerifier: zVerifier,
  newKdf: zKdfParams,
});

export const zSession = z.object({
  id: zId,
  deviceLabel: z.string().nullable(),
  createdAt: zDateTime,
  lastUsedAt: zDateTime,
  expiresAt: zDateTime,
  current: z.boolean(),
});
export type Session = z.infer<typeof zSession>;
