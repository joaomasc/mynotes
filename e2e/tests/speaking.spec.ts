import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import { login } from './helpers';

/**
 * Speaking practice end to end: Chromium's fake microphone plays a voice-like
 * tone whose pitch moves (2.5 s) and then silence (2 s), in a loop. The
 * browser analyzes it for real (worker, pitch, pauses); speech recognition and
 * the model's evaluation are not reachable in tests, so they are answered here
 * (the API side is covered by apps/api/test/speech.test.ts).
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
    const voiced = t < 2.5;
    // Pitch glides between 130 and 230 Hz: a lively, not monotone, “voice”.
    phase += (2 * Math.PI * (180 + 50 * Math.sin(2 * Math.PI * 0.8 * t))) / rate;
    const v = voiced ? 0.3 * (0.6 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase)) : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'fake-speech-pitch.wav');
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

const SENTENCES = [
  'Hoje vou falar, né, sobre o mercantilismo.',
  'A ideia central era acumular ouro e prata.',
  'Eu acho que Portugal é o melhor exemplo.',
  'Por isso o comércio colonial era tão importante.',
];

/** Whisper's answer for one segment: the words spread over the 2.5 s of “speech”. */
function transcription(text: string) {
  const words = text.split(' ');
  const step = 2.3 / words.length;
  return {
    text,
    durationSeconds: 2.9,
    segments: [{ start: 0.4, end: 2.8, text, avgLogprob: -0.3 }],
    words: words.map((w, i) => ({ text: w, start: 0.4 + i * step, end: 0.4 + (i + 0.9) * step })),
  };
}

async function aiStatus(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        enabled: true,
        configured: true,
        model: 'gpt-6-luna',
        dailyBudgetUsd: 0.5,
        spentTodayUsd: 0,
        limits: { messageChars: 4000, toolCallsPerTurn: 8, requestsPerMinute: 6 },
        pricing: { inputPerMTok: 0.1, cachedInputPerMTok: 0.01, outputPerMTok: 0.5 },
        webSearch: { enabled: true, maxPerTurn: 5, pricePerCallUsd: 0.01 },
        usage: [],
      },
    }),
  });
}

test('records a talk, measures the voice in the browser and shows the evaluated result', async ({ page }) => {
  const sent: { prompt?: string; detail?: string }[] = [];
  await page.route('**/api/v1/transcriptions', async (route) => {
    sent.push(route.request().postDataJSON());
    const text = SENTENCES[(sent.length - 1) % SENTENCES.length]!;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: transcription(text) }) });
  });
  await page.route('**/api/v1/ai/status', aiStatus);
  // The evaluation: the stored talk from the real API, plus a scripted model answer.
  let evaluations = 0;
  await page.route('**/api/v1/speech/attempts/*/evaluate', async (route) => {
    evaluations++;
    const url = route.request().url().replace(/\/evaluate$/, '');
    const stored = await (await route.fetch({ url, method: 'GET', postData: undefined })).json();
    const now = new Date().toISOString();
    const criterion = (id: string, state: string, value: string, original: string | null = null, rewrite: string | null = null) => ({
      id,
      state,
      value,
      reference: '',
      source: 'textAi',
      original,
      rewrite,
    });
    stored.data.evaluated = true;
    stored.data.score = 72;
    stored.data.evaluation = {
      criteria: [
        criterion('opening', 'good', 'Em 0:00 anuncia o tema.'),
        criterion('centralIdea', 'good', 'Acumular metais preciosos.'),
        criterion('development', 'attention', 'Um só exemplo.'),
        criterion('transitions', 'good', '“Por isso” liga as ideias.'),
        criterion('conclusion', 'improve', 'Termina sem retomar a ideia.', 'Por isso o comércio colonial era tão importante.', 'Ou seja: riqueza era metal acumulado.'),
        criterion('correctness', 'na', 'Sem notas para comparar.'),
        criterion('precision', 'good', 'Termos claros.'),
      ],
      improvements: [
        { title: 'Feche retomando a ideia central', detail: 'Repita a tese em uma frase.', original: null, rewrite: 'Ou seja: riqueza era metal acumulado.' },
        { title: 'Troque o “né” por uma pausa', detail: 'Silêncio passa mais segurança.', original: 'Hoje vou falar, né, sobre', rewrite: 'Hoje vou falar sobre' },
      ],
      exercise: 'Explique o mercantilismo em 1 minuto, terminando com a ideia central.',
      summary: 'Fala clara e bem ordenada; falta fechar com a ideia central.',
      model: 'gpt-6-luna',
      evaluatedAt: now,
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  await page.goto('/speaking');
  await page.getByRole('radio', { name: 'Fala livre' }).click();
  await page.getByLabel('Tema').fill('Mercantilismo em 1 minuto');
  await page.getByRole('button', { name: 'Começar a gravar' }).click();
  await expect(page.getByText('Gravando')).toBeVisible();

  // Live counters follow the transcribed segments (one per 4.5 s loop).
  await expect(page.getByRole('definition').nth(0)).not.toHaveText('0', { timeout: 20_000 });
  // Longer than 20 s of speech: shorter talks are not judged on rates per minute.
  await page.waitForTimeout(24_000);
  await page.screenshot({ path: 'test-results/speaking-recording.png', fullPage: true });
  await page.getByRole('button', { name: 'Terminar' }).click();

  await page.waitForURL(/\/speaking\/attempts\/[0-9a-f-]{36}$/, { timeout: 40_000 });
  await expect(page.getByText('Fala clara e bem ordenada')).toBeVisible({ timeout: 20_000 });
  expect(evaluations).toBe(1);

  // Whisper got the hesitation hint and was asked for word timings.
  expect(sent[0]!.detail).toBe('words');
  expect(sent[0]!.prompt).toContain('né');
  expect(sent[1]!.prompt).toContain('mercantilismo');

  // Measured in the browser: fillers and hedges from the text, pitch from the audio.
  await expect(page.getByText('Vícios de linguagem')).toBeVisible();
  await expect(page.getByText(/“né” \d+×/)).toBeVisible();
  await expect(page.getByText(/“eu acho que” \d+×/)).toBeVisible();
  await expect(page.getByText(/variação do tom de 0,\d\d/)).toBeVisible();
  await expect(page.getByText('Ou seja: riqueza era metal acumulado.').first()).toBeVisible();
  await expect(page.getByText('Tom da voz')).toBeVisible();
  await expect(page.getByText('A ideia central era acumular ouro e prata.', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/speaking-result.png', fullPage: true });
  await page.getByText('Vícios de linguagem').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/speaking-result-criteria.png' });
  await page.getByText('Tom da voz').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/speaking-result-chart.png' });

  // The talk is in the history.
  await page.goto('/speaking');
  await expect(page.getByRole('link', { name: /Mercantilismo em 1 minuto/ })).toBeVisible();
});
