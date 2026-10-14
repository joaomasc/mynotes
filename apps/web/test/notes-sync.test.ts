import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteSummary, RichTextDoc } from '@mynotes/shared';
import { ApiError, NetworkError } from '@/lib/api/client';

const update = vi.fn();
vi.mock('@/lib/api/endpoints', () => ({ endpoints: { notes: { update: (...a: unknown[]) => update(...a) } } }));

const { notesSync } = await import('@/lib/sync/notes-sync');
const { syncStatus } = await import('@/lib/sync/status');

const doc = (text: string): RichTextDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const summary = (id: string, version: number): NoteSummary => ({
  id,
  topicId: null,
  title: 't',
  role: 'note',
  readingId: null,
  page: null,
  annotationType: null,
  quote: '',
  excerpt: '',
  wordCount: 1,
  sortKey: 'a0',
  version,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
let n = 0;
const nextId = () => `0190f0c0-0000-7000-8000-${String(++n).padStart(12, '0')}`;

beforeEach(() => {
  update.mockReset();
});

describe('notes sync', () => {
  it('keeps the draft until the server confirms, then deletes it', async () => {
    const id = nextId();
    let resolve!: (s: NoteSummary) => void;
    update.mockReturnValue(new Promise((r) => (resolve = r)));
    await notesSync.edit(id, 3, 'Título', doc('olá'));
    expect(await notesSync.getDraft(id)).toBeTruthy();
    const saving = notesSync.save(id);
    await vi.waitFor(() => expect(notesSync.state(id)).toBe('saving'));
    expect(await notesSync.getDraft(id)).toBeTruthy();
    resolve(summary(id, 4));
    await saving;
    expect(update).toHaveBeenCalledWith(id, { baseVersion: 3, title: 'Título', content: doc('olá') });
    expect(await notesSync.getDraft(id)).toBeUndefined();
    expect(notesSync.state(id)).toBe('saved');
  });

  it('re-sends edits made during a save on top of the new version', async () => {
    const id = nextId();
    let resolve!: (s: NoteSummary) => void;
    update.mockReturnValueOnce(new Promise((r) => (resolve = r))).mockResolvedValueOnce(summary(id, 6));
    await notesSync.edit(id, 4, 'A', doc('primeira'));
    const first = notesSync.save(id);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await notesSync.edit(id, 4, 'A', doc('segunda'));
    resolve(summary(id, 5));
    await first;
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![1]).toEqual({ baseVersion: 5, title: 'A', content: doc('segunda') });
    await vi.waitFor(() => expect(notesSync.state(id)).toBe('saved'));
  });

  it('keeps edits offline and reports the offline state', async () => {
    const id = nextId();
    update.mockRejectedValue(new NetworkError());
    await notesSync.edit(id, 1, 'Offline', doc('texto'));
    await notesSync.save(id);
    expect(notesSync.state(id)).toBe('offline');
    expect((await notesSync.getDraft(id))?.content).toEqual(doc('texto'));
    await vi.waitFor(() => expect(syncStatus.get().pending).toBeGreaterThan(0));
  });

  it('marks conflicts with the server copy and resolves keeping my version', async () => {
    const id = nextId();
    const server = { ...summary(id, 9), content: doc('do celular') } as Note;
    update.mockRejectedValueOnce(new ApiError(409, 'version_conflict', 'conflito', { current: server }));
    await notesSync.edit(id, 7, 'Meu', doc('do notebook'));
    await notesSync.save(id);
    expect(notesSync.state(id)).toBe('conflict');
    const draft = await notesSync.getDraft(id);
    expect(draft?.status).toBe('conflict');
    expect(draft?.server?.version).toBe(9);

    // While in conflict nothing is sent automatically.
    await notesSync.save(id);
    expect(update).toHaveBeenCalledTimes(1);

    update.mockResolvedValueOnce(summary(id, 10));
    await notesSync.resolve(id, 'mine');
    expect(update.mock.calls[1]![1]).toMatchObject({ baseVersion: 9, content: doc('do notebook') });
    expect(await notesSync.getDraft(id)).toBeUndefined();
  });

  it('discards the local draft when choosing the server version', async () => {
    const id = nextId();
    update.mockRejectedValueOnce(new ApiError(409, 'version_conflict', 'conflito', { current: { ...summary(id, 2), content: doc('x') } }));
    await notesSync.edit(id, 1, 'Meu', doc('y'));
    await notesSync.save(id);
    await notesSync.resolve(id, 'server');
    expect(await notesSync.getDraft(id)).toBeUndefined();
    expect(notesSync.state(id)).toBe('saved');
  });
});
