import { expect, test, type Page, type Route } from '@playwright/test';
import { apiAs, login } from './helpers';

/**
 * Revisar end to end, against the real API: the selection of topics (a topic
 * with all its descendants), a session with FSRS buttons and the mistakes
 * coming back, cards from a note, the AI approval screen, an essay corrected
 * by key points and free recall. The model's answers are scripted here.
 */

test.beforeEach(async ({ page }) => login(page));

const paragraphs = (...lines: string[]) => ({ type: 'doc', content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
const json = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

/** Answers every item of the session with "Bom" (after "Acho que sei"), returning the questions seen. */
async function answerAll(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    const done = page.getByRole('heading', { name: 'Sessão concluída' });
    const prompt = page.locator('[data-review-prompt]');
    await expect(done.or(prompt)).toBeVisible();
    if (await done.isVisible()) break;
    seen.push((await prompt.innerText()).trim());
    await page.getByRole('button', { name: 'Acho que sei' }).click();
    await page.getByRole('button', { name: /^Bom/ }).click();
  }
  return seen;
}

test('choosing a subtopic reviews only it and its children; mistakes come back in the session', async ({ page, request }) => {
  const api = await apiAs(request);
  const tag = Date.now().toString(36);
  const A = await api.post('/topics', { title: `A ${tag}` });
  const B = await api.post('/topics', { title: `B ${tag}`, parentId: A.id });
  const C = await api.post('/topics', { title: `C ${tag}`, parentId: B.id });
  for (const [t, name] of [
    [A, 'a'],
    [B, 'b'],
    [C, 'c'],
  ] as const) {
    await api.post('/review/cards', { kind: 'basic', front: `Pergunta ${name} ${tag}`, back: `Resposta ${name}`, topicId: t.id });
  }

  await page.goto(`/review?topics=${B.id}`);
  await expect(page.getByRole('checkbox', { name: `B ${tag}` })).toBeChecked();
  // C is covered by B: shown checked and locked.
  await expect(page.getByRole('checkbox', { name: `C ${tag}` })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: `C ${tag}` })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: `A ${tag}` })).not.toBeChecked();
  await expect(page.getByText(/2 itens: 0 para rever e 2 novos/)).toBeVisible();

  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await page.waitForURL(/\/review\/session\//);

  // First item wrong ("Errei"): it comes back before the session ends.
  const first = (await page.locator('[data-review-prompt]').innerText()).trim();
  await page.getByRole('button', { name: 'Não sei' }).click();
  await expect(page.getByText(/^Resposta [bc]$/)).toBeVisible();
  await page.getByRole('button', { name: /^Errei/ }).click();
  const rest = await answerAll(page);
  expect(rest).toContain(first);
  expect([first, ...rest].every((q) => q.endsWith(tag) && !q.startsWith('Pergunta a'))).toBe(true);
  expect(new Set([first, ...rest])).toEqual(new Set([`Pergunta b ${tag}`, `Pergunta c ${tag}`]));
  await expect(page.getByText('certos de primeira')).toBeVisible();
  await expect(page.getByText(B.title).first()).toBeVisible();

  // Nothing else is due in B today.
  await page.getByRole('link', { name: 'Voltar para Revisar' }).click();
  await expect(page.getByRole('button', { name: 'Começar', exact: true })).toBeDisabled();
});

