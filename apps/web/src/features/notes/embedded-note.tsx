import { forwardRef, useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import type { Note, RichTextDoc } from '@mynotes/shared';
import { Spinner } from '@/components/ui/feedback';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { notesSync } from '@/lib/sync/notes-sync';
import { NoteEditor, useSaveState, type NoteEditorHandle } from './editor/note-editor';
import { justCreatedNotes } from './use-create-note';

/**
 * A note edited inside another page (a book's review or page annotation).
 * Same local-first saving as the note page; on a version conflict it sends
 * the user to the note page, where both versions can be compared.
 */
export const EmbeddedNote = forwardRef<
  NoteEditorHandle,
  { noteId: string; placeholder?: string; hideTitle?: boolean; autoFocus?: boolean; topicId?: string | null }
>(function EmbeddedNote({ noteId, placeholder, hideTitle, autoFocus, topicId }, ref) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: qk.note(noteId), queryFn: ({ signal }) => endpoints.notes.get(noteId, signal), staleTime: 0 });
  const note = query.data;
  const [initial, setInitial] = useState<{ title: string; content: RichTextDoc } | null>(null);
  const [conflict, setConflict] = useState(false);
  // Decided when the note opens (a new annotation): later renders must not change it.
  const [focusOnMount] = useState(!!autoFocus);
  const saveState = useSaveState(noteId);
  const fresh = query.isFetchedAfterMount || justCreatedNotes.has(noteId) || (!!note && (query.isError || !navigator.onLine));

  useEffect(() => {
    if (!note || initial || !fresh) return;
    let cancelled = false;
    void notesSync.getDraft(noteId).then(async (draft) => {
      if (cancelled) return;
      justCreatedNotes.delete(noteId);
      if (!draft) return setInitial({ title: note.title, content: note.content });
      if (draft.status === 'conflict' || draft.baseVersion < note.version) {
        if (draft.status !== 'conflict') await notesSync.markConflict(noteId, note);
        setConflict(true);
        return;
      }
      setInitial({ title: draft.title, content: draft.content });
      void notesSync.save(noteId);
    });
    return () => {
      cancelled = true;
    };
  }, [note, noteId, initial, fresh]);

  useEffect(() => {
    if (saveState === 'conflict') setConflict(true);
  }, [saveState]);

  const getBaseVersion = useCallback(() => qc.getQueryData<Note>(qk.note(noteId))?.version ?? note?.version ?? 1, [qc, noteId, note?.version]);

  if (conflict) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Este texto foi alterado em outro dispositivo.{' '}
          <Link to={`/notes/${noteId}`} className="font-medium underline">
            Abrir para escolher a versão
          </Link>
        </span>
      </p>
    );
  }
  if (!initial) return <Spinner className="mx-auto my-6 size-5" />;
  return (
    <NoteEditor
      key={noteId}
      ref={ref}
      noteId={noteId}
      initialTitle={initial.title}
      initialContent={initial.content}
      getBaseVersion={getBaseVersion}
      autoFocusTitle={false}
      autoFocusContent={focusOnMount}
      hideTitle={hideTitle}
      compact
      placeholder={placeholder}
      topicId={topicId ?? null}
    />
  );
});
