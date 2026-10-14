#!/usr/bin/env node
/**
 * Copies pdf.js runtime assets (CMaps, standard fonts, wasm decoders) to
 * public/pdfjs so they are served from the app's own origin (CSP: 'self').
 * Runs automatically before `dev` and `build`; the output is git-ignored.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'));
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');
const stamp = join(target, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) process.exit(0);
mkdirSync(target, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  const from = join(pkgDir, dir);
  if (existsSync(from)) cpSync(from, join(target, dir), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`pdf.js ${version} assets copied to public/pdfjs`);
