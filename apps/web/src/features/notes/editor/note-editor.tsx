import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useNavigate } from 'react-router';
import { NOTE_TITLE_MAX, asRichTextDoc, parseInternalHref, type RichTextDoc } from '@mynotes/shared';
import { entityPath } from '@/lib/entities';
import { notesSync, writeEmergencyDraft, type SaveState } from '@/lib/sync/notes-sync';
import { noteExtensions } from './extensions';
import { ExternalLinkDialog, InternalLinkDialog } from './link-dialogs';
import { ReferenceMenu } from './reference-menu';
import { EditorToolbar } from './toolbar';

const LOCAL_DELAY = 350;
/** A schema-valid empty body (ProseMirror needs at least one block). */
const BLANK: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const docOf = (editor: Editor): RichTextDoc => asRichTextDoc(editor.getJSON() as RichTextDoc);
const SAVE_DELAY = 1200;

export function useSaveState(noteId: string): SaveState {
  return useSyncExternalStore(
    (l) => notesSync.subscribe(noteId, l),
    () => notesSync.state(noteId),
    () => notesSync.state(noteId),
  );
}

export interface NoteEditorHandle {
  /** Replaces title and content without saving (e.g. after choosing the server version). */
  reset(title: string, content: RichTextDoc): void;
  /** Replaces title and content as a new edit and saves it (e.g. restoring a revision). */
  apply(title: string, content: RichTextDoc): Promise<void>;
  /** Writes pending edits locally and sends them now. */
  flush(): Promise<void>;
  getSnapshot(): { title: string; content: RichTextDoc };
  editor: Editor | null;
}

interface Props {
  noteId: string;
  initialTitle: string;
  initialContent: RichTextDoc;
  /** Version the first local edit is based on. */
  getBaseVersion: () => number;
  autoFocusTitle?: boolean;
  wide?: boolean;
  onTitleChange?: (title: string) => void;
  /** Topic of the note: items created from "/" go there. */
  topicId?: string | null;
  /** Hide the title field (e.g. a book review, titled by its book). */
  hideTitle?: boolean;
  placeholder?: string;
  /** Embedded in another page: smaller, non-sticky toolbar. */
  compact?: boolean;
  /** Focus the body when mounted (new annotation). */
  autoFocusContent?: boolean;
}

/**
 * Rich-text editor with local-first autosave: edits go to IndexedDB within
 * ~350 ms and to the server ~1.2 s after typing stops (see notes-sync.ts).
 */
