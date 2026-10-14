import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { uuidv7, type Note } from '@mynotes/shared';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';

/**
 * Notes created in this page load. Their cached copy is the server response,
 * so the editor can open without waiting for a refetch (typing right after
 * "+" is not lost). In memory on purpose: a reload must refetch.
 */
export const justCreatedNotes = new Set<string>();

/** Creates an empty note (optionally inside a topic) and opens the editor. */
export function useCreateNote() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (topicId: string | null = null) => endpoints.notes.create({ id: uuidv7(), topicId, title: '' }),
    onSuccess: (note: Note) => {
      qc.setQueryData(qk.note(note.id), note);
      justCreatedNotes.add(note.id);
      void qc.invalidateQueries({ queryKey: qk.notesAll });
      void qc.invalidateQueries({ queryKey: qk.topics });
      void navigate(`/notes/${note.id}`, { state: { focusTitle: true } });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
