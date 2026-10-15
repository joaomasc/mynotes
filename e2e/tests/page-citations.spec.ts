import { expect, test } from '@playwright/test';
import { login, newNote, samplePdf, waitForNoteSave } from './helpers';

test.beforeEach(async ({ page }) => login(page));

test('a note cites any page of a book, without an annotation, and the book shows it', async ({ page }) => {
  // A book with a 3-page PDF and no annotations.
  await page.goto('/library');
  await page.getByRole('button', { name: 'Novo livro' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Tratado P');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  const bookUrl = page.url();
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({
    name: 'tratado.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf([['Um'], ['Dois: o argumento'], ['Tres']]),
  });
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 30_000 });

  // A chapter summary note citing p. 2: "/pagina." → pick the book → type the page.
  const id = await newNote(page, 'Resumo P', 'O argumento central está em');
  await page.keyboard.type(' /pagina.trat');
  await page.getByRole('option', { name: /Escolher a página/ }).click();
  await expect(page.locator('.ProseMirror')).toContainText('/pagina.Tratado P, p.');
  await page.keyboard.type('2');
  const option = page.getByRole('option', { name: /Tratado P, p\. 2.*Página do livro/ });
  await expect(option).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror')).toContainText('Tratado P, p. 2');
  await expect(page.locator('.ProseMirror')).not.toContainText('/pagina.');
  await waitForNoteSave(page, id, '/p/2');

  // The book marks the page and lists the note there and under "Sobre".
  await page.goto(bookUrl);
  await expect(page.getByRole('img', { name: 'Página 2, 1 marcação(ões)' })).toBeAttached({ timeout: 30_000 });
  await page.getByLabel('Ir para a página').fill('2');
  await page.getByLabel('Ir para a página').press('Enter');
  await expect(page.getByText('Uma nota cita a p. 2')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Resumo P' })).toBeVisible();
  await page.getByRole('radio', { name: 'Sobre' }).click();
  await page.getByRole('link', { name: 'p. 2', exact: true }).click();
  await expect(page.getByText('Uma nota cita a p. 2')).toBeVisible({ timeout: 15_000 });

  // Clicking the citation in the note opens the book on that page.
  await page.goto(`/notes/${id}`);
  await page.locator('.ProseMirror').getByText('Tratado P, p. 2').click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}/);
  await expect(page.getByText('Uma nota cita a p. 2')).toBeVisible({ timeout: 15_000 });
});

test('a book with a PDF reopens after the app reloads (file contents are not restored from disk)', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('button', { name: 'Novo livro' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Recarregar P');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: 'r.pdf', mimeType: 'application/pdf', buffer: samplePdf([['Um'], ['Dois']]) });
  await expect(page.locator('.pdf-page')).toHaveCount(2, { timeout: 30_000 });
  await page.reload();
  await expect(page.locator('.pdf-page')).toHaveCount(2, { timeout: 30_000 });
  // The cache is written every 2 s: give it time to save the file query, then reload again.
  await page.waitForTimeout(3000);
  await page.reload();
  await expect(page.locator('.pdf-page')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByText('Algo deu errado')).toHaveCount(0);
});
