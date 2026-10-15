import { useQuery } from '@tanstack/react-query';
import { normalizeSearch, type GraphEntityType, type Reference } from '@mynotes/shared';
import { endpoints } from './api/endpoints';
import { entityPath } from './entities';
import { qk } from './query';

/* ------------------------------------------------------------ resolver -- */

/**
 * References store only the target's type and id. Their current title (and
 * whether the target still exists) is looked up here, batching the
 * references rendered together into a single request.
 */
let queue = new Map<string, { resolve: (r: Reference) => void; reject: (e: unknown) => void }[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = queue;
  queue = new Map();
  const keys = [...batch.keys()];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    endpoints.references.resolve(chunk).then(
      (refs) => {
        for (const ref of refs) for (const p of batch.get(`${ref.type}:${ref.id}`) ?? []) p.resolve(ref);
      },
      (err: unknown) => {
        for (const key of chunk) for (const p of batch.get(key) ?? []) p.reject(err);
      },
    );
  }
}

export function loadReference(type: GraphEntityType, id: string): Promise<Reference> {
  return new Promise((resolve, reject) => {
    const key = `${type}:${id}`;
    queue.set(key, [...(queue.get(key) ?? []), { resolve, reject }]);
    timer ??= setTimeout(flush, 30);
  });
}

export function useReference(type: GraphEntityType | undefined, id: string | undefined) {
  return useQuery({
    queryKey: qk.reference(type ?? '', id ?? ''),
    queryFn: () => loadReference(type!, id!),
    enabled: !!type && !!id,
    staleTime: 60_000,
  });
}

/* -------------------------------------------------------------- syntax -- */

/**
 * Readable prefixes typed after `/` to narrow the search, e.g.
 * `/assunto.Mercantilismo`, `/livro.O Capital`, `/pagina.O Capital, p. 125`.
 * They only filter: what is stored is the target's id (and the page).
 */
export const REF_KINDS = [
  { prefix: 'assunto', label: 'Assunto', types: 'topic', hint: 'Assunto ou subassunto' },
  { prefix: 'nota', label: 'Nota', types: 'note', hint: 'Notas e resenhas' },
  { prefix: 'livro', label: 'Livro ou leitura', types: 'reading', hint: 'O livro todo (com “, p. 125”, uma página)' },
  { prefix: 'pagina', label: 'Página de livro', types: 'reading,annotation', hint: 'Qualquer página, anotada ou não' },
  { prefix: 'documento', label: 'Documento', types: 'document', hint: 'PDFs e arquivos da biblioteca' },
  { prefix: 'conceito', label: 'Conceito', types: 'concept', hint: 'Conceitos dos assuntos' },
] as const;
export type RefKind = (typeof REF_KINDS)[number];

const ALIASES: Record<string, RefKind['prefix']> = { leitura: 'livro', resenha: 'nota', anotacao: 'pagina' };

export interface ParsedRefQuery {
  kind: RefKind | null;
  /** Search text without prefix and page. */
  text: string;
  /** `#125` / `#p-125` / `p. 125` at the end: page of a book. */
  page: number | null;
}

export function parseRefQuery(query: string): ParsedRefQuery {
  let rest = query;
  let kind: RefKind | null = null;
  const prefix = /^([\p{L}]+)\.(.*)$/u.exec(query);
  if (prefix) {
    const name = normalizeSearch(prefix[1]!);
    const found = REF_KINDS.find((k) => k.prefix === (ALIASES[name] ?? name));
    if (found) {
      kind = found;
      rest = prefix[2]!;
    }
  }
  let page: number | null = null;
  const pages = !kind || kind.prefix === 'livro' || kind.prefix === 'pagina';
  // "#125", "p. 125", "pág. 125" — and, after "/pagina.", also a bare "O Capital 125".
  const marker = kind?.prefix === 'pagina' ? /(?:#\s*p?-?|\bp[aá]?g?\.?\s*|\s)(\d{1,6})\s*$/i : /(?:#\s*p?-?|\bp[aá]?g?\.\s*)(\d{1,6})\s*$/i;
  const pageMatch = pages ? marker.exec(rest) : null;
  if (pageMatch) {
    page = Number(pageMatch[1]) || null;
    rest = rest.slice(0, pageMatch.index);
  } else if (pages) {
    // Page still being typed ("O Capital, p. "): search by the title meanwhile.
    rest = rest.replace(/(?:,\s*|\s+)(?:p[aá]?g?\.?|#)\s*$/i, '');
  }
  return { kind, text: rest.replace(/[\s,]+$/, '').trim(), page };
}

type RefLike = Pick<Reference, 'type' | 'title' | 'role' | 'readingTitle' | 'page' | 'materialType'>;

/** How a reference reads in the text: `/assunto.Mercantilismo`, `/livro.O Capital, p. 125`… */
export function refSyntax(ref: RefLike, page?: number | null): string {
  switch (ref.type) {
    case 'topic':
      return `/assunto.${ref.title}`;
    case 'note':
      if (ref.role === 'annotation') return `/pagina.${ref.readingTitle ?? 'Livro'}${ref.page ? `, p. ${ref.page}` : ''}`;
      if (ref.role === 'review') return `/resenha.${ref.readingTitle ?? ref.title}`;
      return `/nota.${ref.title || 'Sem título'}`;
    case 'reading':
      return `/${ref.materialType === 'book' || !ref.materialType ? 'livro' : 'leitura'}.${ref.title}${page ? `, p. ${page}` : ''}`;
    case 'document':
      return `/documento.${ref.title}`;
    default:
      return `/conceito.${ref.title}`;
  }
}

/** Where clicking a reference goes. Reviews and annotations open in their book. */
export function referencePath(ref: Pick<Reference, 'type' | 'id' | 'role' | 'readingId' | 'page'>, page?: number | null): string {
  if (ref.type === 'note' && ref.readingId && ref.role === 'annotation') {
    return `/readings/${ref.readingId}?${ref.page ? `page=${ref.page}&` : ''}annotation=${ref.id}`;
  }
  if (ref.type === 'note' && ref.readingId && ref.role === 'review') return `/readings/${ref.readingId}?section=review`;
  if (ref.type === 'reading' && page) return `/readings/${ref.id}?page=${page}`;
  return entityPath(ref.type, ref.id);
}
