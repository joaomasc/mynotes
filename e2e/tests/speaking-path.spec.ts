import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * The speaking path end to end: the hub, a lesson with concept, multiple
 * choice and a talk with goals, and a lesson with breathing and reading
 * aloud. The fake microphone plays a voice-like tone (2.5 s) and silence
 * (2 s) in a loop; /transcriptions answers with the words being practiced.
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
    phase += (2 * Math.PI * (180 + 40 * Math.sin(2 * Math.PI * 0.6 * t))) / rate;
    const v = t < 2.5 ? 0.3 * (0.6 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase)) : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'fake-speech-path.wav');
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

/** What the fake Whisper hears next. */
let saying = '';

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

test('follows the path: the hub, a lesson with a talk and goals, a lesson with breathing and reading', async ({ page }) => {
  await page.route('**/api/v1/transcriptions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: transcription(saying) }) }),
  );

  await page.goto('/speaking');
  await expect(page.getByText('Sessão de hoje')).toBeVisible();
  await expect(page.getByText('Nível 1 · Fundamentos')).toBeVisible();
  await page.screenshot({ path: 'test-results/speaking-hub.png' });

  // Lesson 1: concept, multiple choice, concept, a talk of at least 30 s.
  await page.getByRole('link', { name: 'Começar' }).click();
  await page.waitForURL(/\/speaking\/lesson\/u1-l1$/);
  await expect(page.getByRole('heading', { name: 'Quatro coisas numa fala' })).toBeVisible();
  await page.getByRole('button', { name: 'Entendi' }).click();
  await page.getByRole('radio', { name: 'Quantos “né” você disse por minuto' }).click();
  await expect(page.getByText('Isso!')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Entendi' }).click();

  saying = 'Meu nome é Ana. Estudo história. Quero falar melhor em público.';
  await page.getByRole('button', { name: 'Começar a gravar' }).click();
  await expect(page.getByText('Gravando')).toBeVisible();
  await page.waitForTimeout(36_000);
  await page.getByRole('button', { name: 'Terminar' }).click();
  await expect(page.getByText('Metas cumpridas!')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Lição: concluída!' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^\+\d+$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/speaking-lesson-done.png' });

  // Lesson u2-l1: breathing (skipped), multiple choice, reading aloud.
  await page.goto('/speaking/lesson/u2-l1');
  await page.getByRole('button', { name: 'Entendi' }).click();
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: 'Pular' }).click();
  await page.getByRole('radio', { name: /Falta de ar/ }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  saying = 'Quem respira bem antes de falar chega ao fim da frase com a mesma força com que começou.';
  await page.getByRole('button', { name: 'Gravar a leitura' }).click();
  await page.waitForTimeout(6_000);
  await page.getByRole('button', { name: 'Terminar' }).click();
  await expect(page.getByText('100% das palavras reconhecidas')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'test-results/speaking-reading.png' });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: /concluída!|Feito!|Quase lá/ })).toBeVisible({ timeout: 20_000 });

  // Back on the hub: the streak started and the first lesson is checked.
  await page.goto('/speaking');
  await expect(page.getByText('recorde 1')).toBeVisible();
  await expect(page.getByRole('link', { name: /Como o professor ouve você/ }).getByLabel('Concluída')).toBeVisible();
  await page.goto('/speaking/progress');
  await expect(page.getByText('Habilidades')).toBeVisible();
  await page.screenshot({ path: 'test-results/speaking-progress.png', fullPage: true });
});
