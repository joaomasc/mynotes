import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        // Tests never reach Cloudflare: Workers AI is stubbed (see transcription.test.ts).
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            ALLOWED_ORIGINS: 'http://localhost:5173,https://owner.github.io',
            AUTH_SECRET: 'test-secret-0123456789abcdefghijklmnopqrstuvwxyz',
            // Overrides a real key from .dev.vars: tests never call OpenAI (fetch is mocked).
            OPENAI_API_KEY: 'sk-test-fake-key-never-sent',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
      // Some suites (deep hierarchies, backup round trip) take ~5 s on the local Workers runtime when files run in parallel.
      testTimeout: 15_000,
    },
  };
});
