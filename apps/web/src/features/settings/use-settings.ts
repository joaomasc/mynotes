import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SETTINGS_SCHEMAS, type Setting, type SettingKey, type SettingValue } from '@mynotes/shared';
import { errorMessage, isVersionConflict } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { THEME_KEY, applyTheme, type ThemePreference } from '@/theme-boot';

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: endpoints.settings.list, staleTime: 60_000 });
}

/** Typed value of one setting, with schema defaults when it was never saved. */
export function useSetting<K extends SettingKey>(key: K): { value: SettingValue<K>; setting: Setting | undefined; isLoading: boolean } {
  const { data, isLoading } = useSettings();
  const setting = data?.find((s) => s.key === key);
  const parsed = SETTINGS_SCHEMAS[key].safeParse(setting?.value ?? {});
  const fallback = SETTINGS_SCHEMAS[key].safeParse({});
  return {
    value: (parsed.success ? parsed.data : fallback.success ? fallback.data : {}) as SettingValue<K>,
    setting,
    isLoading,
  };
}

export function useUpdateSetting<K extends SettingKey>(key: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: SettingValue<K>) => {
      const current = (qc.getQueryData<Setting[]>(qk.settings) ?? []).find((s) => s.key === key);
      return endpoints.settings.put(key, value, current?.version);
    },
    onSuccess: (saved) => {
      qc.setQueryData<Setting[]>(qk.settings, (prev = []) => [...prev.filter((s) => s.key !== key), saved]);
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: qk.settings });
      if (!isVersionConflict(err)) toast.error(errorMessage(err));
    },
  });
}

export function setLocalTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
  applyTheme(theme);
}

/** Applies the account's theme on this device whenever settings change. */
export function useSettingsSync(enabled: boolean): void {
  const { data } = useQuery({ queryKey: qk.settings, queryFn: endpoints.settings.list, enabled, staleTime: 60_000 });
  const theme = (data?.find((s) => s.key === 'ui')?.value as { theme?: ThemePreference } | undefined)?.theme;
  useEffect(() => {
    if (theme) setLocalTheme(theme);
  }, [theme]);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      try {
        if ((localStorage.getItem(THEME_KEY) ?? 'system') === 'system') applyTheme('system');
      } catch {
        applyTheme('system');
      }
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
}
