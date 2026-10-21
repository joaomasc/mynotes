import { expect, test } from '@playwright/test';
import { login, newNote } from './helpers';

test.beforeEach(async ({ page }) => login(page));

const shot = (name: string) => `test-results/screens/${name}.png`;

test('code blocks: pick a language, colors and indentation', async ({ page }) => {
  const id = await newNote(page, 'Código', 'Exemplo:');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Bloco de código/ }).click();
  await page.getByLabel('Linguagem do bloco de código').selectOption('python');
  await page.locator('.code-block code').click();
  await page.keyboard.type('def soma(a, b):');
  await page.keyboard.press('Enter');
  // Enter after ":" indents the next line (4 spaces in Python).
  await page.keyboard.type('return a + b');
  await expect(page.locator('.code-block .hljs-keyword').first()).toHaveText('def');
  await expect(page.locator('.code-block code')).toContainText('def soma(a, b):\n    return a + b');
  await page.waitForResponse(
    (r) => r.url().endsWith(`/notes/${id}`) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('"language":"python"'),
  );
  await page.locator('.code-block').screenshot({ path: shot('code-block') });

  // Typing ```js and a space starts a JavaScript block.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```js ');
  await page.keyboard.type('const x = 1;');
  await expect(page.getByLabel('Linguagem do bloco de código').nth(1)).toHaveValue('javascript');
});

test('daily notes: calendar, today’s note and navigation', async ({ page }) => {
  await page.goto('/daily');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notas diárias');
  await page.getByRole('button', { name: 'Nota de hoje' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  const today = new Date();
  const title = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await expect(page.getByLabel('Título da nota')).toHaveValue(title);
  const nav = page.getByRole('navigation', { name: 'Notas diárias' });
  await expect(nav).toBeVisible();
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).click();
  await page.keyboard.type('Hoje estudei canvas.');
  await page.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('Hoje estudei'));

  // Yesterday from the calendar: created, then reachable with "previous".
  await nav.getByRole('link', { name: /de \d{4}/ }).click();
  await page.waitForURL(/\/daily/);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (yesterday.getMonth() !== today.getMonth()) await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${today.getDate()} de .*, com nota$`) }).first()).toBeVisible();
  await page.screenshot({ path: shot('daily-page') });
  await page.getByRole('button', { name: new RegExp(`^${yesterday.getDate()} de `) }).filter({ hasNot: page.locator('[aria-current]') }).first().click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('navigation', { name: 'Notas diárias' }).getByRole('link', { name: /Próxima|de / }).last()).toBeVisible();
  await page.getByRole('navigation', { name: 'Notas diárias' }).getByTitle('Próxima nota diária').click();
  await expect(page.getByLabel('Título da nota')).toHaveValue(title);
});

test('canvas inside a topic: topic card, text cards, notes and links', async ({ page }) => {
  await page.getByRole('complementary', { name: 'Barra lateral' }).getByRole('button', { name: 'Novo assunto' }).click();
  await page.getByLabel('Título').fill('Revolução C');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Revolução C');
  const topicUrl = page.url();
  await page.getByRole('button', { name: 'Nova nota' }).first().click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  const noteId = page.url().split('/notes/')[1]!;
  await page.getByLabel('Título da nota').fill('Bastilha C');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Tomada em 14 de julho.');
  await page.waitForResponse((r) => r.url().endsWith(`/notes/${noteId}`) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('14 de julho'));

  await page.goto(topicUrl);
  await page.getByRole('button', { name: 'Criar canvas' }).click();
  await page.waitForURL(/\/canvas\/[0-9a-f-]{36}$/);
  const flow = page.locator('.react-flow');
  // It starts with the topic, showing its notes.
  await expect(flow.locator('.react-flow__node-item').getByText('Revolução C')).toBeVisible();
  await expect(flow.locator('.react-flow__node-item').getByText('Bastilha C')).toBeVisible();

  // Double click on the empty canvas: a text card ready to type.
  const box = (await flow.boundingBox())!;
  await page.mouse.dblclick(box.x + 120, box.y + 120);
  await expect(page.getByRole('textbox', { name: 'Texto do cartão' })).toBeFocused();
  await page.keyboard.type('Causas da revolução');
  // The note as a card, from the dialog.
  await page.getByRole('button', { name: /Nota\/assunto/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Bastilha C');
  await page.getByRole('dialog').getByRole('option', { name: /Bastilha C/ }).first().click();
  await expect(flow.locator('.react-flow__node-item').getByText('Tomada em 14 de julho.')).toBeVisible();
  await page.waitForResponse((r) => /\/mind-maps\//.test(r.url()) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('Causas da revolu'));

  // An arrow from the right side of the text to the note.
  const noteCard = flow.locator('.react-flow__node-item').filter({ hasText: 'Tomada em 14 de julho.' });
  const from = (await flow.locator('.react-flow__node-text .react-flow__handle-right').boundingBox())!;
  const to = (await noteCard.locator('.react-flow__handle-left').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(flow.locator('.react-flow__edge')).toHaveCount(1);
  await page.waitForResponse((r) => /\/mind-maps\//.test(r.url()) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('"sourceHandle":"right"'));

  // Pasting a web address makes a link card.
  await flow.click({ position: { x: 40, y: box.height - 80 } });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://pt.wikipedia.org/wiki/Revolução_Francesa');
    document.querySelector('.react-flow')!.parentElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(flow.locator('.react-flow__node-link').getByText('pt.wikipedia.org', { exact: true })).toBeVisible();
  await page.waitForResponse((r) => /\/mind-maps\//.test(r.url()) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes('wikipedia'));
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Ajustar à tela' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('canvas') });

  // Everything is still there after a reload, and the topic lists the canvas.
  await page.reload();
  await expect(flow.locator('.react-flow__node-text').getByText('Causas da revolução')).toBeVisible();
  await expect(flow.locator('.react-flow__node-link')).toHaveCount(1);
  await page.goto(topicUrl);
  await expect(page.getByRole('main').getByRole('link', { name: /Canvas — Revolução C/ })).toBeVisible();
});
