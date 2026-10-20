import { expect, test } from '@playwright/test';
import { login, mockAssistant, newNote } from './helpers';

test('assistant in the right panel: uses the open note as context, shows the answer and confirms a proposal', async ({ page }) => {
  await login(page);
  const noteId = await newNote(page, 'Ricardo e o valor', 'Teoria do valor-trabalho.');
  const bodies = await mockAssistant(page, `Na sua nota [Ricardo e o valor](mynotes:note/${noteId}) há a **teoria do valor**. Confirme a estrutura abaixo.`);

  await page.getByRole('button', { name: /Painel direito: menções/ }).click();
  await page.getByRole('tab', { name: 'Assistente de IA' }).click();
  const panel = page.getByRole('complementary', { name: 'Painel direito' });
  await expect(panel.getByText('Contexto: Nota “Ricardo e o valor”')).toBeVisible();

  const input = panel.getByLabel('Mensagem para o assistente');
  await input.fill('Crie Economia Clássica com Adam Smith e David Ricardo');
  await input.press('Enter');

  const answer = panel.getByRole('article', { name: 'Resposta do assistente' });
  await expect(answer.getByText('teoria do valor')).toBeVisible();
  await expect(answer.getByRole('link', { name: 'Ricardo e o valor' })).toHaveAttribute('href', `/notes/${noteId}`);
  expect(bodies[0]).toMatchObject({ message: 'Crie Economia Clássica com Adam Smith e David Ricardo', context: { type: 'note', id: noteId, view: null } });

  const card = panel.getByRole('region', { name: 'Ação: Criar 3 assunto(s)' });
  await expect(card.getByText('Aguarda sua confirmação')).toBeVisible();
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await expect(card.getByText('Feito')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
});
