#!/usr/bin/env node
/**
 * Builds the app against the production API and publishes it to the
 * "mynotes-web" Worker (static assets, see wrangler.jsonc).
 * Requires `npx wrangler login` (or CLOUDFLARE_API_TOKEN).
 * Override the API with MYNOTES_API_URL=https://… if it ever moves.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(webDir, 'package.json'));
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const env = {
  ...process.env,
  // Public values: they end up in the bundle.
  VITE_API_URL: process.env.MYNOTES_API_URL || 'https://mynotes-api.joaomasc-dev.workers.dev',
  BASE_PATH: '/',
};

const check = (res) => res.status === 0 || process.exit(res.status ?? 1);

// npm is a .cmd on Windows, so it needs a shell (fixed command, no arguments to escape).
check(spawnSync('npm run build', { cwd: webDir, env, stdio: 'inherit', shell: true }));
check(spawnSync(process.execPath, [wrangler, 'deploy'], { cwd: webDir, env, stdio: 'inherit' }));
