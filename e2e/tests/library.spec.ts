import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { login, samplePdf } from './helpers';

test.beforeEach(async ({ page }) => login(page));

test('uploads a PDF with progress and reads it in the app', async ({ page }) => {
  await page.goto('/library');
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
  await page.goto('/library');
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
