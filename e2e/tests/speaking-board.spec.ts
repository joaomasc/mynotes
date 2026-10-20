import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import { login } from './helpers';

/**
 * Stage 3 end to end: the examining board on a recorded talk (questions from
 * the model, answers recorded and linked to the talk), the method library and
 * the three levels of the path. The model's answers are scripted here.
 */
function fakeSpeechWav(): string {
  const rate = 48_000;
  const samples = Math.round(rate * 4.5);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples * 2, 40);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    phase += (2 * Math.PI * (170 + 40 * Math.sin(2 * Math.PI * 0.7 * t))) / rate;
    const v = t < 2.5 ? 0.3 * (0.6 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase)) : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'fake-speech-board.wav');
  writeFileSync(file, buf);
  return file;
}

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fakeSpeechWav()}`],
  },
});

test.beforeEach(async ({ page }) => login(page));

const SAY = 'Sim. O transporte público custa menos por pessoa. Curitiba é o melhor exemplo.';

function transcription(text: string) {
  const words = text.split(' ');
  const step = 2.2 / words.length;
  return {
    text,
    durationSeconds: 2.9,
    segments: [{ start: 0.4, end: 2.7, text, avgLogprob: -0.3 }],
    words: words.map((w, i) => ({ text: w, start: 0.4 + i * step, end: 0.4 + (i + 0.9) * step })),
  };
}

const json = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

/** The stored talk from the real API, changed by `patch`. */
async function stored(route: Route, patch: (data: Record<string, unknown>) => void) {
  const url = route.request().url().replace(/\/(evaluate|questions)$/, '');
  const body = await (await route.fetch({ url, method: 'GET', postData: undefined })).json();
  patch(body.data);
  return json(route, body.data);
}

test('the board asks about a talk and every answer is recorded and evaluated', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/api/v1/transcriptions', (route) => json(route, transcription(SAY)));
  await page.route('**/api/v1/ai/status', (route) =>
    json(route, {
      enabled: true,
      configured: true,
      model: 'gpt-6-luna',
      dailyBudgetUsd: 0.5,
      spentTodayUsd: 0,
      limits: { messageChars: 4000, toolCallsPerTurn: 8, requestsPerMinute: 6 },
      pricing: { inputPerMTok: 0.1, cachedInputPerMTok: 0.01, outputPerMTok: 0.5 },
      webSearch: { enabled: true, maxPerTurn: 5, pricePerCallUsd: 0.01 },
      usage: [],
    }),
  );
  await page.route('**/api/v1/speech/attempts/*/evaluate', (route) =>
    stored(route, (a) => {
      a.evaluated = true;
      a.evaluation = {
        criteria: [{ id: 'centralIdea', state: 'good', value: 'Respondeu na primeira frase.', reference: '', source: 'textAi', original: null, rewrite: null }],
        improvements: [],
        exercise: 'Responda em uma frase antes de explicar.',
        summary: 'Resposta direta.',
        model: 'gpt-6-luna',
        evaluatedAt: new Date().toISOString(),
      };
    }),
  );
  await page.route('**/api/v1/speech/attempts/*/questions', (route) => {
    asked.push(route.request().url());
    return stored(route, (a) => {
      a.questions = ['O que custa menos, exatamente?', 'E se a cidade for pequena?', 'Que outro exemplo você daria?'];
    });
  });

  // A short free talk.
  await page.goto('/speaking/free');
  await page.getByRole('radio', { name: 'Fala livre' }).click();
  await page.getByLabel('Tema').fill('Transporte público');
  await page.getByRole('button', { name: 'Começar a gravar' }).click();
  await page.waitForTimeout(8_000);
  await page.getByRole('button', { name: 'Terminar' }).click();
  await page.waitForURL(/\/speaking\/attempts\/[0-9a-f-]{36}$/, { timeout: 40_000 });
  const talkUrl = page.url();

  // The board.
  await page.getByRole('button', { name: 'Treinar a banca' }).click();
  await page.waitForURL(/\/banca$/);
  await page.getByRole('button', { name: 'Chamar a banca' }).click();
  await expect(page.getByText('O que custa menos, exatamente?')).toBeVisible();
  expect(asked).toHaveLength(1);
  for (const [i, label] of ['Próxima pergunta', 'Próxima pergunta', 'Concluir a banca'].entries()) {
    await expect(page.getByText(`Banca · pergunta ${i + 1} de 3`)).toBeVisible();
    await page.getByRole('button', { name: 'Começar a gravar' }).click();
    await page.waitForTimeout(6_000);
    await page.getByRole('button', { name: 'Terminar' }).click();
    await expect(page.getByText('Metas cumpridas!')).toBeVisible({ timeout: 40_000 });
    if (i === 0) await page.screenshot({ path: 'test-results/speaking-board-answer.png' });
    await page.getByRole('button', { name: label }).click();
  }
  await expect(page.getByText('3 de 3 respostas cumpriram as metas.')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('A banca ficou satisfeita.')).toBeVisible();

  // The answers are in the history, each pointing to the talk.
  await page.goto('/speaking');
  await page.getByRole('link', { name: /E se a cidade for pequena\?/ }).click();
  await expect(page.getByText('Resposta à pergunta da banca:')).toBeVisible();
  await page.getByRole('link', { name: 'Ver a fala original' }).click();
  await expect(page).toHaveURL(talkUrl);
});

test('the path has three levels and a library of structure methods', async ({ page }) => {
  await page.goto('/speaking');
  await expect(page.getByText('Nível 2 · Clareza e firmeza')).toBeVisible();
  await expect(page.getByText('Nível 3 · Argumentar e persuadir')).toBeVisible();
  await expect(page.getByText('Perguntas e improviso')).toBeVisible();
  await page.getByRole('button', { name: 'Métodos' }).click();
  await expect(page.getByRole('heading', { name: 'Sequência de Monroe' })).toBeVisible();
  await expect(page.getByText('Unidade 13').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/speaking-methods.png' });
});
