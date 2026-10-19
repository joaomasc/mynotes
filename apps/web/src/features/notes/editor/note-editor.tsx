import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { NOTE_TITLE_MAX, asRichTextDoc, parseInternalHref, type Note, type RichTextDoc } from '@mynotes/shared';
import { BookOpenText, PencilLine } from 'lucide-react';
import { activeEditor } from '@/lib/active-editor';
import { cn } from '@/lib/cn';
import { entityPath } from '@/lib/entities';
import { effectiveHotkey, eventToHotkey, formatHotkey, getHotkeyOverrides } from '@/lib/hotkeys';
import { READING_WIDTHS, usePref, useReadingWidth } from '@/lib/prefs';
import { openModeOf, openPath } from '../../workspace/store';
import { openTemplatePicker } from '../template-picker';
import { dictationSupported } from '@/lib/dictation/recorder';
import { notesSync, writeEmergencyDraft, type SaveState } from '@/lib/sync/notes-sync';
import { Dictation } from './dictation';
import { DictationBar } from './dictation-bar';
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
  const [readingWidth] = useReadingWidth();
  const [defaultMode] = usePref<'edit' | 'read'>('mynotes:note-mode', 'edit');
  // Reading mode (Ctrl+E): the text can't be changed and links open with a plain click. Full note pages only.
  const [reading, setReading] = useState(() => !compact && defaultMode === 'read' && !autoFocusTitle);
  const toggleReading = useRef<() => void>(() => undefined);
  toggleReading.current = () => {
    if (!compact) setReading((r) => !r);
  };

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
      handleClick: (view, _pos, event) => {
        const tag = (event.target as HTMLElement).closest('[data-tag]')?.getAttribute('data-tag');
        if (tag && (event.ctrlKey || event.metaKey || !view.editable)) {
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
          const path = entityPath(internal.type, internal.id);
          const mode = openModeOf(event);
          if (mode === 'same') void navigate(path);
          else openPath(path, mode);
          return true;
        }
        if (event.ctrlKey || event.metaKey || !view.editable) {
          event.preventDefault();
          window.open(href, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        // The reading-mode shortcut wins over the editor's own (Ctrl+E is also "inline code").
        const hotkey = eventToHotkey(event);
        if (!compact && hotkey && hotkey === effectiveHotkey('editor.reading', 'Ctrl+E', getHotkeyOverrides())) {
          event.preventDefault();
          toggleReading.current();
          return true;
        }
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

  // The same note may be open in another pane: while this editor isn't being used, it follows the
  // other one's edits (its local draft, then what the server saved), so it never writes back stale text.
  const qc = useQueryClient();
  useEffect(() => {
    if (!editor) return;
    const idle = () => !dirty.current && !editor.isFocused && document.activeElement !== titleInput.current;
    const apply = (nextTitle: string, content: RichTextDoc) => {
      if (!idle() || editor.isDestroyed) return;
      if (titleRef.current === nextTitle && JSON.stringify(docOf(editor)) === JSON.stringify(asRichTextDoc(content))) return;
      titleRef.current = nextTitle;
      setTitle(nextTitle);
      editor.commands.setContent(content.content?.length ? content : BLANK, { emitUpdate: false });
    };
    const offDraft = notesSync.subscribe(noteId, () => {
      if (!idle()) return;
      void notesSync.getDraft(noteId).then((d) => d && d.status !== 'conflict' && apply(d.title, d.content));
    });
    const offCache = qc.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (event.type !== 'updated' || key[0] !== 'note' || key[1] !== noteId) return;
      const saved = event.query.state.data as Note | undefined;
      // A server copy only replaces the text when nothing local is waiting to be sent.
      if (saved && notesSync.state(noteId) === 'saved') apply(saved.title, saved.content);
    });
    return () => {
      offDraft();
      offCache();
    };
  }, [editor, noteId, qc]);

  // Commands from the palette and the keyboard act on the last editor used.
  const register = useCallback(() => {
    if (!editor) return;
    activeEditor.set({
      editor,
      noteId,
      title: () => titleRef.current,
      topicId: topicId ?? null,
      toggleReading: compact ? undefined : () => toggleReading.current(),
    });
  }, [editor, noteId, topicId, compact]);
  useEffect(() => {
    if (!editor) return;
    if (!compact) register();
    editor.on('focus', register);
    return () => {
      editor.off('focus', register);
      activeEditor.clear(editor);
    };
  }, [editor, register, compact]);

  const shownMode = useRef(reading);
  useEffect(() => {
    if (!editor || compact) return;
    // Without emitting an update: switching modes is not an edit (it must never save the note).
    if (editor.isEditable === reading) editor.setEditable(!reading, false);
    // Back to editing: the cursor goes to the text. Never on mount (it would take focus from other panes).
    if (shownMode.current === reading) return;
    shownMode.current = reading;
    if (!reading) editor.commands.focus();
  }, [editor, reading, compact]);

  // Speech to text, where the browser can record (see dictation.ts).
  const [dictation] = useState(() => (dictationSupported() ? new Dictation() : null));
  useEffect(() => (editor && dictation ? dictation.attach(editor) : undefined), [editor, dictation]);

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
            <EditorToolbar
              editor={editor}
              onLink={() => setLinkDialog('external')}
              onInternalLink={() => setLinkDialog('internal')}
              dictation={dictation}
            />
            {dictation && <DictationBar dictation={dictation} />}
          </div>
        ) : reading ? (
          <div className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-20 -mx-4 flex items-center gap-2 border-b border-border bg-bg/95 px-4 py-1.5 text-xs text-muted backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
            <BookOpenText className="size-4" aria-hidden />
            <span className="flex-1">Modo de leitura</span>
            <button
              type="button"
              onClick={() => setReading(false)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-accent hover:bg-accent-soft"
            >
              <PencilLine className="size-3.5" /> Editar
              <span className="text-subtle">{formatHotkey(effectiveHotkey('editor.reading', 'Ctrl+E', getHotkeyOverrides()) ?? '')}</span>
            </button>
          </div>
        ) : (
          <div className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-20 -mx-4 border-b border-border bg-bg/95 px-3 py-1.5 backdrop-blur sm:-mx-6 sm:px-5 lg:top-0 lg:-mx-8 lg:px-7">
            <EditorToolbar
              editor={editor}
              onLink={() => setLinkDialog('external')}
              onInternalLink={() => setLinkDialog('internal')}
              onTemplate={() => {
                register();
                openTemplatePicker();
              }}
              onReading={() => setReading(true)}
              dictation={dictation}
            />
            {dictation && <DictationBar dictation={dictation} />}
          </div>
        ))}
      <div className={compact ? '' : cn('mx-auto', wide ? 'max-w-5xl' : READING_WIDTHS[readingWidth].className, reading && 'note-reading')}>
        <textarea
          hidden={hideTitle}
          ref={titleInput}
          readOnly={reading}
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
