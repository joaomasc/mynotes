import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { login, samplePdf } from './helpers';

test.beforeEach(async ({ page }) => login(page));

test('uploads a PDF with progress and reads it in the app', async ({ page }) => {
  await page.goto('/library?view=docs');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'macroeconomia-e2e.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf([['Capitulo 1', 'Inflacao e juros'], ['Capitulo 2', 'Cambio']]),
  });
  await page.getByRole('button', { name: /Enviar \(1\)/ }).click();
  await expect(page.getByLabel('Enviado')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Fechar' }).first().click();
  await page.getByRole('main').getByText('macroeconomia-e2e').click();
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await expect(page.locator('.textLayer').first()).toContainText('Inflacao');
});

test('rejects files whose content does not match the type', async ({ page }) => {
  await page.goto('/library?view=docs');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'falso.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>nope</html>') });
  await page.getByRole('button', { name: /Enviar \(1\)/ }).click();
  await expect(page.getByText('O conteúdo do arquivo não corresponde ao tipo informado')).toBeVisible({ timeout: 30_000 });
});

test('exports a backup and imports it again without duplicating', async ({ page }) => {
  await page.goto('/notes');
  const before = await page.locator('main a[href*="/notes/"]').count();
  await page.goto('/settings#backup');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar backup' }).click();
  const file = await (await download).path();
  expect(readFileSync(file).subarray(0, 2).toString()).toBe('PK');

  await page.locator('input[type=file][accept*="zip"]').setInputFiles(file);
  await expect(page.getByText(/registros ·/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(page.getByText('Importação concluída').first()).toBeVisible({ timeout: 60_000 });
  await page.goto('/notes');
  await expect(page.locator('main a[href*="/notes/"]')).toHaveCount(before);
});

test('uploads a file larger than one request (sent in parts)', async ({ page }) => {
  test.setTimeout(180_000);
  const parts: number[] = [];
  page.on('request', (r) => {
    const m = /\/uploads\/parts\/(\d+)/.exec(r.url());
    if (m && r.method() === 'PUT') parts.push(Number(m[1]));
  });
  // 55 MB: two parts (50 MB + 5 MB). Starts like a real PDF so the type check passes.
  const big = Buffer.concat([samplePdf([['Arquivo grande']]), Buffer.alloc(55 * 1024 * 1024, 0x20)]);
  await page.goto('/library?view=docs');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  const path = test.info().outputPath('grande-e2e.pdf');
  writeFileSync(path, big);
  await page.locator('input[type=file]').setInputFiles(path);
  await page.getByRole('button', { name: /Enviar \(1\)/ }).click();
  await expect(page.getByLabel('Enviado')).toBeVisible({ timeout: 150_000 });
  expect(parts).toEqual([1, 2]);
});

test('opens a large PDF book reading only the parts it needs', async ({ page }) => {
  test.setTimeout(180_000);
  const pdf = samplePdf([['Capitulo 1', 'Abertura'], ['Capitulo 2', 'Meio'], ['Capitulo 3', 'Fim do livro grande']], 30 * 1024 * 1024);
  const path = test.info().outputPath('livro-grande.pdf');
  writeFileSync(path, pdf);

  await page.goto('/library');
  await page.getByRole('button', { name: 'Novo livro' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Livro grande E2E');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles(path);
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 60_000 });

  // Measure what the viewer downloads from now on (reload: a fresh viewer).
  let downloaded = 0;
  const ranges: string[] = [];
  page.on('response', async (r) => {
    if (!r.url().includes('/content') || r.request().method() !== 'GET') return;
    ranges.push(r.request().headers()['range'] ?? 'inteiro');
    downloaded += Number(r.headers()['content-length'] ?? 0);
  });
  await page.reload();
  await page.getByLabel('Ir para a página').fill('3');
  await page.getByLabel('Ir para a página').press('Enter');
  await expect(page.locator('.textLayer').nth(2)).toContainText('Fim do livro grande', { timeout: 60_000 });
  expect(ranges.length).toBeGreaterThan(0);
  expect(ranges).not.toContain('inteiro');
  expect(downloaded).toBeLessThan(pdf.byteLength / 5);
});
