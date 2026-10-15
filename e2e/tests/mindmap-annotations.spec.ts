import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.beforeEach(async ({ page }) => login(page));

test('a book annotation filed under a subtopic shows in the mind map, tied to its book', async ({ page }) => {
  // Topic with a subtopic.
  await page.getByRole('complementary', { name: 'Barra lateral' }).getByRole('button', { name: 'Novo assunto' }).click();
  await page.getByLabel('Título').fill('Marx M');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Marx M');
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Novo subassunto' }).click();
  await page.getByLabel('Título').fill('Capital M');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Capital M');

  // A book filed elsewhere (no topic), with an annotation on p. 12.
  await page.goto('/library');
  await page.getByRole('button', { name: 'Novo livro' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Brumário M');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  await page.getByLabel('Página para anotar').fill('12');
  await page.getByRole('button', { name: 'Anotar a p. 12' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toBeFocused();
  await page.keyboard.type('Bonapartismo como farsa.');
  await page.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('Bonapartismo'));

  // Opened as a note and moved to the subtopic.
  await page.getByRole('link', { name: 'Abrir como nota' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Mover para assunto…' }).click();
  const select = page.getByRole('dialog').getByLabel('Assunto');
  await select.selectOption((await select.locator('option', { hasText: 'Capital M' }).getAttribute('value'))!);
  await page.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The map of the parent topic shows the annotation (named after the book) and the book under it.
  await page.goto('/search?type=topic&q=Marx%20M');
  await page.getByRole('main').getByRole('link', { name: /Marx M/ }).first().click();
  await page.getByRole('main').getByRole('link', { name: 'Mapa' }).click();
  const flow = page.locator('.react-flow');
  await expect(flow.getByText('Capital M')).toBeVisible({ timeout: 20_000 });
  await expect(flow.getByText('Brumário M, p. 12')).toBeVisible();
  await expect(flow.getByText('Brumário M', { exact: true })).toBeVisible();
  // Double click opens an item (even when the selection panel opens over it).
  await flow.getByText('Brumário M', { exact: true }).dblclick();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Brumário M');
  await page.goBack();
  await page.locator('.react-flow').getByText('Capital M', { exact: true }).dblclick();
  await page.waitForURL(/\/topics\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Capital M');
});
