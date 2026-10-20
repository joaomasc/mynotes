#!/usr/bin/env node
/**
 * MyNotes — checks the OpenAI configuration used by the AI assistant.
 *
 *   npm run ai:check -w @mynotes/api              # free: validates the key and the model
 *   npm run ai:check -w @mynotes/api -- --ping    # one tiny paid request (fractions of a cent)
 *   npm run ai:check -w @mynotes/api -- --model gpt-5-nano
 *
 * Reads OPENAI_API_KEY from apps/api/.dev.vars (or the environment) and the
 * model, reasoning effort and prices from .dev.vars overrides or the "vars"
 * of wrangler.jsonc. The key is never printed.
 *
 * Without --ping only GET /v1/models/{model} is called, which consumes no tokens.
 * --ping sends one Responses request (store: false) and prints the real usage
 * reported by the API and its cost at the configured prices.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..');
const OPENAI = 'https://api.openai.com/v1';
const PING_MAX_OUTPUT_TOKENS = 200;

function parseArgs(argv) {
  const args = { ping: false, model: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ping') args.ping = true;
    else if (a === '--model') args.model = String(argv[++i] ?? '').trim();
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else fail(`Argumento desconhecido: ${a}`);
  }
  return args;
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** KEY=VALUE lines; comments and blank lines ignored, surrounding quotes removed. */
function readDevVars() {
  const path = join(apiDir, '.dev.vars');
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

/** Removes // and /* *\/ comments outside strings, then trailing commas. */
function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function config(args) {
  const wrangler = parseJsonc(readFileSync(join(apiDir, 'wrangler.jsonc'), 'utf8')).vars ?? {};
  const dev = readDevVars();
  const get = (name) => process.env[name] || dev[name] || wrangler[name] || '';
  const price = (name) => {
    const n = Number(get(name));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    key: get('OPENAI_API_KEY'),
    model: args.model || get('OPENAI_MODEL'),
    effort: get('AI_REASONING_EFFORT'),
    enabled: get('AI_ENABLED') !== 'false',
    prices: {
      input: price('AI_PRICE_INPUT_PER_MTOK'),
      cached: price('AI_PRICE_CACHED_INPUT_PER_MTOK'),
      output: price('AI_PRICE_OUTPUT_PER_MTOK'),
    },
  };
}

async function call(path, key, init = {}) {
  let res;
  try {
    res = await fetch(`${OPENAI}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    fail(`Sem conexão com a OpenAI (${err?.name === 'TimeoutError' ? 'tempo esgotado' : err?.message ?? err}).`);
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Explains an API error without echoing anything that could contain the key. */
function explain(status, body, model) {
  const code = body?.error?.code ?? body?.error?.type ?? '';
  const message = String(body?.error?.message ?? '').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-…');
  if (status === 401) return 'Chave inválida, revogada ou expirada (401). Gere outra em platform.openai.com/api-keys.';
  if (status === 403) return `Chave sem permissão para este recurso (403). ${message}`;
  if (status === 404) return `O modelo "${model}" não existe ou não está liberado para esta conta/projeto (404).`;
  if (status === 429 && /insufficient_quota|billing/i.test(`${code} ${message}`)) {
    return 'Sem crédito ou limite de gastos atingido (insufficient_quota). Confira Billing e Limits no painel da OpenAI.';
  }
  if (status === 429) return 'Limite de requisições atingido (429). Espere um pouco e tente de novo.';
  return `Erro ${status}${code ? ` (${code})` : ''}: ${message || 'sem detalhes'}`;
}

function usd(value) {
  return `US$ ${value.toFixed(6)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = config(args);

  if (!cfg.key) {
    fail(
      'OPENAI_API_KEY está vazia.\n  Abra apps/api/.dev.vars e cole a chave depois de "OPENAI_API_KEY=" (sem aspas).',
    );
  }
  if (/EXEMPLO|replace|COLE/i.test(cfg.key)) fail('OPENAI_API_KEY ainda contém o valor de exemplo.');
  if (!cfg.key.startsWith('sk-')) fail('OPENAI_API_KEY não parece uma chave da OpenAI (deveria começar com "sk-").');
  if (!cfg.model) fail('OPENAI_MODEL não está definido (wrangler.jsonc → vars ou .dev.vars).');

  console.log(`Chave:   configurada (${cfg.key.length} caracteres; não exibida)`);
  console.log(`Modelo:  ${cfg.model}${cfg.effort ? ` · reasoning.effort=${cfg.effort}` : ''}`);
  console.log(`IA:      ${cfg.enabled ? 'habilitada' : 'DESABILITADA (AI_ENABLED=false)'}`);

  const model = await call(`/models/${encodeURIComponent(cfg.model)}`, cfg.key);
  if (model.status !== 200) fail(explain(model.status, model.body, cfg.model));
  console.log('✔ Chave válida e modelo disponível (consulta gratuita, sem tokens).');

  if (!args.ping) {
    console.log('\nPara testar uma resposta real (custa frações de centavo): npm run ai:check -w @mynotes/api -- --ping');
    return;
  }

  const res = await call('/responses', cfg.key, {
    method: 'POST',
    body: JSON.stringify({
      model: cfg.model,
      input: 'Responda apenas com a palavra: ok',
      max_output_tokens: PING_MAX_OUTPUT_TOKENS,
      ...(cfg.effort ? { reasoning: { effort: cfg.effort } } : {}),
      store: false,
    }),
  });
  if (res.status !== 200) fail(explain(res.status, res.body, cfg.model));

  const text = (res.body.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
    .trim();
  const usage = res.body.usage ?? {};
  const input = usage.input_tokens ?? 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;

  console.log(`✔ Resposta (${res.body.status}): ${JSON.stringify(text.slice(0, 80))}`);
  console.log(`  Uso real: entrada ${input} (cache ${cached}) · saída ${output} (raciocínio ${reasoning})`);
  const { input: pIn, cached: pCached, output: pOut } = cfg.prices;
  if (pIn === null || pOut === null) {
    console.log('  Custo: preços não configurados (AI_PRICE_*_PER_MTOK).');
  } else {
    const cost = ((input - cached) * pIn + cached * (pCached ?? pIn) + output * pOut) / 1e6;
    console.log(`  Custo pelos preços configurados: ${usd(cost)}`);
  }
}

main();
