import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real Worker (local D1/R2 via wrangler) and the
 * production build of the web app (with its Content-Security-Policy).
 * Run: npm run test:e2e   (first time: npx playwright install chromium)
 */
export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile.spec.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: 'http://127.0.0.1:8788/api/v1/health',
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run build -w @mynotes/web && npm run preview -w @mynotes/web -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      timeout: 240_000,
      reuseExistingServer: false,
      env: { VITE_API_URL: 'http://127.0.0.1:8788', BASE_PATH: '/' },
    },
  ],
});
