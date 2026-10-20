import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownToDoc, uuidv7, type AiAction, type AiChatResponse, type AiStatus } from '@mynotes/shared';
import { ConfirmProvider } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { setPref } from '@/lib/prefs';
import { AssistantChat, CONVERSATION_PREF } from '@/features/assistant/assistant-chat';
import { aiContextFromPath } from '@/features/assistant/context';
import { RichText } from '@/features/assistant/rich-text';

const status: AiStatus = {
  enabled: true,
  configured: true,
  model: 'gpt-6-luna',
  dailyBudgetUsd: 0.5,
  spentTodayUsd: 0.0012,
  limits: { messageChars: 4000, toolCallsPerTurn: 8, requestsPerMinute: 6 },
  pricing: { inputPerMTok: 0.1, cachedInputPerMTok: 0.01, outputPerMTok: 0.5 },
  webSearch: { enabled: true, maxPerTurn: 5, pricePerCallUsd: 0.01 },
  usage: [],
};

const noteId = uuidv7();
const conversationId = uuidv7();
const now = new Date().toISOString();

function turn(text: string, actions: AiAction[] = [], messageId = uuidv7()): AiChatResponse {
  return {
    conversation: { id: conversationId, title: 'Conversa', contextType: null, contextId: null, messageCount: 2, costUsd: 0.0004, createdAt: now, updatedAt: now },
    userMessage: { id: messageId, conversationId, role: 'user', content: 'pergunta', sources: [], webSources: [], tools: [], actionIds: [], status: 'ok', usage: null, createdAt: now },
    assistantMessage: {
      id: uuidv7(),
      conversationId,
      role: 'assistant',
      content: text,
      sources: [{ type: 'note', id: noteId, title: 'David Ricardo', role: 'note', readingId: null, page: null }],
      webSources: [],
      tools: [{ tool: 'search_knowledge', label: 'Pesquisou “Ricardo”', kind: 'read', ok: true }],
      actionIds: actions.map((a) => a.id),
      status: 'ok',
      usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 50, reasoningTokens: 0, costUsd: 0.000125 },
      createdAt: now,
    },
    actions,
    replayed: false,
  };
}

const proposal = (): AiAction => ({
  id: uuidv7(),
  conversationId,
  tool: 'create_topics',
  kind: 'write',
  status: 'proposed',
  title: 'Criar 3 assunto(s)',
  preview: [
    { depth: 0, label: 'Economia Clássica', state: 'new', detail: null },
    { depth: 1, label: 'Adam Smith', state: 'new', detail: null },
    { depth: 1, label: 'David Ricardo', state: 'existing', detail: 'já existe — será reaproveitado' },
  ],
  results: [],
  error: null,
  createdAt: now,
  decidedAt: null,
  expiresAt: now,
});

