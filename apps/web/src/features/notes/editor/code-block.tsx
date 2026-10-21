import { useState } from 'react';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import powershell from 'highlight.js/lib/languages/powershell';
import { Check, Copy } from 'lucide-react';

/**
 * Code blocks like Obsidian's: a language picked in the block's header (or
 * typed after ``` as in Markdown), syntax colors, Tab/Shift+Tab indenting the
 * selected lines and Enter keeping the indentation. The language is the
 * block's `language` attribute, already part of the stored document.
 */

export const lowlight = createLowlight(common);
lowlight.register({ dockerfile, powershell });

/** Languages offered in the picker (any language lowlight knows still highlights). */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: 'bash', label: 'Bash / Shell' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'go', label: 'Go' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'ini', label: 'INI / TOML' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'lua', label: 'Lua' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'php', label: 'PHP' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'python', label: 'Python' },
  { id: 'r', label: 'R' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'scss', label: 'SCSS' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'yaml', label: 'YAML' },
];

const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  html: 'xml',
  svg: 'xml',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  h: 'c',
  yml: 'yaml',
  md: 'markdown',
  ps1: 'powershell',
  ps: 'powershell',
  docker: 'dockerfile',
  kt: 'kotlin',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  toml: 'ini',
};

/** "js" → "javascript" (what the picker shows); unknown names are kept. */
export function canonicalLanguage(language: string | null | undefined): string | null {
  if (!language) return null;
  const lower = language.toLowerCase();
  return ALIASES[lower] ?? lower;
}

const LAST_LANGUAGE_KEY = 'mynotes:code-language';

/** The language of the last block the user set, for the next new block. */
export function lastCodeLanguage(): string | null {
  try {
    return localStorage.getItem(LAST_LANGUAGE_KEY);
  } catch {
    return null;
  }
}

function rememberLanguage(language: string | null) {
  try {
    if (language) localStorage.setItem(LAST_LANGUAGE_KEY, language);
  } catch {
    // private mode: nothing to remember
  }
}

/** One indentation step in each language's usual style. */
function indentUnit(language: string | null): string {
  switch (canonicalLanguage(language)) {
    case 'go':
    case 'makefile':
      return '\t';
    case 'python':
    case 'java':
    case 'csharp':
    case 'c':
    case 'cpp':
    case 'php':
    case 'rust':
    case 'kotlin':
    case 'swift':
    case 'powershell':
      return '    ';
    default:
      return '  ';
  }
}

/** Offsets (inside the code block) where each line touched by the selection starts. */
function selectedLineStarts(state: EditorState): { start: number; text: string; lines: number[] } | null {
  const { $from, $to } = state.selection;
  if ($from.parent.type.name !== 'codeBlock' || !$from.sameParent($to)) return null;
  const text = $from.parent.textContent;
  const from = $from.parentOffset;
  const to = $to.parentOffset;
  const lines = [text.lastIndexOf('\n', from - 1) + 1];
  for (let i = text.indexOf('\n', from); i !== -1 && i < to; i = text.indexOf('\n', i + 1)) lines.push(i + 1);
  return { start: $from.start(), text, lines };
}

function indentLines(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, outdent: boolean): boolean {
  const found = selectedLineStarts(state);
  if (!found) return false;
  const unit = indentUnit(state.selection.$from.parent.attrs.language as string | null);
  const tr = state.tr;
  if (!outdent && state.selection.empty) {
    tr.insertText(unit);
  } else {
    // Last line first, so earlier offsets stay valid.
    for (const line of [...found.lines].reverse()) {
      const pos = found.start + line;
      if (!outdent) {
        tr.insertText(unit, pos);
        continue;
      }
      const lead = /^[ \t]*/.exec(found.text.slice(line))![0];
      const remove = lead.startsWith('\t') ? 1 : Math.min(lead.length, unit === '\t' ? 4 : unit.length);
      if (remove > 0) tr.delete(pos, pos + remove);
    }
  }
  if (tr.docChanged) dispatch?.(tr.scrollIntoView());
  return true;
}

const OPENERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

/** Enter keeps the line's indentation and adds a step after `{`, `[`, `(` or `:`. */
function newlineWithIndent(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined): boolean {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'codeBlock') return false;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  const before = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
  const indent = /^[ \t]*/.exec(before)![0];
  const last = before.trimEnd().slice(-1);
  const language = canonicalLanguage($from.parent.attrs.language as string | null);
  const opens = last in OPENERS || (last === ':' && (language === 'python' || language === 'yaml'));
  if (!indent && !opens) return false;
  const unit = indentUnit(language);
  const tr = state.tr;
  if (last in OPENERS && text[offset] === OPENERS[last]) {
    // Between a pair of brackets: the cursor goes on its own indented line.
    tr.insertText(`\n${indent}${unit}\n${indent}`);
    tr.setSelection(TextSelection.create(tr.doc, $from.pos + 1 + indent.length + unit.length));
  } else {
    tr.insertText(`\n${indent}${opens ? unit : ''}`);
  }
  dispatch?.(tr.scrollIntoView());
  return true;
}

function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = canonicalLanguage(node.attrs.language as string | null);
  const known = !language || CODE_LANGUAGES.some((l) => l.id === language);
  const label = CODE_LANGUAGES.find((l) => l.id === language)?.label ?? language ?? 'Texto simples';

  const copy = () => {
    void navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-bar" contentEditable={false}>
        {editor.isEditable ? (
          <select
            aria-label="Linguagem do bloco de código"
            value={language ?? ''}
            onChange={(e) => {
              const next = e.target.value || null;
              rememberLanguage(next);
              updateAttributes({ language: next });
            }}
            className="code-block-language"
          >
            <option value="">Texto simples</option>
            {!known && <option value={language!}>{language}</option>}
            {CODE_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="code-block-language">{label}</span>
        )}
        <button type="button" onClick={copy} className="code-block-copy" title="Copiar código" aria-label="Copiar código">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent<'code'> as="code" className={language ? `hljs language-${language}` : 'hljs'} />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, {
      // The picker and the copy button handle their own events.
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.('.code-block-bar'),
    });
  },
  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      Tab: ({ editor }) => indentLines(editor.state, editor.view.dispatch, false),
      'Shift-Tab': ({ editor }) => indentLines(editor.state, editor.view.dispatch, true),
      Enter: (props) => newlineWithIndent(props.editor.state, props.editor.view.dispatch) || (parent.Enter?.(props) ?? false),
    };
  },
}).configure({ lowlight, defaultLanguage: null, HTMLAttributes: { spellcheck: 'false' } });
