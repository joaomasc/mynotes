#!/usr/bin/env node
/**
 * Lists D1 migrations not yet applied to the REMOTE database and refuses to
 * continue if any of them contains potentially destructive SQL, unless
 * ALLOW_DESTRUCTIVE=true. Used by the manual deploy workflow before
 * `wrangler d1 migrations apply --remote`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');

const res = spawnSync(
  process.execPath,
  [wrangler, 'd1', 'execute', 'DB', '--remote', '--json', '--command', "SELECT name FROM d1_migrations ORDER BY id"],
  { cwd: apiDir, encoding: 'utf8' },
);
let applied = new Set();
if (res.status === 0) {
  applied = new Set((JSON.parse(res.stdout)[0]?.results ?? []).map((r) => r.name));
} else if (/no such table: d1_migrations/i.test(res.stdout + res.stderr)) {
  applied = new Set(); // brand-new database
} else {
  console.error(res.stdout, res.stderr);
  console.error('Não foi possível consultar as migrações aplicadas no D1 remoto.');
  process.exit(1);
}

const files = readdirSync(join(apiDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const pending = files.filter((f) => !applied.has(f));
const DESTRUCTIVE = [
  /\bDROP\s+(TABLE|INDEX|TRIGGER|VIEW)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+TABLE\s+\S+\s+(DROP|RENAME)\b/i,
  /\bUPDATE\s+\S+\s+SET\b/i,
];

if (pending.length === 0) {
  console.log('Nenhuma migração pendente.');
  process.exit(0);
}
console.log(`Migrações pendentes (${pending.length}):`);
let destructive = false;
for (const f of pending) {
  const sql = readFileSync(join(apiDir, 'migrations', f), 'utf8').replace(/--.*$/gm, '');
  // Statements inside triggers are part of the schema, not data changes.
  const outsideTriggers = sql.replace(/CREATE\s+TRIGGER[\s\S]*?\bEND\s*;/gi, '');
  const hits = DESTRUCTIVE.filter((re) => re.test(outsideTriggers)).map((re) => re.source);
  console.log(` - ${f}${hits.length ? `  ⚠ possivelmente destrutiva (${hits.join(', ')})` : ''}`);
  if (hits.length) destructive = true;
}
if (destructive && process.env.ALLOW_DESTRUCTIVE !== 'true') {
  console.error('\nHá migrações potencialmente destrutivas. Faça um backup (exportação + Time Travel) e rode novamente com allow_destructive=true.');
  process.exit(2);
}
