import { describe, expect, it } from 'vitest';
import { shouldPersistQuery } from '@/lib/query';

const q = (key: unknown[], data: unknown, status = 'success') => ({ queryKey: key, state: { status, data } });

describe('persisted query cache', () => {
  it('keeps JSON data for instant and offline startup', () => {
    expect(shouldPersistQuery(q(['notes', {}], { data: [] }))).toBe(true);
    expect(shouldPersistQuery(q(['backlinks', 'reading', 'x'], [{ noteId: 'n', citedPages: [2] }]))).toBe(true);
  });

  it('never saves file contents (they come back as plain objects) or reference titles', () => {
    expect(shouldPersistQuery(q(['document-file', 'd', 1], new ArrayBuffer(8)))).toBe(false);
    expect(shouldPersistQuery(q(['anything'], new Uint8Array(4)))).toBe(false);
    expect(shouldPersistQuery(q(['anything'], new Blob(['x'])))).toBe(false);
    expect(shouldPersistQuery(q(['reference', 'topic', 'x'], { title: 'Antigo' }))).toBe(false);
    expect(shouldPersistQuery(q(['notes'], undefined, 'error'))).toBe(false);
  });
});
