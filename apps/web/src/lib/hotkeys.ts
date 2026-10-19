import { getPref, setPref, usePref } from './prefs';

/**
 * Keyboard shortcuts as text: "Ctrl+Shift+K", "Alt+T", "Alt+ArrowLeft".
 * "Ctrl" means Ctrl on Windows/Linux and ⌘ on macOS. Keys come from the
 * physical key (event.code), so Alt+T works on macOS too (where Alt types "†").
 */

const CODE_KEYS: Record<string, string> = {
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Space: 'Space',
  IntlBackslash: '\\',
};

/** Key name of an event, or null for a lone modifier. */
function keyName(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key; // ArrowLeft, PageDown, Enter, Escape, Tab…
}

export function eventToHotkey(e: KeyboardEvent): string | null {
  const key = keyName(e);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const PRETTY: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', PageUp: 'PgUp', PageDown: 'PgDn' };

/** "Ctrl+Alt+ArrowLeft" → "Ctrl Alt ←" (⌘ ⌥ on macOS). */
export function formatHotkey(hotkey: string): string {
  return hotkey
    .split('+')
    .map((p) => (p === '' ? '+' : p))
    .map((p) => (isMac ? ({ Ctrl: '⌘', Alt: '⌥', Shift: '⇧' }[p] ?? PRETTY[p] ?? p) : (PRETTY[p] ?? p)))
    .join(' ');
}

/** Shortcuts changed by the user: command id → hotkey (null = no shortcut). */
const KEY = 'mynotes:hotkeys';
type Overrides = Record<string, string | null>;
export const useHotkeyOverrides = () => usePref<Overrides>(KEY, {});

export function setHotkey(commandId: string, hotkey: string | null | undefined): void {
  const next = { ...getPref<Overrides>(KEY, {}) };
  if (hotkey === undefined) delete next[commandId];
  else next[commandId] = hotkey;
  setPref(KEY, next);
}

export function resetHotkeys(): void {
  setPref(KEY, {});
}

export function effectiveHotkey(commandId: string, fallback: string | undefined, overrides: Overrides): string | undefined {
  return commandId in overrides ? (overrides[commandId] ?? undefined) : fallback;
}

export const getHotkeyOverrides = (): Overrides => getPref<Overrides>(KEY, {});
