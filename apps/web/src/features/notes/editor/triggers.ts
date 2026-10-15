import { Extension } from '@tiptap/react';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TAG_PATTERN, normalizeTag } from '@mynotes/shared';

/** An open "/" (reference) or "#" (tag) prompt at the cursor. */
export interface Trigger {
  char: '/' | '#';
  /** Range of the trigger character plus the typed query. */
  from: number;
  to: number;
  query: string;
}

export interface TriggerStorage {
  /** Set by the suggestion menu to follow the prompt. */
  onChange: ((trigger: Trigger | null) => void) | null;
  /** Keys pressed while a prompt is open (arrows, Enter, Escape…). */
  onKeyDown: ((event: KeyboardEvent) => boolean) | null;
}

const key = new PluginKey<{ dismissed: number | null; tags: DecorationSet }>('mynotes-triggers');

// A trigger starts the text or follows a space, a line break, an inline node
// (a reference chip) or opening punctuation, so "e/ou", "http://", "C#" and
// "#1" never open a prompt. "/" allows spaces (titles have them) but not a
// leading one; "#" allows none.
const OPEN = `(?:^|[\\s(\\[{"'“‘\\ufffc])`;
const SLASH = new RegExp(`${OPEN}/((?:[^\\s/\\ufffc][^/\\ufffc\\n]{0,139})?)$`, 'u');
/** "/pagina.…", "/livro.…": an explicit kind, so even a long title is a search, not prose. */
const KIND_PREFIX = /^\p{L}+\./u;
const HASH = new RegExp(`${OPEN}#((?:\\p{L}[\\p{L}\\p{N}_-]{0,49})?)$`, 'u');

/** Line breaks (Shift+Enter, common in pasted text) read as "\n"; other inline nodes as one placeholder. */
const leafText = (node: PMNode) => (node.type.name === 'hardBreak' ? '\n' : '￼');

function findTrigger(state: EditorState): Trigger | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $pos = selection.$from;
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  if ($pos.marks().some((m) => m.type.name === 'code')) return null;
  // Inside a link's text, not just at its end: autolinked links extend over
  // whatever is typed right after them, which must not disable the prompt.
  const inLink = (marks: readonly { type: { name: string } }[] | undefined) => !!marks?.some((m) => m.type.name === 'link');
  if (inLink($pos.marks()) && inLink($pos.nodeAfter?.marks)) return null;
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 160), $pos.parentOffset, '\n', leafText);
  for (const [char, re] of [['/', SLASH], ['#', HASH]] as const) {
    const m = re.exec(before);
    if (!m) continue;
    const query = m[1] ?? '';
    // Long "/" phrases are prose, not a search (unless they name a kind).
    if (char === '/' && !KIND_PREFIX.test(query) && (query.split(' ').length > 7 || query.length > 60)) return null;
    return { char, query, from: selection.from - query.length - 1, to: selection.from };
  }
  return null;
}

/** Inline decorations for `#tags` (ignoring code), clickable through `data-tag`. */
function tagDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (parent?.type.spec.code) return false;
    if (!node.isText || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return true;
    for (const match of node.text!.matchAll(TAG_PATTERN)) {
      const start = pos + match.index! + match[1]!.length;
      const tag = normalizeTag(match[2]!);
      decorations.push(
        Decoration.inline(start, start + match[2]!.length + 1, {
          class: 'tag-chip',
          'data-tag': tag,
          title: `#${tag} — Ctrl+clique para ver os conteúdos com esta tag`,
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** Detects "/" and "#" prompts and decorates tags. The menu UI is React (reference-menu.tsx). */
export const Triggers = Extension.create<object, TriggerStorage>({
  name: 'triggers',
  addStorage() {
    return { onChange: null, onKeyDown: null };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    let current: Trigger | null = null;
    return [
      new Plugin({
        key,
        state: {
          init: (_config, state) => ({ dismissed: null as number | null, tags: tagDecorations(state.doc) }),
          apply(tr, prev) {
            const meta = tr.getMeta(key) as { dismiss?: number | null } | undefined;
            let dismissed = prev.dismissed;
            if (meta && 'dismiss' in meta) dismissed = meta.dismiss ?? null;
            else if (dismissed !== null && tr.docChanged) {
              // Forget the dismissal once its "/" or "#" is gone (retyping it opens the prompt again).
              const pos = tr.mapping.mapResult(dismissed);
              const char = pos.deleted ? '' : tr.doc.textBetween(pos.pos, Math.min(pos.pos + 1, tr.doc.content.size));
              dismissed = char === '/' || char === '#' ? pos.pos : null;
            }
            return { dismissed, tags: tr.docChanged ? tagDecorations(tr.doc) : prev.tags };
          },
        },
        view: () => ({
          update: (view) => {
            const found = view.editable ? findTrigger(view.state) : null;
            const next = found && key.getState(view.state)?.dismissed === found.from ? null : found;
            if (next?.from === current?.from && next?.query === current?.query && next?.char === current?.char) return;
            current = next;
            storage.onChange?.(next);
          },
          destroy: () => storage.onChange?.(null),
        }),
        props: {
          decorations: (state) => key.getState(state)?.tags,
          handleKeyDown: (_view, event) => (current ? (storage.onKeyDown?.(event) ?? false) : false),
        },
      }),
    ];
  },
});

/** Closes the prompt at `from` without touching the text ("keep as plain text"). */
export function dismissTrigger(view: { state: EditorState; dispatch: (tr: EditorState['tr']) => void }, from: number): void {
  view.dispatch(view.state.tr.setMeta(key, { dismiss: from }));
}
