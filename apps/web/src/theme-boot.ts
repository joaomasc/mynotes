/**
 * Applies the theme before React renders to avoid a flash. The preference is
 * a per-device convenience cached in localStorage; the canonical value lives
 * in the server settings and is re-applied after login.
 */
export const THEME_KEY = 'mynotes:theme';

export type ThemePreference = 'system' | 'light' | 'dark';

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePreference): void {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

applyTheme(readThemePreference());
