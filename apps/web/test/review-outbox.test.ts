import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewAnswer } from '@mynotes/shared';
import { ApiError, NetworkError } from '@/lib/api/client';

const answer = vi.fn();
vi.mock('@/lib/api/endpoints', () => ({ endpoints: { review: { answer: (...a: unknown[]) => answer(...a) } } }));

const { flushOutbox, sendAnswer } = await import('@/features/review/outbox');

let n = 0;
const body = (rating: 1 | 2 | 3 | 4): ReviewAnswer => ({ id: `0190f0c0-0000-7000-8000-${String(++n).padStart(12, '0')}`, rating, localDay: '2026-10-22' });
const cardId = '0190f0c0-0000-7000-8000-00000000ca7d';

beforeEach(async () => {
  answer.mockReset();
  answer.mockResolvedValue({});
  await flushOutbox();
  answer.mockReset();
});

describe('answers given without internet', () => {
  it('keeps them with the time they were given and sends them in order when the connection returns', async () => {
    answer.mockRejectedValue(new NetworkError());
    const first = body(3);
    const second = body(1);
    expect(await sendAnswer(cardId, first)).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(await sendAnswer(cardId, second)).toBeNull();
    const stamp = (answer.mock.calls[0]![1] as ReviewAnswer).reviewedAt;
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    answer.mockReset();
    answer.mockResolvedValue({ card: {}, log: {} });
    expect(await flushOutbox()).toBe(2);
    expect(answer.mock.calls.map((c) => (c[1] as ReviewAnswer).id)).toEqual([first.id, second.id]);
    // The time of the answer is kept, not the time it was sent.
    expect((answer.mock.calls[0]![1] as ReviewAnswer).reviewedAt).toBe(stamp);
    expect(await flushOutbox()).toBe(0);
  });

  it('stops at the first network failure and drops answers the server refuses for good', async () => {
    answer.mockRejectedValue(new NetworkError());
    await sendAnswer(cardId, body(3));
    await sendAnswer(cardId, body(3));
    answer.mockReset();
    answer.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Cartão não encontrado')).mockRejectedValueOnce(new NetworkError());
    expect(await flushOutbox()).toBe(0);
    // The refused one is gone; the other waits.
    answer.mockReset();
    answer.mockResolvedValue({});
    expect(await flushOutbox()).toBe(1);
  });

  it('other errors are not kept: the session shows them', async () => {
    answer.mockRejectedValue(new ApiError(400, 'bad_request', 'Resposta antiga demais'));
    await expect(sendAnswer(cardId, body(2))).rejects.toThrow('Resposta antiga demais');
    answer.mockReset();
    expect(await flushOutbox()).toBe(0);
    expect(answer).not.toHaveBeenCalled();
  });
});
