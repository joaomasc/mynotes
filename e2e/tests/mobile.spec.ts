import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('mobile layout: bottom navigation, drawer with topics and no horizontal scroll', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Navegação rápida' });
  await expect(nav).toBeVisible();
  // "Estudos" is no longer a main destination; the library is.
  await expect(nav.getByRole('link', { name: 'Estudos' })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Biblioteca' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Biblioteca');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await nav.getByRole('button', { name: 'Mais' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByText('Assuntos')).toBeVisible();
});

test('mobile layout: library, book, topic and search pages fit the screen', async ({ page }) => {
  await login(page);
  const noHorizontalScroll = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await page.goto('/library');
  await page.getByRole('button', { name: 'Novo livro' }).click();
  await page.getByRole('dialog').getByLabel('Título', { exact: true }).fill('Livro no celular');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/readings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Livro no celular');
  await noHorizontalScroll();
  await page.getByRole('button', { name: 'Nova anotação' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toBeVisible();
  await noHorizontalScroll();

  await page.goto('/library');
  await noHorizontalScroll();
  await page.goto('/search?tags=1');
  await noHorizontalScroll();

  await page.getByRole('navigation', { name: 'Navegação rápida' }).getByRole('button', { name: 'Mais' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await drawer.getByRole('button', { name: 'Novo assunto' }).click();
  await page.getByRole('dialog', { name: 'Novo assunto' }).getByLabel('Título', { exact: true }).fill('Assunto no celular');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Assunto no celular');
  await noHorizontalScroll();
});
