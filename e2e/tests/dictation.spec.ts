import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { login, newNote, waitForNoteSave } from './helpers';

/**
 * Chromium's fake microphone plays this file in a loop: 2.5 s of a voice-like
 * tone, then 2 s of silence — one segment per loop. Speech recognition itself
 * (Workers AI) is not reachable in tests, so /transcriptions is answered here;
 * the API side is covered by apps/api/test/transcription.test.ts.
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
  for (let i = 0; i < samples; i++) {
    const voiced = i < rate * 2.5;
    const v = voiced ? 0.3 * Math.sin((2 * Math.PI * 180 * i) / rate) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / rate)) : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'fake-speech.wav');
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

test('dictates into a note: records, sends WAV segments and writes the text at the cursor', async ({ page }) => {
  const sent: { audio: string; prompt?: string }[] = [];
  const replies = ['A mais-valia é o trabalho não pago.', 'Ela sustenta o lucro.'];
  await page.route('**/api/v1/transcriptions', async (route) => {
    sent.push(route.request().postDataJSON());
    const text = replies[sent.length - 1] ?? 'Mais um trecho.';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { text, durationSeconds: 3 } }) });
  });

  const id = await newNote(page, 'Ditado E2E', 'Resumo do capítulo:');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');

  await page.getByRole('button', { name: 'Ditar: gravar e transcrever' }).click();
  await expect(page.getByText(/Gravando \d:\d\d/)).toBeVisible();  await expect(page.locator('.ProseMirror')).toContainText('Resumo do capítulo: A mais-valia é o trabalho não pago.', { timeout: 20_000 });
  await expect(page.locator('.ProseMirror')).toContainText('não pago. Ela sustenta o lucro.', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(page.getByText(/Gravando/)).toBeHidden({ timeout: 20_000 });

  // Segments are 16 kHz WAV, and carry the text written before them as context.
  expect(sent[0]!.audio.startsWith('UklGR')).toBe(true);
  expect(sent[0]!.prompt).toBe('Resumo do capítulo:');
  expect(sent[1]!.prompt).toContain('A mais-valia é o trabalho não pago.');
  await waitForNoteSave(page, id, 'Ela sustenta o lucro.');
});

test('keeps the audio when transcription fails and sends it again on retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/transcriptions', async (route) => {
    if (fail) {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'rate_limited', message: 'A cota diária gratuita de transcrição acabou.', requestId: 'x' } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { text: 'Recuperado.', durationSeconds: 3 } }) });
  });

  await newNote(page, 'Ditado com falha E2E', 'Início.');
  await page.getByRole('button', { name: 'Ditar: gravar e transcrever' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'A cota diária gratuita de transcrição acabou.' })).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('.text-danger', { hasText: 'A cota diária gratuita' })).toBeVisible();
  await page.getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Descartar áudio' })).toBeVisible();

  fail = false;
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Início. Recuperado.', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeHidden();
});
