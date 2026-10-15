import { expect, test, type Page } from '@playwright/test';
import { login, samplePdf } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => login(page));

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Barra lateral' });

/** Suggestions match what was typed (Enter would otherwise wait for them). */
const settled = (page: Page) => expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false');

/** Waits until the server confirmed a save of note `id` containing `text`. */
async function saved(page: Page, text: string) {
  await page.waitForResponse(
    (r) => /\/notes\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes(text),
    { timeout: 30_000 },
  );
}

/** Opens a topic through global search (it may be collapsed deep in the tree). */
async function openTopic(page: Page, title: string) {
  await page.goto(`/search?type=topic&q=${encodeURIComponent(title)}`);
  await page.getByRole('main').getByRole('link', { name: new RegExp(title) }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
}

async function addInline(page: Page, button: string, titles: string[]) {
  await page.getByRole('button', { name: button }).click();
  const input = page.getByRole('textbox', { name: button });
  for (const t of titles) {
    await input.fill(t);
    await input.press('Enter');
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(t) })).toBeVisible();
  }
  await input.press('Escape');
}

test('hierarchy, "/" references (mouse and keyboard), rename-safe links, backlinks and tags', async ({ page }) => {
  // Notebook > subjects > subtopics, created inline.
  await sidebar(page).getByRole('button', { name: 'Novo assunto' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Economia K');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByText('Caderno')).toBeVisible();
  await addInline(page, 'Nova matéria', ['História econômica K', 'Macroeconomia K']);
  await page.getByRole('main').getByRole('link', { name: /História econômica K/ }).click();
  await expect(page.getByText('Matéria', { exact: true })).toBeVisible();
  await addInline(page, 'Novo subassunto', ['Mercantilismo K']);
  await page.getByRole('main').getByRole('link', { name: /Mercantilismo K/ }).click();
  await expect(page.getByRole('navigation', { name: 'Caminho' })).toContainText('História econômica K');

  // A note in Macroeconomia citing two topics and tagged.
  await openTopic(page, 'Macroeconomia K');
  await page.getByRole('button', { name: 'Nova nota' }).first().click();
  await page.getByLabel('Título da nota').fill('Juros e preços K');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ver /mercantilismo k');
  await page.getByRole('option', { name: /assunto\.Mercantilismo K/ }).click(); // mouse
  await page.keyboard.type('e /assunto.hist');
  await expect(page.getByRole('option', { name: /assunto\.História econômica K/ })).toBeVisible();
  await settled(page);
  await page.keyboard.press('Enter'); // keyboard
  await page.keyboard.type('#revisar');
  await expect(page.getByRole('option', { name: /#revisar/ })).toBeVisible();
  await settled(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('hoje.');
  await expect(page.locator('.reference-chip')).toHaveText(['/assunto.Mercantilismo K', '/assunto.História econômica K']);
  await saved(page, 'hoje.');
  const noteUrl = page.url();

  // Renaming the target keeps the reference; the topic lists the note as a backlink.
  await openTopic(page, 'Mercantilismo K');
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Mercantilismo europeu K');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('complementary', { name: 'Conexões do assunto' })).toContainText('Juros e preços K');
  await page.goto(noteUrl);
  await expect(page.locator('.reference-chip').first()).toHaveText('/assunto.Mercantilismo europeu K');
  await page.locator('.reference-chip').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mercantilismo europeu K');

  // Tags are reused through suggestions and searchable.
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Nova nota' }).click();
  await page.getByLabel('Título da nota').fill('Outra K');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Lembrar #rev');
  await expect(page.getByRole('option', { name: /#revisar.*1 nota/ })).toBeVisible();
  await settled(page);
  await page.keyboard.press('Enter');
  await saved(page, '#revisar');
  await page.goto('/search?tag=revisar');
  await expect(page.getByRole('main')).toContainText('Juros e preços K');
  await expect(page.getByRole('main')).toContainText('Outra K');
});

test('a book with PDF, page annotations and a review, kept across sessions', async ({ page, browser }) => {
  await page.goto('/library');
  await page.getByRole('button', { name: 'Novo livro' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('O Capital K');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  const bookUrl = page.url();

  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({
    name: 'capital-k.pdf',
    mimeType: 'application/pdf',
    buffer: samplePdf([['Capitulo 1', 'A mercadoria'], ['Capitulo 2', 'O dinheiro'], ['Capitulo 24', 'Acumulacao primitiva']]),
  });
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 30_000 });

  // Annotation on page 1, citing a topic.
  await page.getByRole('button', { name: 'Anotar a p. 1' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toBeFocused();
  await page.keyboard.type('A mercadoria e o valor, ver /mercantilismo europeu');
  await expect(page.getByRole('option', { name: /Mercantilismo europeu K/ })).toBeVisible();
  await settled(page);
  await page.keyboard.press('Enter');
  await saved(page, 'A mercadoria');

  // Navigate in the viewer and annotate page 3.
  await page.getByLabel('Ir para a página').fill('3');
  await page.getByLabel('Ir para a página').press('Enter');
  await page.getByRole('button', { name: 'Anotar a p. 3' }).click({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toBeFocused();
  await page.keyboard.type('Acumulação primitiva: crítica');
  await saved(page, 'Acumulação primitiva');

  // General review, independent from the annotations.
  await page.getByRole('radio', { name: 'Minha resenha' }).click();
  await page.getByRole('button', { name: 'Escrever minha resenha' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toBeFocused();
  await page.keyboard.type('Síntese do livro K');
  await saved(page, 'Síntese do livro K');

  // Another device (no local drafts) finds everything on the server.
  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone);
  await phone.goto(bookUrl);
  await expect(phone.getByRole('radio', { name: /Anotações \(2\)/ })).toBeVisible({ timeout: 30_000 });
  // The annotation items (the viewer may also offer a "p. 3" filter once it reopens on the saved page).
  await expect(phone.getByRole('button', { name: /^p\. 1 / })).toBeVisible();
  await expect(phone.getByRole('button', { name: /^p\. 3 / })).toBeVisible();
  await phone.getByRole('radio', { name: 'Minha resenha' }).click();
  await expect(phone.locator('.ProseMirror')).toContainText('Síntese do livro K');
  await other.close();

  // The annotation shows up in the topic it references.
  await openTopic(page, 'Mercantilismo europeu K');
  await expect(page.getByRole('main')).toContainText('O Capital K, p. 1');
  // Search finds books, annotations and topics.
  await page.goto('/search?q=acumulacao');
  await expect(page.getByRole('main')).toContainText('O Capital K, p. 3');
  await page.goto('/search?q=capital');
  await expect(page.getByRole('main').getByText('O Capital K', { exact: true })).toBeVisible();
});

test('graph and mind map are generated from the data; moving nodes keeps the hierarchy', async ({ page }) => {
  await openTopic(page, 'Mercantilismo europeu K');
  await page.getByRole('main').getByRole('link', { name: 'Grafo' }).click();
  await expect(page.locator('.react-flow').getByText('Mercantilismo europeu K')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.react-flow').getByText('Juros e preços K')).toBeVisible();

  await openTopic(page, 'Economia K');
  await page.getByRole('main').getByRole('link', { name: 'Mapa' }).click();
  const flow = page.locator('.react-flow');
  await expect(flow.getByText('História econômica K')).toBeVisible({ timeout: 20_000 });
  await expect(flow.getByText('Macroeconomia K')).toBeVisible();
  await expect(flow.getByText('Mercantilismo europeu K')).toBeVisible();

  const node = flow.getByText('Macroeconomia K');
  const box = (await node.boundingBox())!;
  const layoutSaved = page.waitForResponse((r) => r.url().includes('/layouts/') && r.request().method() === 'PUT' && r.ok());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 160, { steps: 8 });
  await page.mouse.up();
  await layoutSaved;
  await page.reload();
  await expect(page.locator('.react-flow').getByText('Macroeconomia K')).toBeVisible({ timeout: 20_000 });

  // Still a child of Economia.
  await openTopic(page, 'Macroeconomia K');
  await expect(page.getByRole('navigation', { name: 'Caminho' })).toContainText('Economia K');
});

test('study sessions left the main navigation without losing data', async ({ page }) => {
  await expect(sidebar(page).getByRole('link', { name: 'Estudos' })).toHaveCount(0);
  await openTopic(page, 'Macroeconomia K');
  await page.getByRole('link', { name: 'Registrar sessão' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openTopic(page, 'Macroeconomia K');
  await expect(page.getByRole('complementary', { name: 'Conexões do assunto' })).toContainText('1 sessão');
});
