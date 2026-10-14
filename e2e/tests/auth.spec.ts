import { expect, test } from '@playwright/test';
import { USER, login } from './helpers';

test('redirects anonymous users to the login page', async ({ page }) => {
  await page.goto('/notes');
  await expect(page).toHaveURL(/\/login$/);
});

test('rejects a wrong password with a generic message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(USER.username);
  await page.getByLabel('Senha').fill('senha-errada-123456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Usuário ou senha inválidos.', { timeout: 30_000 });
});

test('logs in, survives a reload without storing tokens, and logs out', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Bom dia|Boa tarde|Boa noite/);
  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  const storage = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  expect(storage).not.toMatch(/accessToken|Bearer|senha/);
  await page.getByRole('button', { name: 'Sair' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
