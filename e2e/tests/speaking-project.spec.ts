import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { login } from './helpers';

/**
 * Stage 4 end to end: your own speech from the first step to the final
 * presentation — written steps with the coach's comment, two rehearsals with
 * the recording kept (stored for real in the local R2), the comparison, the
 * full evaluation and the script saved as a note. The model's answers are
 * scripted here.
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
    phase += (2 * Math.PI * (160 + 45 * Math.sin(2 * Math.PI * 0.5 * t))) / rate;
    const v = t < 2.5 ? 0.3 * (0.6 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase)) : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'fake-speech-project.wav');
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

const SAY = 'Às seis da manhã mil pessoas esperam o ônibus. Uma ciclovia resolve. Assine a petição.';

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

async function stored(route: Route, patch: (data: Record<string, unknown>) => void) {
  const url = route.request().url().replace(/\/(evaluate|full-evaluation)$/, '');
  const body = await (await route.fetch({ url, method: 'GET', postData: undefined })).json();
  patch(body.data);
  return json(route, body.data);
}

async function mockModel(page: Page) {
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
  await page.route('**/api/v1/speech/feedback', (route) => json(route, { verdict: 'good', feedback: 'Público e objetivo claros.', suggestion: 'Moradores que vão de ônibus.' }));
  await page.route('**/api/v1/speech/attempts/*/evaluate', (route) =>
    stored(route, (a) => {
      a.evaluated = true;
      a.score = 70;
      a.evaluation = {
        criteria: [],
        improvements: [{ title: 'Feche com o pedido de ação', detail: 'Diga o que fazer, quando e onde.', original: null, rewrite: 'Venha à audiência de terça, às 19h.' }],
        exercise: 'Treine só a conclusão três vezes.',
        summary: 'Abertura forte; o pedido de ação ficou vago.',
        model: 'gpt-6-luna',
        evaluatedAt: new Date().toISOString(),
      };
    }),
  );
  await page.route('**/api/v1/speech/attempts/*/full-evaluation', (route) =>
    stored(route, (a) => {
      a.fullEvaluation = {
        criteria: [{ id: 'confidence', state: 'good', value: 'Firme do início ao fim.', reference: '', source: 'audioAi', original: null, rewrite: null }],
        remarks: ['Respire antes da última frase.'],
        summary: 'Voz segura e natural.',
        heardSeconds: 8,
        model: 'gpt-audio',
        evaluatedAt: new Date().toISOString(),
      };
    }),
  );
}

async function record(page: Page, start: string) {
  await page.getByRole('button', { name: start }).click();
  await expect(page.getByText('Gravando')).toBeVisible();
  await page.waitForTimeout(7_000);
  await page.getByRole('button', { name: 'Terminar' }).click();
}

test('builds a speech step by step, rehearses twice, compares and presents', async ({ page }) => {
  // Three recordings and their evaluations.
  test.setTimeout(180_000);
  await mockModel(page);
  await page.goto('/speaking');
  await page.getByRole('button', { name: 'Novo discurso' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Discurso político/ }).click();
  await dialog.getByLabel('Título').fill('Ciclovia na avenida');
  await dialog.getByRole('button', { name: 'Começar' }).click();
  await page.waitForURL(/\/speaking\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  // 1–6: written steps (the coach comments on the first one).
  await page.getByLabel('Quem vai ouvir').fill('Moradores do bairro');
  await page.getByRole('button', { name: 'Pedir o comentário do professor' }).click();
  await expect(page.getByText('Público e objetivo claros.')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir a etapa' }).click();
  await page.getByLabel('Ideia central (uma frase)').fill('A ciclovia salva vidas.');
  await page.getByRole('button', { name: 'Concluir a etapa' }).click();
  await page.getByLabel('Método').selectOption('monroe');
  await page.getByRole('button', { name: 'Acrescentar ponto' }).click();
  await page.getByLabel('Ponto 1').fill('Segurança');
  await page.getByRole('button', { name: 'Concluir a etapa' }).click();
  await page.getByLabel('Argumento').fill('Menos acidentes com ciclistas.');
  await page.getByRole('button', { name: 'Concluir a etapa' }).click();
  await page.getByLabel('A história (situação, conflito, virada, lição)').fill('Meu vizinho foi atropelado na avenida.');
  await page.getByRole('button', { name: 'Concluir a etapa' }).click();
  await page.getByLabel('Conclusão').fill('Pedalar não pode custar a vida.');
  await page.getByRole('button', { name: 'Concluir a etapa' }).click();

  // 7: first rehearsal, recorded with the audio kept and evaluated.
  await expect(page.getByRole('heading', { name: 'Primeiro ensaio' })).toBeVisible();
  await record(page, 'Começar o ensaio');
  // 8: review shows the coach's points.
  await expect(page.getByText('Feche com o pedido de ação')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: 'Pronto para o segundo ensaio' }).click();
  // 9: second rehearsal and the comparison.
  await record(page, 'Começar o ensaio');
  await expect(page.getByRole('heading', { name: 'Banca' })).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /^9 Segundo ensaio|Segundo ensaio/ }).first().click();
  await page.getByRole('link', { name: 'Comparar com o primeiro ensaio' }).click();
  await expect(page.getByRole('heading', { name: 'Comparar falas' })).toBeVisible();
  await expect(page.getByText('Antes')).toBeVisible();
  await page.screenshot({ path: 'test-results/speaking-compare.png', fullPage: true });
  await page.goBack();

  // 10: the board, then 11: the final presentation with the full evaluation.
  await page.getByRole('button', { name: /Banca/ }).first().click();
  await page.getByRole('button', { name: 'Concluí a banca' }).click();
  await record(page, 'Apresentar');
  await expect(page.getByText('Discurso apresentado!')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('Avaliação completa: Voz segura e natural.')).toBeVisible();
  await page.screenshot({ path: 'test-results/speaking-project-final.png', fullPage: true });

  // The script becomes a note.
  await page.getByRole('button', { name: 'Salvar como nota' }).click();
  await expect(page.getByText('Roteiro salvo como nota.')).toBeVisible();
  await page.getByRole('button', { name: 'Ações do discurso' }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: 'Abrir a nota do roteiro' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('A ciclovia salva vidas.');

  // The final talk kept its recording: it plays on the result page. (Restored workspace
  // tabs stay mounted but hidden, so only visible elements count.)
  await page.goto(projectUrl);
  await page.getByRole('link', { name: /Ver o resultado/ }).filter({ visible: true }).first().click();
  await expect(page.locator('audio').filter({ visible: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Toque numa palavra para ouvir aquele momento.')).toBeVisible();
});
