import type { Editor } from '@tiptap/react';

/**
 * The note editors on screen, most recently used last, so commands from the
 * palette or the keyboard ("Inserir modelo", "Modo de leitura") act on the
 * right one even with several notes open side by side.
 */
export interface ActiveEditor {
  editor: Editor;
  noteId: string;
  /** Switches between editing and reading (only full note pages have it). */
  toggleReading?: () => void;
  title: () => string;
  topicId: string | null;
}

let editors: ActiveEditor[] = [];

export const activeEditor = {
  /**
   * The last editor used, preferring one inside `scope` (the active tab).
   * Without a match in the scope, none: a command must not act on a note in another pane.
   */
  get: (scope?: Element | null): ActiveEditor | null => {
    const live = editors.filter((e) => !e.editor.isDestroyed);
    const pool = scope ? live.filter((e) => scope.contains(e.editor.view.dom)) : live;
    return pool[pool.length - 1] ?? null;
  },
  set: (value: ActiveEditor) => {
    editors = [...editors.filter((e) => e.editor !== value.editor && !e.editor.isDestroyed), value];
  },
  clear: (editor: Editor) => {
    editors = editors.filter((e) => e.editor !== editor);
  },
};
