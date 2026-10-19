import { EditorContent, useEditor } from '@tiptap/react';
import type { RichTextDoc } from '@mynotes/shared';
import { noteExtensions } from './editor/extensions';

/** A note's content rendered read-only (history, previews, reading mode of embeds). */
export function ReadOnlyDoc({ content, className }: { content: RichTextDoc; className?: string }) {
  const editor = useEditor({
    extensions: noteExtensions(''),
    content,
    editable: false,
    editorProps: { attributes: { class: className ?? 'prose-note' } },
  });
  return <EditorContent editor={editor} />;
}