test('a passage of a note becomes a cloze card', async ({ page, request }) => {
  const api = await apiAs(request);
  const tag = Date.now().toString(36);
  const t = await api.post('/topics', { title: `Biologia ${tag}` });
  const n = await api.post('/notes', { title: `Célula ${tag}`, topicId: t.id, content: paragraphs('A mitocôndria produz energia para a célula.') });

  await page.goto(`/notes/${n.id}`);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+A');
  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: /Criar cartão/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo cartão' });
  const text = dialog.getByLabel('Texto com lacunas');
  await expect(text).toHaveValue('A mitocôndria produz energia para a célula.');
  // Select "mitocôndria" and mark it as the blank.
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 13));
  await dialog.getByRole('button', { name: 'Marcar lacuna' }).click();
  await expect(text).toHaveValue('A {{c1::mitocôndria}} produz energia para a célula.');
  await dialog.getByRole('button', { name: 'Criar cartão' }).click();
  await expect(page.getByText('Cartão criado')).toBeVisible();

  await page.goto(`/review/cards?noteId=${n.id}`);
  await expect(page.getByText('A […] produz energia para a célula.')).toBeVisible();
  const cards = await api.get(`/review/cards?noteId=${n.id}`);
  expect(cards[0]).toMatchObject({ kind: 'cloze', noteId: n.id, topicId: t.id, sourceQuote: 'A mitocôndria produz energia para a célula.' });
});

