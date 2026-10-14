export const nowIso = (): string => new Date().toISOString();

export const isoAfter = (seconds: number, from: number = Date.now()): string =>
  new Date(from + seconds * 1000).toISOString();

export const isoBefore = (seconds: number, from: number = Date.now()): string =>
  new Date(from - seconds * 1000).toISOString();
