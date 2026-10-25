import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewSettings } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import { useSetting, useUpdateSetting } from '../settings/use-settings';

/** Minutes east of UTC of this device (Brasília: -180). */
export const tzOffset = () => -new Date().getTimezoneOffset();

/** Items for today, streak and AI questions waiting: the sidebar badge, the home card, the review page. */
export function useReviewSummary() {
  const today = todayIso();
  return useQuery({ queryKey: qk.reviewSummary(today), queryFn: () => endpoints.review.summary(today), staleTime: 60_000 });
}

export function useReviewSettings() {
  const { value, isLoading } = useSetting('review');
  const update = useUpdateSetting('review');
  return {
    settings: value,
    isLoading,
    saving: update.isPending,
    save: (patch: Partial<ReviewSettings>) => update.mutateAsync({ ...value, ...patch }),
  };
}

/** Refreshes everything of Revisar (counts, lists, stats) after a change. */
export function useInvalidateReview() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.reviewAll });
    void qc.invalidateQueries({ queryKey: qk.studyAll });
    void qc.invalidateQueries({ queryKey: qk.dashboard });
  };
}

/** Link that opens the review page with these topics selected. */
export const reviewLink = (topicIds: string[]) => (topicIds.length ? `/review?topics=${topicIds.join(',')}` : '/review');

/** Link that starts a session right away. */
export function sessionLink(id: string, o: { topicIds: string[]; mode: string; limit?: number; topicId?: string; noteIds?: string[] }) {
  const q = new URLSearchParams({ mode: o.mode });
  if (o.topicIds.length) q.set('topics', o.topicIds.join(','));
  if (o.limit) q.set('limit', String(o.limit));
  if (o.topicId) q.set('topic', o.topicId);
  if (o.noteIds?.length) q.set('notes', o.noteIds.join(','));
  return `/review/session/${id}?${q.toString()}`;
}