test('AI questions wait for approval; an essay is corrected by key points and recall shows what was missed', async ({ page, request }) => {
  const api = await apiAs(request);
  const tag = Date.now().toString(36);
  const t = await api.post('/topics', { title: `Botânica ${tag}` });
  const n = await api.post('/notes', {
    title: `Fotossíntese ${tag}`,
    topicId: t.id,
    content: paragraphs('A fotossíntese acontece nos cloroplastos.', 'Ela usa luz, água e gás carbônico para produzir glicose e oxigênio.'),
  });
  const now = new Date().toISOString();
  const proposals = [
    { kind: 'basic', front: `Onde acontece a fotossíntese? ${tag}`, back: 'Nos cloroplastos', keyPoints: [], sourceQuote: 'A fotossíntese acontece nos cloroplastos.' },
    { kind: 'essay', front: `Explique a fotossíntese ${tag}`, back: 'Usa luz, água e CO2 para produzir glicose e oxigênio.', keyPoints: ['luz, água e gás carbônico', 'produz glicose', 'libera oxigênio'], sourceQuote: 'Ela usa luz, água e gás carbônico' },
  ].map((p, i) => ({ ...p, id: `01900000-0000-7000-8000-0000000000f${i}`, batchId: '01900000-0000-7000-8000-0000000000bb', origin: 'ai', noteId: n.id, noteTitle: n.title, topicId: t.id, createdAt: now }));

  // The model is scripted: generation returns the two questions; approving creates them through the real API.
  let decided: { accept: { id: string; back?: string }[]; discard: string[] } | null = null;
  await page.route('**/api/v1/review/generate', (route) => json(route, { batchId: proposals[0]!.batchId, proposals, discarded: 1, notesRead: 1 }));
  await page.route((url) => url.pathname.endsWith('/api/v1/review/proposals'), (route) => json(route, decided ? [] : proposals));
  await page.route('**/api/v1/review/proposals/decide', async (route) => {
    decided = JSON.parse(route.request().postData() ?? '{}');
    const created = [];
    for (const a of decided!.accept) {
      const p = proposals.find((x) => x.id === a.id)!;
      created.push(...(await api.post('/review/cards', { kind: p.kind, front: p.front, back: a.back ?? p.back, keyPoints: p.keyPoints, noteId: n.id, sourceQuote: p.sourceQuote })));
    }
    return json(route, { created, discarded: decided!.discard.length });
  });

  await page.goto(`/review?topics=${t.id}`);
  await page.getByRole('button', { name: 'Gerar com IA' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar' }).click();
  await page.waitForURL(/\/review\/proposals\?batch=/);
  await expect(page.getByText('1 pergunta foi descartada')).toBeVisible();
  await expect(page.getByText('A fotossíntese acontece nos cloroplastos.')).toBeVisible();
  await page.getByRole('button', { name: /Aprovar 2/ }).click();
  await expect(page.getByText('2 cartões criados')).toBeVisible();
  expect(decided!.accept.map((a) => a.id)).toEqual(proposals.map((p) => p.id));

  // The essay, answered and corrected by the (scripted) AI.
  let answered: Record<string, unknown> | null = null;
  await page.route('**/api/v1/review/cards/*/evaluate', (route) =>
    json(route, {
      points: [
        { point: 'luz, água e gás carbônico', status: 'covered', evidence: '“luz e água”' },
        { point: 'produz glicose', status: 'covered', evidence: '“faz glicose”' },
        { point: 'libera oxigênio', status: 'missing', evidence: 'Não falou do oxigênio.' },
      ],
      errors: [],
      noteIssue: null,
      modelAnswer: 'Usa luz, água e gás carbônico para produzir glicose e oxigênio.',
      feedback: 'Faltou o oxigênio.',
      score: 67,
      suggestedRating: 2,
      model: 'gpt-6-luna',
      evaluatedAt: new Date().toISOString(),
    }),
  );
  page.on('request', (r) => {
    if (/\/review\/cards\/[0-9a-f-]+\/answer$/.test(r.url())) answered = JSON.parse(r.postData() ?? '{}');
  });
  await page.goto(`/review?topics=${t.id}`);
  await page.getByRole('radio', { name: /Perguntas e dissertações/ }).click();
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await expect(page.locator('[data-review-prompt]')).toHaveText(`Explique a fotossíntese ${tag}`);
  await page.getByLabel('Sua resposta').fill('Ela usa luz e água e faz glicose.');
  await page.getByRole('button', { name: 'Corrigir com a IA' }).click();
  await expect(page.getByText('67', { exact: true })).toBeVisible();
  await expect(page.getByText('Não falou do oxigênio.')).toBeVisible();
  await expect(page.getByText(/Sugestão: Difícil/)).toBeVisible();
  // Disagreeing is allowed and recorded.
  await page.getByRole('button', { name: /^Bom/ }).click();
  await expect(page.getByRole('heading', { name: 'Sessão concluída' })).toBeVisible();
  expect(answered).toMatchObject({ rating: 3, score: 67, disputed: true, answer: 'Ela usa luz e água e faz glicose.' });

  // Free recall about the topic (scripted comparison).
  await page.route('**/api/v1/review/recalls', (route) =>
    route.request().method() === 'POST'
      ? json(route, {
          id: '01900000-0000-7000-8000-0000000000cc',
          topicId: t.id,
          topicTitle: t.title,
          sessionId: null,
          text: 'x',
          coverage: 50,
          localDay: now.slice(0, 10),
          createdAt: now,
          evaluation: {
            ideas: [
              { idea: 'Acontece nos cloroplastos', status: 'covered', noteId: n.id, noteTitle: n.title, quote: 'A fotossíntese acontece nos cloroplastos.', evidence: 'nos cloroplastos' },
              { idea: 'Produz glicose e oxigênio', status: 'missing', noteId: n.id, noteTitle: n.title, quote: 'para produzir glicose e oxigênio', evidence: '' },
            ],
            errors: [],
            coverage: 50,
            summary: 'Reveja o que a fotossíntese produz.',
            model: 'gpt-6-luna',
            evaluatedAt: now,
          },
        })
      : route.fallback(),
  );
  await page.goto(`/review?topics=${t.id}`);
  await page.getByRole('radio', { name: /Escrever tudo que lembra/ }).click();
  await page.getByRole('button', { name: 'Começar a escrever' }).click();
  await page.getByLabel('O que você lembra').fill('A fotossíntese acontece nos cloroplastos das plantas.');
  await page.getByRole('button', { name: 'Comparar com as notas' }).click();
  await expect(page.getByRole('heading', { name: 'Você lembrou 50% das ideias principais' })).toBeVisible();
  await page.getByRole('button', { name: 'Criar cartão' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo cartão' }).getByLabel('Resposta', { exact: true })).toHaveValue('para produzir glicose e oxigênio');
});
