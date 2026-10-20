import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DAILY_TOPICS, dayIndex, uuidv7, type SpeechPathState, type SpeechPracticeCreate, type TalkTopic } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { todayIso } from '@/lib/format';
import { qk } from '@/lib/query';
import type { SpeechSetup } from './speech-session';

/** State of the speaking path for today (in the user's time zone). */
export function useSpeechPath() {
  const today = todayIso();
  return useQuery({ queryKey: qk.speechPath(today), queryFn: () => endpoints.speech.path(today) });
}

/** Records a practice; the server answers with the XP and the new state. */
export function usePractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<SpeechPracticeCreate, 'id' | 'localDay'>) => endpoints.speech.practice({ ...body, id: uuidv7(), localDay: todayIso() }),
    onSuccess: (result) => {
      qc.setQueryData(qk.speechPath(result.state.today), result.state);
      void qc.invalidateQueries({ queryKey: qk.speechAttempts });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

/** What a talk is about, resolving “from the notes” to today's note (or a general theme without notes). */
export function resolveTopic(topic: TalkTopic, state: SpeechPathState | undefined): { text: string; setup: Pick<SpeechSetup, 'mode' | 'topicId' | 'theme' | 'themeWords'> } {
  if ('text' in topic) return { text: topic.text, setup: { mode: 'free', topicId: null, theme: topic.text, themeWords: [topic.text] } };
  const note = state?.noteTopic;
  if (!note) {
    const text = DAILY_TOPICS[dayIndex(state?.today ?? todayIso(), 13, DAILY_TOPICS.length)]!;
    return { text, setup: { mode: 'free', topicId: null, theme: text, themeWords: [text] } };
  }
  // With a topic, the coach checks the talk against the user's notes on it.
  return {
    text: `${topic.prompt}: ${note.title}`,
    setup: note.topicId
      ? { mode: 'explain', topicId: note.topicId, theme: note.title, themeWords: [note.title] }
      : { mode: 'free', topicId: null, theme: note.title, themeWords: [note.title] },
  };
}
