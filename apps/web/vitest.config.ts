import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
