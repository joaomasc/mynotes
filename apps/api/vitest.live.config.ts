import { existsSync, readFileSync } from 'node:fs';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Opt-in end-to-end check against the REAL OpenAI API (costs a fraction of a
 * cent per run): `npm run test:ai-live -w @mynotes/api`. Uses OPENAI_API_KEY
 * from .dev.vars; the regular suite (`npm test`) never calls OpenAI.
 */
function devVar(name: string): string {
  if (!existsSync('.dev.vars')) return '';
  const line = readFileSync('.dev.vars', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
}

export default defineConfig(async () => {
  const key = devVar('OPENAI_API_KEY');
  if (!key.startsWith('sk-')) throw new Error('Defina OPENAI_API_KEY em apps/api/.dev.vars para rodar o teste ao vivo.');
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            ALLOWED_ORIGINS: 'http://localhost:5173',
            AUTH_SECRET: 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz',
            OPENAI_API_KEY: key,
          },
        },
      }),
    ],
    test: {
      include: ['test/live/**/*.live.ts'],
      setupFiles: ['./test/setup.ts'],
      testTimeout: 180_000,
    },
  };
});
