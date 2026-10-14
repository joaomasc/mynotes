import { useEffect } from 'react';
import { endpoints } from '@/lib/api/endpoints';

/** Records that an item was opened (feeds "continue where you left off"). Best effort. */
export function useRecordView(type: string, id: string | undefined, ready: boolean): void {
  useEffect(() => {
    if (!id || !ready) return;
    const t = setTimeout(() => void endpoints.activity.view(type, id).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [type, id, ready]);
}
