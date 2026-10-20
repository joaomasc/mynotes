import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { AiAction, AiActionDecision, AiChatResponse, AiConversation } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';

export function useAiStatus() {
  return useQuery({ queryKey: qk.aiStatus, queryFn: endpoints.ai.status, staleTime: 60_000 });
}

export function useAiConversations(enabled = true) {
  return useQuery({ queryKey: qk.aiConversations, queryFn: endpoints.ai.conversations, enabled, staleTime: 30_000 });
}

export function useAiConversation(id: string | null) {
  return useQuery({
    queryKey: qk.aiConversation(id ?? ''),
    queryFn: () => endpoints.ai.conversation(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Adds a turn to the cached conversation (a replayed turn is not duplicated). */
export function mergeTurn(old: AiConversation | undefined, res: AiChatResponse): AiConversation {
  const messages = (old?.messages ?? []).filter((m) => m.id !== res.userMessage.id && m.id !== res.assistantMessage.id);
  const ids = new Set(res.actions.map((a) => a.id));
  return {
    ...res.conversation,
    messages: [...messages, res.userMessage, res.assistantMessage],
    actions: [...(old?.actions ?? []).filter((a) => !ids.has(a.id)), ...res.actions],
  };
}

/** Applies a confirmation/rejection to the cached conversation. */
export function mergeDecision(old: AiConversation | undefined, d: AiActionDecision): AiConversation | undefined {
  if (!old) return old;
  return {
    ...old,
    actions: old.actions.map((a) => (a.id === d.action.id ? d.action : a)),
    messages: d.event && !old.messages.some((m) => m.id === d.event!.id) ? [...old.messages, d.event] : old.messages,
  };
}

/**
 * The assistant changed real data: refresh what the app shows. Lists are
 * refetched; single notes and topics only when they were the ones touched.
 */
export function refreshAfterActions(qc: QueryClient, actions: AiAction[]): void {
  const done = actions.filter((a) => a.status === 'executed');
  if (done.length === 0) return;
  const lists = [qk.topics, qk.notesAll, qk.relationsAll, qk.mindMaps, qk.tagsAll, qk.referencesAll, qk.dashboard, ['graph'], ['topic-context'], ['backlinks'], ['search']];
  for (const queryKey of lists) void qc.invalidateQueries({ queryKey });
  for (const r of done.flatMap((a) => a.results)) {
    if (r.type === 'note') void qc.invalidateQueries({ queryKey: qk.note(r.id) });
    if (r.type === 'topic') void qc.invalidateQueries({ queryKey: qk.topic(r.id) });
    if (r.type === 'mindmap') void qc.invalidateQueries({ queryKey: qk.mindMap(r.id) });
  }
}