function renderChat(props: Partial<Parameters<typeof AssistantChat>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <MemoryRouter>
          <AssistantChat context={null} {...props} />
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const input = () => screen.getByLabelText('Mensagem para o assistente') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const pressEnter = () => fireEvent.keyDown(input(), { key: 'Enter' });

beforeEach(() => {
  localStorage.clear();
  // usePref keeps an in-memory copy: every test starts without a conversation.
  setPref(CONVERSATION_PREF, null);
  vi.spyOn(endpoints.ai, 'status').mockResolvedValue(status);
  vi.spyOn(endpoints.ai, 'conversations').mockResolvedValue([]);
  vi.spyOn(endpoints.ai, 'syncIndex').mockResolvedValue({ available: true, model: '@cf/baai/bge-m3', indexed: 1, total: 1, processed: 0, removed: 0, more: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('assistant chat', () => {
  it('sends with Enter, streams progress and text, then shows the answer with its sources and tool activity', async () => {
    let resolve!: (r: AiChatResponse) => void;
    let emit!: (event: string, data: unknown) => void;
    const chat = vi.spyOn(endpoints.ai, 'chatStream').mockImplementation((_body, onEvent) => {
      emit = onEvent;
      return new Promise((r) => (resolve = r));
    });
    renderChat();
    type('Onde anotei a teoria do valor de Ricardo?');
    pressEnter();
    await waitFor(() => expect(chat).toHaveBeenCalled());
    expect(chat.mock.calls[0]![0]).toMatchObject({ message: 'Onde anotei a teoria do valor de Ricardo?', conversationId: null, context: null });
    expect(input().value).toBe('');
    // Live progress: what it did, then the text as it arrives.
    act(() => emit('status', { label: 'Pesquisando nas suas notas…' }));
    expect(await screen.findByText('Pesquisando nas suas notas…')).toBeTruthy();
    act(() => emit('tool', { tool: 'search_knowledge', label: 'Pesquisou automaticamente', kind: 'read', ok: true }));
    act(() => emit('delta', { text: 'Está em **David' }));
    const live = await screen.findByRole('article', { name: 'Resposta em andamento' });
    expect(within(live).getByText(/Pesquisou automaticamente/)).toBeTruthy();
    expect(live.textContent).toContain('Está em');
    act(() => emit('reset', {}));
    await waitFor(() => expect(live.textContent).not.toContain('Está em'));

    await act(async () => resolve(turn(`Está em [David Ricardo](mynotes:note/${noteId}), com **valor-trabalho**.`)));
    const answer = await screen.findByRole('article', { name: 'Resposta do assistente' });
    expect(within(answer).getByText('valor-trabalho').tagName).toBe('STRONG');
    const links = within(answer).getAllByRole('link', { name: /David Ricardo/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([`/notes/${noteId}`, `/notes/${noteId}`]);
    expect(within(answer).getByText('Consultou o MyNotes (1)')).toBeTruthy();
    expect(within(answer).getByText('Fontes')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Resposta em andamento' })).toBeNull();
    // Opening the assistant asked the server to index what changed.
    expect(endpoints.ai.syncIndex).toHaveBeenCalled();
  });

  it('shows errors and retries with the same message id', async () => {
    const chat = vi
      .spyOn(endpoints.ai, 'chatStream')
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'A OpenAI está indisponível no momento.'))
      .mockResolvedValueOnce(turn('Agora foi.'));
    renderChat();
    type('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('A OpenAI está indisponível no momento.');
    fireEvent.click(within(alert).getByRole('button', { name: /Tentar novamente/ }));
    expect(await screen.findByText('Agora foi.')).toBeTruthy();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]![0].messageId).toBe(chat.mock.calls[0]![0].messageId);
  });

  it('runs a proposal only when the user confirms it', async () => {
    const action = proposal();
    vi.spyOn(endpoints.ai, 'chatStream').mockResolvedValue(turn('Confirme a estrutura no cartão.', [action]));
    const confirm = vi.spyOn(endpoints.ai, 'confirm').mockResolvedValue({
      action: { ...action, status: 'executed', results: [{ type: 'topic', id: uuidv7(), title: 'Economia Clássica', role: null, readingId: null, page: null }] },
      event: null,
    });
    renderChat();
    type('Crie Economia Clássica com Adam Smith e David Ricardo');
    pressEnter();
    const card = await screen.findByRole('region', { name: 'Ação: Criar 3 assunto(s)' });
    expect(within(card).getByText('Aguarda sua confirmação')).toBeTruthy();
    expect(within(card).getByText('Adam Smith')).toBeTruthy();
    expect(within(card).getByText('(já existe)')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(within(card).getByText('Feito')).toBeTruthy());
    expect(confirm).toHaveBeenCalledWith(action.id);
    expect(within(card).queryByRole('button', { name: /Confirmar/ })).toBeNull();
    expect(within(card).getByRole('link', { name: /Economia Clássica/ })).toBeTruthy();
  });

  it('sends the open item as context, unless the user removes it', async () => {
    const chat = vi.spyOn(endpoints.ai, 'chatStream').mockResolvedValue(turn('ok'));
    renderChat({ context: { type: 'note', id: noteId, view: null }, contextTitle: 'David Ricardo' });
    expect(screen.getByText(/Contexto: Nota “David Ricardo”/)).toBeTruthy();
    type('Resuma esta nota');
    pressEnter();
    await screen.findByText('ok');
    expect(chat.mock.calls[0]![0].context).toEqual({ type: 'note', id: noteId, view: null });
    fireEvent.click(screen.getByRole('button', { name: 'Não usar o item aberto como contexto' }));
    type('Outra pergunta');
    pressEnter();
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2));
    expect(chat.mock.calls[1]![0]).toMatchObject({ context: null, conversationId });
  });

  it('searches the web only when the user turns it on, and lists the pages apart from the notes', async () => {
    const page = { url: 'https://www.example.com/plano-de-metas', title: '' };
    const res = turn(`Na web, [o Plano de Metas](${page.url}) acelerou a indústria.`);
    res.assistantMessage.webSources = [page];
    res.assistantMessage.tools.push({ tool: 'web_search', label: 'Pesquisou na web “plano de metas”', kind: 'read', ok: true });
    const chat = vi.spyOn(endpoints.ai, 'chatStream').mockResolvedValue(res);
    renderChat();
    const toggle = await screen.findByRole('button', { name: 'Pesquisar na web' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Pesquisa na web ligada · até 5 buscas por mensagem, US\$ 0\.01 cada/)).toBeTruthy();
    type('Pesquise sobre o Plano de Metas');
    pressEnter();
    const answer = await screen.findByRole('article', { name: 'Resposta do assistente' });
    expect(chat.mock.calls[0]![0]).toMatchObject({ webSearch: true });
    expect(within(answer).getByText(/pesquisou na web \(1\)/)).toBeTruthy();
    expect(within(answer).getByText('Na web')).toBeTruthy();
    const link = within(answer).getByRole('link', { name: 'example.com' });
    expect(link.getAttribute('href')).toBe(page.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // Turned off, the next message stays inside MyNotes.
    fireEvent.click(screen.getByRole('button', { name: 'Desligar a pesquisa na web' }));
    type('E nas minhas notas?');
    pressEnter();
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2));
    expect(chat.mock.calls[1]![0]).toMatchObject({ webSearch: false });
  });

  it('hides the web search button when the server turned it off', async () => {
    vi.spyOn(endpoints.ai, 'status').mockResolvedValue({ ...status, webSearch: { ...status.webSearch, enabled: false } });
    renderChat();
    await screen.findByText(/hoje/);
    expect(screen.queryByRole('button', { name: 'Pesquisar na web' })).toBeNull();
  });

  it('explains when the server has no OpenAI key, without offering to send', async () => {
    vi.spyOn(endpoints.ai, 'status').mockResolvedValue({ ...status, configured: false });
    renderChat();
    expect(await screen.findByText('Assistente não configurado')).toBeTruthy();
    expect(input().disabled).toBe(true);
  });
});

describe('assistant rendering and context', () => {
  it('renders Markdown as plain elements: no HTML, no unsafe links', () => {
    const doc = markdownToDoc('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [site](https://example.com)\n\n- item');
    const { container } = render(
      <MemoryRouter>
        <RichText doc={doc} sources={[]} />
      </MemoryRouter>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['https://example.com']);
    expect(anchors[0]!.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('ul li')?.textContent).toBe('item');
  });

  it('derives the context from the page being viewed', () => {
    const id = uuidv7();
    expect(aiContextFromPath(`/notes/${id}`)).toEqual({ type: 'note', id, view: null });
    expect(aiContextFromPath(`/topics/${id}/map`)).toEqual({ type: 'topic', id, view: 'map' });
    expect(aiContextFromPath(`/graph?focus=topic:${id}`)).toEqual({ type: 'topic', id, view: 'graph' });
    expect(aiContextFromPath(`/assistant?about=reading:${id}`)).toEqual({ type: 'reading', id, view: null });
    expect(aiContextFromPath('/notes')).toBeNull();
    expect(aiContextFromPath(`/plans/${id}`)).toBeNull();
  });
});
