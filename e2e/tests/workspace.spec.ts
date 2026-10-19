import { expect, test, type Page } from '@playwright/test';
import { login, newNote, waitForNoteSave } from './helpers';

test.beforeEach(async ({ page }) => login(page));

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Abas' });
const panes = (page: Page) => page.getByRole('region', { name: 'Painel' });

test('tabs, split panes and the browser back button (Obsidian-like workspace)', async ({ page }) => {
  const first = await newNote(page, 'Primeira W', 'Texto da primeira.');
  await newNote(page, 'Segunda W', 'Texto da segunda.');
  // Opening a page by its link focuses (or opens) a tab for it.
  await page.goto(`/notes/${first}`);
  await expect(page.locator('.ProseMirror')).toContainText('Texto da primeira.');
  await expect(tabs(page).getByRole('tab', { name: /Primeira W/ })).toHaveAttribute('aria-selected', 'true');

  // Split: the same note beside, then another page in the new pane.
  await page.getByRole('button', { name: 'Dividir à direita' }).first().click();
  await expect(panes(page)).toHaveCount(2);
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Notas' }).click();
  await expect(panes(page).nth(1)).toContainText('Segunda W');
  await expect(panes(page).nth(0).locator('.ProseMirror')).toContainText('Texto da primeira.');
  // Browser back goes back inside the active tab.
  await page.goBack();
  await expect(panes(page).nth(1).locator('.ProseMirror')).toContainText('Texto da primeira.');

  // Ctrl+click opens in a new tab; the layout survives a reload.
  await page.goto('/notes');
  await page.getByRole('main').getByRole('link', { name: /Segunda W/ }).first().click({ modifiers: ['Control'] });
  await expect(tabs(page).last().getByRole('tab', { name: /Segunda W/ })).toBeVisible();
  await page.reload();
  await expect(panes(page)).toHaveCount(2);
  expect(page.url()).toContain('/notes');
});

test('quick switcher, command palette, reading mode and templates', async ({ page }) => {
  const id = await newNote(page, 'Leitura W', 'Um texto qualquer.');
  // Quick switcher: fuzzy title search.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Control+o');
  await page.keyboard.type('ltraw');
  await page.getByRole('option', { name: /Leitura W/ }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Um texto qualquer.');

  // Reading mode (Ctrl+E) is not an edit: nothing is saved.
  let saves = 0;
  page.on('request', (r) => r.method() === 'PATCH' && r.url().endsWith(`/notes/${id}`) && saves++);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByText('Modo de leitura')).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  await page.keyboard.press('Control+e');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  await page.waitForTimeout(2000);
  expect(saves).toBe(0);

  // Command palette lists commands with their shortcuts.
  await page.keyboard.press('Control+p');
  await page.keyboard.type('dividir');
  await expect(page.getByRole('option', { name: /Dividir à direita/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Without a templates topic, the template list explains how to set it up.
  await page.locator('.ProseMirror').click();
  await page.getByRole('button', { name: 'Inserir modelo' }).click();
  await expect(page.getByRole('dialog')).toContainText('Nenhum assunto de modelos escolhido');
});

test('the same note in two panes: edits in one show in the other and none is lost', async ({ page }) => {
  const id = await newNote(page, 'Dois painéis W', 'Começo.');
  await page.getByRole('button', { name: 'Dividir à direita' }).first().click();
  const left = panes(page).nth(0).locator('.ProseMirror');
  const right = panes(page).nth(1).locator('.ProseMirror');
  await expect(right).toContainText('Começo.');

  await left.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Escrito à esquerda.');
  await expect(right).toContainText('Escrito à esquerda.', { timeout: 10_000 });

  await right.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' E à direita.');
  await waitForNoteSave(page, id, 'E à direita.');
  await expect(left).toContainText('E à direita.', { timeout: 10_000 });
  await page.reload();
  await expect(panes(page).nth(0).locator('.ProseMirror')).toContainText('Começo. Escrito à esquerda. E à direita.');
});
