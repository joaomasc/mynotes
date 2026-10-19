import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  BookOpenText,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  LayoutTemplate,
  Link,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Mic,
  Minus,
  Quote,
  Redo2,
  SlidersHorizontal,
  SquareCode,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import type { Dictation } from './dictation';
import { useDictationState } from './dictation-bar';

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
  shortcut,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors sm:size-8',
        'hover:bg-surface-2 hover:text-text disabled:opacity-30',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;

/** Starts or stops dictation (speech to text, in Portuguese). */
function DictationButton({ dictation }: { dictation: Dictation }) {
  const { status } = useDictationState(dictation);
  const recording = status === 'recording';
  return (
    <ToolButton
      label={recording ? 'Parar ditado' : 'Ditar: gravar e transcrever'}
      active={recording}
      disabled={status === 'starting' || status === 'finishing'}
      onClick={() => {
        if (recording) dictation.stop();
        else dictation.start().catch((err: Error) => toast.error(err.message));
      }}
    >
      <Mic className={cn('size-4', recording && 'text-danger')} />
    </ToolButton>
  );
}

export function EditorToolbar({
  editor,
  onLink,
  onInternalLink,
  onTemplate,
  onReading,
  dictation,
}: {
  editor: Editor;
  onLink: () => void;
  onInternalLink: () => void;
  /** Insert a template at the cursor (full note pages). */
  onTemplate?: () => void;
  /** Switch to reading mode (full note pages). */
  onReading?: () => void;
  /** Absent when the browser cannot record. */
  dictation?: Dictation | null;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const i = 'size-4';
  return (
    <div
      role="toolbar"
      aria-label="Formatação"
      className="scrollbar-thin flex items-center gap-0.5 overflow-x-auto"
    >
      {dictation && (
        <>
          <DictationButton dictation={dictation} />
          <Sep />
        </>
      )}
      <ToolButton label="Desfazer" shortcut="Ctrl+Z" disabled={!s.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 className={i} />
      </ToolButton>
      <ToolButton label="Refazer" shortcut="Ctrl+Shift+Z" disabled={!s.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 className={i} />
      </ToolButton>
      <Sep />
      <ToolButton label="Título 1" active={s.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        <Heading1 className={i} />
      </ToolButton>
      <ToolButton label="Título 2" active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2 className={i} />
      </ToolButton>
      <ToolButton label="Título 3" active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        <Heading3 className={i} />
      </ToolButton>
      <Sep />
      <ToolButton label="Negrito" shortcut="Ctrl+B" active={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold className={i} />
      </ToolButton>
      <ToolButton label="Itálico" shortcut="Ctrl+I" active={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic className={i} />
      </ToolButton>
      <ToolButton label="Tachado" active={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough className={i} />
      </ToolButton>
      <ToolButton label="Código" active={s.code} onClick={() => chain().toggleCode().run()}>
        <Code className={i} />
      </ToolButton>
      <Sep />
      <ToolButton label="Lista" active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List className={i} />
      </ToolButton>
      <ToolButton label="Lista numerada" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered className={i} />
      </ToolButton>
      <ToolButton label="Lista de tarefas" active={s.task} onClick={() => chain().toggleTaskList().run()}>
        <ListTodo className={i} />
      </ToolButton>
      <ToolButton label="Citação" active={s.quote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote className={i} />
      </ToolButton>
      <ToolButton label="Bloco de código" active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <SquareCode className={i} />
      </ToolButton>
      <ToolButton label="Linha divisória" onClick={() => chain().setHorizontalRule().run()}>
        <Minus className={i} />
      </ToolButton>
      <Sep />
      <ToolButton label="Link externo" shortcut="Ctrl+K" active={s.link} onClick={onLink}>
        <Link className={i} />
      </ToolButton>
      <ToolButton label="Link para nota, assunto ou documento" shortcut="Ctrl+Shift+K" onClick={onInternalLink}>
        <Link2 className={i} />
      </ToolButton>
      <Sep />
      <ToolButton
        label="Propriedades da nota (status, prazo, fonte…)"
        onClick={() => {
          const first = editor.state.doc.firstChild;
          if (first?.type.name === 'properties') return;
          editor
            .chain()
            .focus()
            .insertContentAt(0, { type: 'properties', attrs: { items: [{ key: 'status', value: '' }] } })
            .run();
        }}
      >
        <SlidersHorizontal className={i} />
      </ToolButton>
      {onTemplate && (
        <ToolButton label="Inserir modelo" shortcut="Alt+Shift+M" onClick={onTemplate}>
          <LayoutTemplate className={i} />
        </ToolButton>
      )}
      {onReading && (
        <ToolButton label="Modo de leitura" shortcut="Ctrl+E" onClick={onReading}>
          <BookOpenText className={i} />
        </ToolButton>
      )}
    </div>
  );
}
