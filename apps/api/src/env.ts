/** Hono environment: Worker bindings plus per-request variables. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    requestId: string;
    /** Set by the auth middleware on private routes. */
    userId: string;
    sessionId: string;
  };
}

export interface RuntimeConfig {
  allowedOrigins: Set<string>;
  sessionMaxSeconds: number;
  sessionIdleSeconds: number;
  isProduction: boolean;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function runtimeConfig(env: Env): RuntimeConfig {
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0 && o !== '*');
  return {
    allowedOrigins: new Set(origins),
    sessionMaxSeconds: positiveInt(env.SESSION_MAX_DAYS, 60) * 86400,
    sessionIdleSeconds: positiveInt(env.SESSION_IDLE_DAYS, 14) * 86400,
    isProduction: env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test',
  };
}

/** Fails closed when the auth secret is missing or weak. */
export function authSecret(env: Env): string {
  const secret = env.AUTH_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.startsWith('replace-with')) {
    throw new Error('AUTH_SECRET is not configured');
  }
  return secret;
}
