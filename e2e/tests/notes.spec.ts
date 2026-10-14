import { expect, test } from '@playwright/test';
import { API, USER, login, newNote } from './helpers';

test.beforeEach(async ({ page }) => login(page));

test('creates a topic tree and a note inside it', async ({ page }) => {
  await page.getByRole('button', { name: 'Novo assunto' }).first().click();
  await page.getByLabel('Título').fill('Economia E2E');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Economia E2E');
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Novo subassunto' }).click();
  await page.getByLabel('Título').fill('Macro E2E');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('navigation', { name: 'Caminho' })).toContainText('Economia E2E');
  await page.getByRole('button', { name: 'Nova nota' }).first().click();
  await page.getByLabel('Título da nota').fill('Nota no subassunto');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Conteúdo dentro de Macro.');
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tree', { name: 'Assuntos' })).toContainText('Macro E2E');
});

test('autosaves, persists after reload and finds the note by search without accents', async ({ page }) => {
  await newNote(page, 'Política monetária E2E', 'A taxa Selic orienta a inflação.');
  await page.reload();
  await expect(page.locator('.ProseMirror')).toContainText('A taxa Selic orienta a inflação.');
  await page.goto('/search?q=politica%20selic');
  await expect(page.getByRole('main')).toContainText('Política monetária E2E');
});

test('does not lose text when the page is reloaded right after typing', async ({ page, browser }) => {
  const id = await newNote(page, 'Recarregar E2E', 'Base salva.');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Digitado e recarregado na hora.');
  await page.reload(); // no wait: edits are still in the debounce window
  await expect(page.locator('.ProseMirror')).toContainText('Digitado e recarregado na hora.');
  await expect(page.getByRole('complementary', { name: 'Barra lateral' }).getByText('Sincronizado')).toBeVisible({ timeout: 30_000 });

  // A different "device" (fresh browser context, no local drafts) must see the text from the server.
  const other = await browser.newContext();
  const phone = await other.newPage();
  await login(phone);
  await phone.goto(`/notes/${id}`);
  await expect(phone.locator('.ProseMirror')).toContainText('Digitado e recarregado na hora.');
  await other.close();
});

test('keeps offline edits and syncs them when the connection returns', async ({ page, context }) => {
  const id = await newNote(page, 'Offline E2E', 'Primeira parte.');
  await context.setOffline(true);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Escrito sem rede.');
  await expect(page.getByText('Offline — salvo neste aparelho')).toBeVisible({ timeout: 15_000 });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 30_000 });
  await page.goto(`/notes/${id}`);
  await expect(page.locator('.ProseMirror')).toContainText('Escrito sem rede.');
});

test('detects a concurrent edit from another device and keeps the chosen version', async ({ page, request }) => {
  const id = await newNote(page, 'Conflito E2E', 'Texto original.');
  // Second device: log in through the API with its own key and save a change.
  const { argon2id } = await import('hash-wasm');
  const pre = await (await request.post(`${API}/auth/prelogin`, { data: { username: USER.username } })).json();
  const k = pre.data.kdf;
  const key = await argon2id({ password: USER.password, salt: Buffer.from(k.salt, 'base64url'), iterations: k.iterations, parallelism: k.parallelism, memorySize: k.memoryKiB, hashLength: 32, outputType: 'binary' });
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const auth = await (
    await request.post(`${API}/auth/login`, {
      data: { username: USER.username, verifier: Buffer.from(key).toString('base64url'), publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, deviceLabel: 'Celular E2E' },
    })
  ).json();
  const headers = { Authorization: `Bearer ${auth.data.accessToken}` };
  const current = await (await request.get(`${API}/notes/${id}`, { headers })).json();
  const patched = await request.patch(`${API}/notes/${id}`, { headers, data: { baseVersion: current.data.version, title: 'Editado no celular' } });
  expect(patched.ok()).toBeTruthy();

  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Editado no notebook.');
  await expect(page.getByText('Esta nota foi alterada em outro dispositivo')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Manter a minha versão' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 20_000 });
  const final = await (await request.get(`${API}/notes/${id}`, { headers })).json();
  expect(JSON.stringify(final.data.content)).toContain('Editado no notebook.');
});
