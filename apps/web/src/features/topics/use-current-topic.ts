import { useQuery } from '@tanstack/react-query';
import { useMatch } from 'react-router';
import type { Note, Reading } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { useTopics, type TopicNode } from './use-topics';

/**
 * The topic the user is currently working in: the open topic, or the topic of
 * the open note or book. Read from the query cache only (never fetches), so
 * context-aware actions like the sidebar "+" know where new items belong.
 */
export function useCurrentTopic(): TopicNode | null {
  const { tree } = useTopics();
  const topicMatch = useMatch('/topics/:id/*');
  const noteMatch = useMatch('/notes/:id');
  const readingMatch = useMatch('/readings/:id');
  const noteId = noteMatch?.params.id ?? '';
  const readingId = readingMatch?.params.id ?? '';
  const note = useQuery({ queryKey: qk.note(noteId), queryFn: () => endpoints.notes.get(noteId), enabled: false });
  const reading = useQuery({
    queryKey: qk.reading(readingId),
    queryFn: () => endpoints.readings.get(readingId),
    enabled: false,
  });
  const id =
    topicMatch?.params.id ??
    (noteMatch ? (note.data as Note | undefined)?.topicId : undefined) ??
    (readingMatch ? (reading.data as Reading | undefined)?.topicId : undefined) ??
    null;
  return id ? (tree.byId.get(id) ?? null) : null;
}