export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  {
    noteId,
    initialTitle,
    initialContent,
    getBaseVersion,
    autoFocusTitle,
    wide,
    onTitleChange,
    topicId,
    hideTitle,
    placeholder,
    compact,
    autoFocusContent,
  },
  ref,
) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(initialTitle);
  const titleRef = useRef(initialTitle);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const dirty = useRef(false);
  const localTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [linkDialog, setLinkDialog] = useState<'external' | 'internal' | null>(null);

  const editorRef = useRef<Editor | null>(null);

  const persistLocal = useCallback(async () => {
    clearTimeout(localTimer.current);
    const editor = editorRef.current;
    if (!dirty.current || !editor) return;
    dirty.current = false;
    await notesSync.edit(noteId, getBaseVersion(), titleRef.current, docOf(editor));
  }, [noteId, getBaseVersion]);

  const saveSoon = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void notesSync.save(noteId), SAVE_DELAY);
  }, [noteId]);

  const changed = useCallback(() => {
    dirty.current = true;
    clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => {
      void persistLocal().then(saveSoon);
    }, LOCAL_DELAY);
  }, [persistLocal, saveSoon]);

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    await persistLocal();
    await notesSync.save(noteId);
  }, [persistLocal, noteId]);

  const editor = useEditor({
    extensions: noteExtensions(placeholder ?? 'Comece a escrever… Digite / para citar um assunto, nota ou livro e # para uma tag.'),
    content: initialContent.content?.length ? initialContent : BLANK,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: compact ? 'prose-note min-h-[7rem] pb-2' : 'prose-note min-h-[50vh] pb-32',
        'aria-label': 'Conteúdo da nota',
        spellcheck: 'true',
      },
      handleClick: (_view, _pos, event) => {
        const tag = (event.target as HTMLElement).closest('[data-tag]')?.getAttribute('data-tag');
        if (tag && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void navigate(`/search?tag=${encodeURIComponent(tag)}`);
          return true;
        }
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if (!href) return false;
        const internal = parseInternalHref(href);
        if (internal) {
          event.preventDefault();
          void navigate(entityPath(internal.type, internal.id));
          return true;
        }
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          window.open(href, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setLinkDialog(event.shiftKey ? 'internal' : 'external');
          return true;
        }
        return false;
      },
    },
    onUpdate: changed,
  });
  editorRef.current = editor;

  useImperativeHandle(
    ref,
    () => ({
      reset(nextTitle, content) {
        clearTimeout(localTimer.current);
        clearTimeout(saveTimer.current);
        dirty.current = false;
        titleRef.current = nextTitle;
        setTitle(nextTitle);
        editor?.commands.setContent(content, { emitUpdate: false });
      },
      async apply(nextTitle, content) {
        titleRef.current = nextTitle;
        setTitle(nextTitle);
        editor?.commands.setContent(content, { emitUpdate: false });
        dirty.current = true;
        await flush();
      },
      flush,
      getSnapshot: () => ({ title: titleRef.current, content: editor ? docOf(editor) : asRichTextDoc(null) }),
      editor,
    }),
    [editor, flush],
  );

  // Ctrl+S saves immediately; leaving the page or hiding the tab flushes pending edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush();
      }
    };
    // Synchronous safety net: IndexedDB writes may not finish during unload.
    const emergency = () => {
      const editor = editorRef.current;
      if (dirty.current && editor) writeEmergencyDraft(noteId, getBaseVersion(), titleRef.current, docOf(editor));
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        emergency();
        void flush();
      }
    };
    const onUnload = () => {
      emergency();
      void flush();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', emergency);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', emergency);
      void flush();
    };
  }, [flush, noteId, getBaseVersion]);

  useEffect(() => {
    if (!autoFocusTitle) return;
    titleInput.current?.focus();
  }, [autoFocusTitle]);

  useEffect(() => {
    if (!autoFocusContent || !editor) return;
    editor.view.focus();
    editor.commands.focus('end');
  }, [autoFocusContent, editor]);

  // Auto-grow title.
  useEffect(() => {
    const el = titleInput.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  return (
    <div className="min-w-0">
      {editor &&
        (compact ? (
          <div className="-mx-1 mb-1 overflow-x-auto border-b border-border pb-1">
            <EditorToolbar editor={editor} onLink={() => setLinkDialog('external')} onInternalLink={() => setLinkDialog('internal')} />
          </div>
        ) : (
          <div className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-20 -mx-4 border-b border-border bg-bg/95 px-3 py-1.5 backdrop-blur sm:-mx-6 sm:px-5 lg:top-0 lg:-mx-8 lg:px-7">
            <EditorToolbar editor={editor} onLink={() => setLinkDialog('external')} onInternalLink={() => setLinkDialog('internal')} />
          </div>
        ))}
      <div className={compact ? '' : wide ? 'mx-auto max-w-5xl' : 'mx-auto max-w-[46rem]'}>
        <textarea
          hidden={hideTitle}
          ref={titleInput}
          value={title}
          rows={1}
          maxLength={NOTE_TITLE_MAX}
          onChange={(e) => {
            const v = e.target.value.replace(/\n/g, ' ');
            titleRef.current = v;
            setTitle(v);
            onTitleChange?.(v);
            changed();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === title.length)) {
              e.preventDefault();
              editor?.view.focus();
              editor?.commands.focus('start');
            }
          }}
          placeholder={compact ? 'Título (opcional)' : 'Sem título'}
          aria-label="Título da nota"
          className={
            compact
              ? 'mt-1 mb-1 block w-full resize-none overflow-hidden bg-transparent text-base font-semibold outline-none placeholder:text-subtle'
              : 'mt-6 mb-4 block w-full resize-none overflow-hidden bg-transparent text-[1.75rem] leading-tight font-semibold tracking-tight outline-none placeholder:text-subtle sm:text-[2rem]'
          }
        />
        <EditorContent editor={editor} />
      </div>
      {editor && (
        <>
          <ReferenceMenu editor={editor} noteId={noteId} topicId={topicId ?? null} />
          <ExternalLinkDialog editor={editor} open={linkDialog === 'external'} onOpenChange={(o) => !o && setLinkDialog(null)} />
          <InternalLinkDialog
            editor={editor}
            open={linkDialog === 'internal'}
            onOpenChange={(o) => !o && setLinkDialog(null)}
            currentNoteId={noteId}
          />
        </>
      )}
    </div>
  );
});
