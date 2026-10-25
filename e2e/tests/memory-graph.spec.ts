import { expect, test, type Route } from '@playwright/test';
import { apiAs, login } from './helpers';

/**
 * The memory graph (colors by how much is remembered, the time ruler and
 * "Esquecendo agora") against the real API, and the suggested links in a
 * note's panel. Vectorize only runs remotely, so the suggestions come from
 * scripted answers here (the API side is covered by apps/api tests).
 */

test.beforeEach(async ({ page }) => login(page));

const json = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
const paragraphs = (...lines: string[]) => ({ type: 'doc', content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });

test('memory mode shows what is fading and opens a review of it', async ({ page, request }) => {
  const api = await apiAs(request);
  const tag = Date.now().toString(36);
  const t = await api.post('/topics', { title: `Memória ${tag}` });
  const n = await api.post('/notes', { title: `Nota que some ${tag}`, topicId: t.id, content: paragraphs('O núcleo guarda o DNA da célula.') });
  const [card] = await api.post('/review/cards', { kind: 'basic', front: `Onde fica o DNA? ${tag}`, back: 'No núcleo', noteId: n.id });
  await api.post(`/review/cards/${card.id}/answer`, { id: crypto.randomUUID(), rating: 3, localDay: new Date().toISOString().slice(0, 10) });

  await page.goto(`/graph?focus=note:${n.id}`);
  await page.getByRole('radio', { name: 'Memória' }).click();
  const legend = page.getByLabel('Legenda da memória');
  await expect(legend.getByText('Chance de lembrar')).toBeVisible();
  // Just reviewed: not fading today. In 90 days without a review, it is.
  await expect(page.getByLabel('Esquecendo agora')).toHaveCount(0);
  await legend.getByRole('radio', { name: '+90 d' }).click();
  const fading = page.getByLabel('Esquecendo agora');
  await expect(fading.getByText(`Nota que some ${tag}`)).toBeVisible();

  // The item panel tells the estimate; "Revisar estas notas" opens a session with its card.
  await fading.getByText(`Nota que some ${tag}`).click();
  await expect(page.getByLabel('Item selecionado').getByText(/Lembrança estimada: \d+% · 1 cartão/)).toBeVisible();
  await fading.getByRole('link', { name: 'Revisar estas notas' }).click();
  await page.waitForURL(/\/review\/session\/.*notes=/);
  await expect(page.locator('[data-review-prompt]')).toHaveText(`Onde fica o DNA? ${tag}`);
});

test('a note shows notes that talk to it; linking creates the relation', async ({ page, request }) => {
  const api = await apiAs(request);
  const tag = Date.now().toString(36);
  const econ = await api.post('/topics', { title: `Economia ${tag}` });
  const hist = await api.post('/topics', { title: `História ${tag}` });
  const a = await api.post('/notes', { title: `Inflação ${tag}`, topicId: econ.id, content: paragraphs('A inflação sobe quando se imprime moeda demais.') });
  const b = await api.post('/notes', { title: `República de Weimar ${tag}`, topicId: hist.id, content: paragraphs('Em 1923 a Alemanha imprimiu moeda demais e os preços explodiram.') });
  const now = new Date().toISOString();
  const suggestion = {
    id: '01900000-0000-7000-8000-00000000d001',
    a: { type: 'note', id: a.id, title: a.title, topicId: econ.id },
    b: { type: 'note', id: b.id, title: b.title, topicId: hist.id },
    score: 0.81,
    kind: null,
    direction: 'ab',
    reason: '',
    explained: false,
    status: 'open',
    createdAt: now,
  };
  const explained = { ...suggestion, kind: 'example_of', direction: 'ba', reason: 'Weimar é um caso histórico de inflação por emissão de moeda.', explained: true };
  let done = false;
  let accepted: Record<string, unknown> | null = null;
  const explainCalls: unknown[] = [];
  await page.route(
    (url) => url.pathname.endsWith('/api/v1/links/suggestions'),
    (route) => json(route, { suggestions: done ? [] : [explainCalls.length ? explained : suggestion], pending: false, unavailable: false }),
  );
  await page.route('**/api/v1/links/suggestions/explain', (route) => {
    explainCalls.push(JSON.parse(route.request().postData() ?? '{}'));
    return json(route, [explained]);
  });
  await page.route('**/api/v1/links/suggestions/*/accept', async (route) => {
    accepted = JSON.parse(route.request().postData() ?? '{}');
    done = true;
    // What the API does: a relation in the graph, in the chosen direction.
    const relation = await api.post('/relations', { sourceType: 'note', sourceId: b.id, targetType: 'note', targetId: a.id, kind: 'example_of' });
    return json(route, { relation });
  });

  await page.goto(`/notes/${a.id}`);
  const panel = page.getByLabel('Ligações sugeridas');
  await expect(panel.getByRole('link', { name: `República de Weimar ${tag}` })).toBeVisible();
  await expect(panel.getByText(`ponte: Economia ${tag} ↔ História ${tag}`)).toBeVisible();
  // Explained automatically, once: the reason and the relation in the right direction.
  await expect(panel.getByText('Weimar é um caso histórico de inflação por emissão de moeda.')).toBeVisible();
  expect(explainCalls).toEqual([{ ids: [suggestion.id] }]);
  await expect(panel.getByText(/“República de Weimar .*” é exemplo de “Inflação .*”/)).toBeVisible();
  await panel.getByRole('button', { name: 'Ligar' }).click();
  await expect(page.getByText('Ligação criada no grafo')).toBeVisible();
  expect(accepted).toMatchObject({ kind: 'example_of', direction: 'ba' });
  await expect(panel.getByText('Nenhuma sugestão por enquanto.')).toBeVisible();
});
