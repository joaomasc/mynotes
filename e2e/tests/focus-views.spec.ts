import { expect, test, type Page } from '@playwright/test';
import { login, samplePdf } from './helpers';

test.beforeEach(async ({ page }) => login(page));

const panes = (page: Page) => page.getByRole('region', { name: 'Painel' });

async function newTopic(page: Page, title: string, parent?: string) {
  if (parent) {
    await page.goto(`/search?type=topic&q=${encodeURIComponent(parent)}`);
    await page.getByRole('main').getByRole('link', { name: parent }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(parent);
    await page.getByRole('button', { name: 'Mais ações' }).click();
    await page.getByRole('menuitem', { name: 'Novo subassunto' }).click();
  } else {
    await page.getByRole('complementary', { name: 'Barra lateral' }).getByRole('button', { name: 'Novo assunto' }).click();
  }
  await page.getByLabel('Título').fill(title);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
}

test('mind map: a click lights the chain of connections and "Abrir" keeps the map on the left', async ({ page }) => {
  await newTopic(page, 'Raiz F');
  await newTopic(page, 'Filho F', 'Raiz F');
  await newTopic(page, 'Neto F', 'Filho F');
  await newTopic(page, 'Irmão F', 'Raiz F');

  await page.getByRole('main').getByRole('link', { name: 'Raiz F' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Raiz F');
  await page.getByRole('main').getByRole('link', { name: 'Mapa' }).click();
  const flow = page.locator('.react-flow');
  const node = (title: string) => flow.locator('.react-flow__node').filter({ hasText: title }).locator(':scope > div');
  await expect(node('Neto F')).toBeVisible({ timeout: 20_000 });

  // Neto → Filho → Raiz light up (path to the root); the other branch fades.
  await flow.getByText('Neto F', { exact: true }).click();
  await expect(node('Irmão F')).toHaveClass(/opacity-30/);
  await expect(node('Raiz F')).not.toHaveClass(/opacity-30/);
  await expect(node('Filho F')).not.toHaveClass(/opacity-30/);
  // Clicking the background clears it.
  await flow.locator('.react-flow__pane').click({ position: { x: 20, y: 300 } });
  await expect(node('Irmão F')).not.toHaveClass(/opacity-30/);

  // "Abrir ao lado": the item opens in a pane on the right, the map stays.
  await flow.getByText('Neto F', { exact: true }).click();
  await page.getByRole('complementary', { name: 'Item selecionado' }).getByRole('button', { name: /Abrir ao lado/ }).click();
  await expect(panes(page)).toHaveCount(2);
  await expect(panes(page).nth(1).getByRole('heading', { level: 1 })).toContainText('Neto F');
  await expect(panes(page).nth(0).locator('.react-flow')).toBeVisible();
});

test('maximized PDF with the annotations beside it, following the page being read', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('button', { name: 'Novo livro' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Livro F');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({
    name: 'livro-f.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf([['Um'], ['Dois'], ['Tres']]),
  });
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 30_000 });

  await page.getByRole('button', { name: 'Maximizar PDF' }).click();
  await expect(panes(page)).toHaveCount(2);
  const reader = panes(page).nth(0);
  const side = panes(page).nth(1);
  // The PDF alone on the left; the annotations only on the right.
  await expect(reader.getByRole('button', { name: /Anotar a p\./ })).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'Anotar a p. 1' })).toBeVisible();

  // The side panel follows the page shown in the PDF.
  await reader.getByLabel('Ir para a página').fill('3');
  await reader.getByLabel('Ir para a página').press('Enter');
  await expect(side.getByRole('button', { name: 'Anotar a p. 3' })).toBeVisible({ timeout: 15_000 });
  await side.getByRole('button', { name: 'Anotar a p. 3' }).click();
  await expect(side.getByRole('textbox', { name: 'Conteúdo da nota' })).toBeFocused();
  await page.keyboard.type('Nota ao lado do PDF');
  await page.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('Nota ao lado'));

  // Restoring brings the annotations back next to the PDF and closes the pane.
  await reader.getByRole('button', { name: 'Restaurar' }).click();
  await expect(panes(page)).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /Anotações \(1\)/ })).toBeVisible();
});
