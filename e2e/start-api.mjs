#!/usr/bin/env node
/**
 * Starts an isolated API for the E2E tests: fresh local D1/R2 state in
 * .wrangler-e2e, migrations applied, test account created with the real
 * admin script, then `wrangler dev` on port 8788.
 */
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'apps', 'api');
const state = join(root, '.wrangler-e2e');
const require = createRequire(join(apiDir, 'package.json'));
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

export const E2E_USER = { username: 'e2e', password: 'senha-e2e-segura-123' };

const run = (args, input) => {
  const res = spawnSync(process.execPath, args, { cwd: apiDir, input, encoding: 'utf8', stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    console.error(res.stdout, res.stderr);
    process.exit(1);
  }
};

rmSync(state, { recursive: true, force: true });
run([wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
run(
  [join(apiDir, 'scripts', 'create-user.mjs'), '--username', E2E_USER.username, '--display-name', 'E2E', '--password-stdin', '--persist-to', state],
  `${E2E_USER.password}\n`,
);

const child = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--port',
    '8788',
    '--ip',
    '127.0.0.1',
    '--persist-to',
    state,
    '--var',
    'ENVIRONMENT:development',
    '--var',
    'ALLOWED_ORIGINS:http://localhost:5174',
    '--var',
    'AUTH_SECRET:e2e-only-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  ],
  { cwd: apiDir, stdio: 'inherit' },
);
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
