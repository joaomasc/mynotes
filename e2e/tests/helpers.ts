import type { Page } from '@playwright/test';

export const USER = { username: 'e2e', password: 'senha-e2e-segura-123' };
export const API = 'http://127.0.0.1:8788/api/v1';

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(USER.username);
  await page.getByLabel('Senha').fill(USER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });
}

export async function newNote(page: Page, title: string, body: string): Promise<string> {
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Nova nota' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  const id = page.url().split('/notes/')[1]!;
  await page.getByLabel('Título da nota').fill(title);
  await page.keyboard.press('Enter');
  await page.keyboard.type(body);
  await waitForNoteSave(page, id, body);
  return id;
}

/** Waits until the server confirmed a save containing `text`. */
export async function waitForNoteSave(page: Page, id: string, text: string): Promise<void> {
  await page.waitForResponse(
    (r) => r.url().endsWith(`/notes/${id}`) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes(text),
    { timeout: 30_000 },
  );
}

/** Minimal valid multi-page PDF with real text; `paddingBytes` makes it large but still well-formed. */
export function samplePdf(pages: string[][], paddingBytes = 0): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add('PAGES');
  const pageIds: number[] = [];
  for (const lines of pages) {
    const content = ['BT', '/F1 18 Tf', '72 720 Td', ...lines.flatMap((l, i) => (i ? ['0 -26 Td', `(${l}) Tj`] : [`(${l}) Tj`])), 'ET'].join('\n');
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents ${objs.length} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  // Unreferenced data stream (like the images of a scanned book): a large but well-formed file.
  if (paddingBytes > 0) add(`<< /Length ${paddingBytes} >>\nstream\n${' '.repeat(paddingBytes)}\nendstream`);
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * Answers the assistant's API calls in the browser (no OpenAI call, no cost).
 * The chat turn proposes one topic tree; confirming it "executes" it.
 * Returns the chat request bodies, for assertions.
 */
export async function mockAssistant(page: Page, answer: string): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  const conversationId = '01900000-0000-7000-8000-00000000c0c0';
  const action = {
    id: '01900000-0000-7000-8000-0000000000a1',
    conversationId,
    tool: 'create_topics',
    kind: 'write',
    status: 'proposed',
    title: 'Criar 3 assunto(s)',
    preview: [
      { depth: 0, label: 'Economia Clássica', state: 'new', detail: null },
      { depth: 1, label: 'Adam Smith', state: 'new', detail: null },
      { depth: 1, label: 'David Ricardo', state: 'new', detail: null },
    ],
    results: [],
    error: null,
    createdAt: now,
    decidedAt: null,
    expiresAt: now,
  };
  await page.route('**/api/v1/ai/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (url.pathname.endsWith('/ai/status')) {
      return json({
        enabled: true,
        configured: true,
        model: 'gpt-6-luna',
        dailyBudgetUsd: 0.5,
        spentTodayUsd: 0,
        limits: { messageChars: 4000, toolCallsPerTurn: 8, requestsPerMinute: 6 },
        pricing: { inputPerMTok: 0.1, cachedInputPerMTok: 0.01, outputPerMTok: 0.5 },
        usage: [],
      });
    }
    if (url.pathname.endsWith('/ai/conversations')) return json([]);
    if (url.pathname.endsWith('/ai/index')) return json({ available: true, model: '@cf/baai/bge-m3', indexed: 3, total: 3 });
    if (url.pathname.endsWith('/ai/index/sync')) return json({ available: true, model: '@cf/baai/bge-m3', indexed: 3, total: 3, processed: 0, removed: 0, more: false });
    if (url.pathname.endsWith('/ai/chat/stream')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      bodies.push(body);
      const done = {
        conversation: { id: conversationId, title: String(body.message), contextType: null, contextId: null, messageCount: 2, costUsd: 0.0004, createdAt: now, updatedAt: now },
        userMessage: { id: body.messageId, conversationId, role: 'user', content: body.message, sources: [], tools: [], actionIds: [], status: 'ok', usage: null, createdAt: now },
        assistantMessage: {
          id: '01900000-0000-7000-8000-0000000000b1',
          conversationId,
          role: 'assistant',
          content: answer,
          sources: [],
          tools: [{ tool: 'get_topic_tree', label: 'Consultou a árvore de assuntos', kind: 'read', ok: true }],
          actionIds: [action.id],
          status: 'ok',
          usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 40, reasoningTokens: 0, costUsd: 0.00012 },
          createdAt: now,
        },
        actions: [action],
        replayed: false,
      };
      // Server-sent events, like the API: progress, the text in pieces, then the saved turn.
      const events: [string, unknown][] = [
        ['status', { label: 'Pesquisando nas suas notas…' }],
        ['tool', { tool: 'search_knowledge', label: 'Pesquisou automaticamente', kind: 'read', ok: true }],
        ['delta', { text: answer.slice(0, 10) }],
        ['delta', { text: answer.slice(10) }],
        ['done', done],
      ];
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
      });
    }
    if (url.pathname.endsWith(`/ai/actions/${action.id}/confirm`)) {
      return json({ action: { ...action, status: 'executed', decidedAt: now }, event: null });
    }
    if (url.pathname.includes('/ai/conversations/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"not_found","message":"Conversa não encontrada"}}' });
    return route.continue();
  });
  return bodies;
}
