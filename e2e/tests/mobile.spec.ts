import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('mobile layout: bottom navigation, drawer with topics and no horizontal scroll', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Navegação rápida' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Estudos' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Diário de estudos');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await nav.getByRole('button', { name: 'Mais' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByText('Assuntos')).toBeVisible();
});
