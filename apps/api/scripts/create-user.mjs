#!/usr/bin/env node
/**
 * MyNotes — administrative account setup (run locally, never exposed as an endpoint).
 *
 *   npm run create-user -w @mynotes/api -- --username joao [--display-name "João"] [--remote]
 *   npm run create-user -w @mynotes/api -- --username joao --reset-password [--remote]
 *
 * The password is read from the terminal without echo, derived locally with
 * Argon2id (same parameters as the web app), and only the resulting hashes
 * are written to D1 through `wrangler d1 execute`. The password and the
 * derived key never leave this machine and are never written to disk.
 *
 * --local  (default) targets the local development database (.wrangler/)
 * --remote          targets the production D1 database (requires `wrangler login`)
 * --reset-password  replaces the credentials of an existing user and revokes all sessions
 * --persist-to DIR  local D1 state directory (with --local; used by the E2E tests)
 * --password-stdin  reads the password from standard input (for automation; never pass
 *                   passwords as command-line arguments)
 */
import { spawnSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { argon2id } from 'hash-wasm';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..');
const KDF = JSON.parse(readFileSync(join(here, '../../../packages/shared/src/kdf-defaults.json'), 'utf8'));
const PASSWORD_MIN = 12;
const USERNAME_RE = /^[a-z0-9._-]{3,64}$/;

function parseArgs(argv) {
  const args = { remote: false, reset: false, username: '', displayName: '', passwordStdin: false, persistTo: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remote') args.remote = true;
    else if (a === '--local') args.remote = false;
    else if (a === '--reset-password') args.reset = true;
    else if (a === '--password-stdin') args.passwordStdin = true;
    else if (a === '--persist-to') args.persistTo = String(argv[++i] ?? '');
    else if (a === '--username') args.username = String(argv[++i] ?? '').trim().toLowerCase();
    else if (a === '--display-name') args.displayName = String(argv[++i] ?? '').trim();
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      fail(`Argumento desconhecido: ${a}`);
    }
  }
  if (!USERNAME_RE.test(args.username)) fail('Informe --username (3–64 caracteres: a-z, 0-9, ponto, hífen, sublinhado).');
  if (args.displayName.length > 120) fail('--display-name muito longo.');
  return args;
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Run wrangler's JS entry with this Node binary: no shell, so arguments (SQL, paths)
// are passed verbatim on every platform.
const wranglerBin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');

function wrangler(args, { json = false } = {}) {
  const res = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: apiDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    fail('Falha ao executar o wrangler. Verifique a configuração e se as migrações foram aplicadas.');
  }
  return json ? JSON.parse(res.stdout) : res.stdout;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
      else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n');
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetArgs = args.remote ? ['--remote'] : ['--local', ...(args.persistTo ? ['--persist-to', args.persistTo] : [])];
  console.log(`MyNotes — ${args.reset ? 'redefinição de senha' : 'criação da conta'} (${args.remote ? 'PRODUÇÃO' : 'local'})`);

  const existing = wrangler(
    ['d1', 'execute', 'DB', ...targetArgs, '--json', '--command', `SELECT id FROM users WHERE username = ${sqlString(args.username)}`],
    { json: true },
  );
  const rows = existing?.[0]?.results ?? [];
  if (args.reset && rows.length === 0) fail('Usuário não encontrado para redefinição.');
  if (!args.reset) {
    const count = wrangler(['d1', 'execute', 'DB', ...targetArgs, '--json', '--command', 'SELECT COUNT(*) AS n FROM users'], {
      json: true,
    });
    if ((count?.[0]?.results?.[0]?.n ?? 0) > 0) {
      fail('Já existe uma conta. O MyNotes é de usuário único; use --reset-password para trocar a senha.');
    }
  }

  let password;
  if (args.passwordStdin) {
    password = (await readStdin()).replace(/\r?\n$/, '').normalize('NFKC');
  } else {
    if (!process.stdin.isTTY) fail('Execute em um terminal interativo (a senha é lida sem eco) ou use --password-stdin.');
    password = (await promptHidden('Nova senha: ')).normalize('NFKC');
    const confirm = (await promptHidden('Repita a senha: ')).normalize('NFKC');
    if (password !== confirm) fail('As senhas não coincidem.');
  }
  if (password.length < PASSWORD_MIN) fail(`A senha deve ter pelo menos ${PASSWORD_MIN} caracteres.`);
  if (password.length > 256) fail('Senha muito longa.');

  console.log('Derivando a chave com Argon2id (alguns segundos)…');
  const kdfSalt = randomBytes(16);
  const clientKey = await argon2id({
    password,
    salt: kdfSalt,
    iterations: KDF.iterations,
    parallelism: KDF.parallelism,
    memorySize: KDF.memoryKiB,
    hashLength: KDF.hashLength,
    outputType: 'binary',
  });
  const verifierSalt = randomBytes(16);
  const verifierHash = pbkdf2Sync(Buffer.from(clientKey), verifierSalt, KDF.serverIterations, 32, 'sha256');
  const kdfParams = JSON.stringify({
    alg: 'argon2id',
    salt: b64url(kdfSalt),
    memoryKiB: KDF.memoryKiB,
    iterations: KDF.iterations,
    parallelism: KDF.parallelism,
    hashLength: KDF.hashLength,
  });
  const now = new Date().toISOString();

  const sql = args.reset
    ? [
        `UPDATE users SET kdf_params = ${sqlString(kdfParams)}, verifier_hash = ${sqlString(b64url(verifierHash))},`,
        `  verifier_salt = ${sqlString(b64url(verifierSalt))}, verifier_iterations = ${KDF.serverIterations},`,
        `  password_changed_at = ${sqlString(now)}, updated_at = ${sqlString(now)}`,
        `  WHERE username = ${sqlString(args.username)};`,
        `UPDATE sessions SET revoked_at = ${sqlString(now)} WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE username = ${sqlString(args.username)});`,
        `DELETE FROM access_tokens WHERE session_id IN (SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${sqlString(args.username)}));`,
      ].join('\n')
    : [
        'INSERT INTO users (id, username, display_name, kdf_params, verifier_hash, verifier_salt, verifier_iterations,',
        '  password_changed_at, created_at, updated_at) VALUES (',
        `  ${sqlString(randomUUID())}, ${sqlString(args.username)}, ${args.displayName ? sqlString(args.displayName) : 'NULL'},`,
        `  ${sqlString(kdfParams)}, ${sqlString(b64url(verifierHash))}, ${sqlString(b64url(verifierSalt))}, ${KDF.serverIterations},`,
        `  ${sqlString(now)}, ${sqlString(now)}, ${sqlString(now)});`,
      ].join('\n');

  // The SQL holds only salts and hashes; it is still written to a private temp dir and removed.
  const dir = mkdtempSync(join(tmpdir(), 'mynotes-'));
  const file = join(dir, 'user.sql');
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    wrangler(['d1', 'execute', 'DB', ...targetArgs, '--file', file, '--yes']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(args.reset ? '✔ Senha redefinida; todas as sessões foram encerradas.' : `✔ Conta "${args.username}" criada.`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
