import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, type ReviewProposal, type Setting } from '@mynotes/shared';
import { ConfirmProvider } from '@/components/ui/dialog';
import { endpoints } from '@/lib/api/endpoints';
import { CardDialog } from '@/features/review/card-dialog';
import { Component as ProposalsPage } from '@/features/review/proposals-page';
import { ReviewSettingsDialog } from '@/features/review/review-settings';

// The settings hooks load the theme module, which reads matchMedia (missing in jsdom).
vi.hoisted(() => {
  window.matchMedia ??= ((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

/*
 * The review dialogs fill their fields when they open and keep what is being
 * typed while the page behind them re-renders (queries refreshing, new
 * objects passed as props).
 */

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.spyOn(endpoints.topics, 'list').mockResolvedValue([]);
  vi.spyOn(endpoints.settings, 'list').mockResolvedValue([] as Setting[]);
  vi.spyOn(endpoints.speech, 'pushStatus').mockResolvedValue({ publicKey: null, subscriptions: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('review dialogs', () => {
  it('the card form keeps what is typed when the page re-renders with a new draft object', async () => {
    const create = vi.spyOn(endpoints.review, 'createCards').mockResolvedValue([]);
    const view = render(wrap(<CardDialog open onOpenChange={() => undefined} draft={{ topicId: null }} />));
    const question = await screen.findByLabelText('Pergunta');
    fireEvent.change(question, { target: { value: 'Capital da França?' } });
    fireEvent.change(screen.getByLabelText('Resposta'), { target: { value: 'Paris' } });
    // The page behind re-renders: a new (equal) draft object.
    view.rerender(wrap(<CardDialog open onOpenChange={() => undefined} draft={{ topicId: null }} />));
    expect(screen.getByLabelText('Pergunta')).toHaveProperty('value', 'Capital da França?');
    fireEvent.click(screen.getByRole('button', { name: 'Criar cartão' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ kind: 'basic', front: 'Capital da França?', back: 'Paris', topicId: null });
  });

  it('a cloze text gets its blanks from the selection and creates one card per number', async () => {
    render(wrap(<CardDialog open onOpenChange={() => undefined} draft={{ kind: 'cloze', front: 'A mitocôndria produz energia.', noteId: uuidv7(), noteTitle: 'Célula', sourceQuote: 'A mitocôndria produz energia.' }} />));
    const text = (await screen.findByLabelText('Texto com lacunas')) as HTMLTextAreaElement;
    text.setSelectionRange(2, 13);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar lacuna' }));
    expect(text.value).toBe('A {{c1::mitocôndria}} produz energia.');
    text.setSelectionRange(text.value.indexOf('energia'), text.value.indexOf('energia') + 'energia'.length);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar lacuna' }));
    expect(text.value).toBe('A {{c1::mitocôndria}} produz {{c2::energia}}.');
    expect(screen.getByRole('button', { name: 'Criar 2 cartões' })).toBeTruthy();
  });

  it('the settings dialog opens with the saved values and keeps edits (no render loop)', async () => {
    render(wrap(<ReviewSettingsDialog open onOpenChange={() => undefined} />));
    const perDay = (await screen.findByLabelText('Novos por dia')) as HTMLInputElement;
    expect(perDay.value).toBe('20');
    fireEvent.change(perDay, { target: { value: '35' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(perDay.value).toBe('35');
    expect(screen.getByRole('radio', { name: '90%' }).getAttribute('aria-checked')).toBe('true');
  });

  it('approval starts with every suggestion selected and keeps what was unchecked when the list reloads', async () => {
    const at = new Date().toISOString();
    const make = (front: string): ReviewProposal => ({ id: uuidv7(), batchId: uuidv7(), kind: 'basic', origin: 'ai', front, back: 'r', keyPoints: [], sourceQuote: 'trecho da nota', noteId: uuidv7(), noteTitle: 'Nota', topicId: null, createdAt: at });
    const list = [make('Pergunta um'), make('Pergunta dois')];
    vi.spyOn(endpoints.review, 'proposals').mockImplementation(async () => list.map((p) => ({ ...p })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ConfirmProvider>
            <ProposalsPage />
          </ConfirmProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: /Aprovar 2/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Aprovar esta pergunta' })[0]!);
    expect(screen.getByRole('button', { name: /Aprovar 1 e descartar 1/ })).toBeTruthy();
    // A third suggestion arrives (the list reloads with new objects): it starts selected, the unchecked one stays unchecked.
    list.push(make('Pergunta três'));
    await qc.invalidateQueries();
    expect(await screen.findByRole('button', { name: /Aprovar 2 e descartar 1/ })).toBeTruthy();
  });
});
