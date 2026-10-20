import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { BookOpen } from 'lucide-react';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';
import { readerSync, useReaderSync } from './reader-sync';
import { ReadingSections, type Tab } from './reading-page';

/**
 * A book's annotations, review and "about" in a pane of their own, beside
 * its maximized PDF: they follow the page being read and the selected text,
 * and clicking an annotation's page moves the PDF there.
 */
export function Component() {
  const { id = '' } = useParams();
  const sync = useReaderSync(id);
  const [tab, setTab] = useState<Tab>('annotations');
  const [activeId, setActiveId] = useState<string | null>(null);
  const query = useQuery({ queryKey: qk.reading(id), queryFn: () => endpoints.readings.get(id) });
  const r = query.data;
  const doc = useQuery({
    queryKey: qk.document(r?.documentId ?? ''),
    queryFn: () => endpoints.documents.get(r!.documentId!),
    enabled: !!r?.documentId,
  });

  // A link to an annotation or the review, followed in the book's tab, shows it here.
  const lastFocus = useRef(sync.focus?.seq);
  useEffect(() => {
    const f = sync.focus;
    if (!f || f.seq === lastFocus.current) return;
    lastFocus.current = f.seq;
    setTab(f.section);
    if (f.annotation) setActiveId(f.annotation);
  }, [sync.focus]);

  // The PDF knows its annotations are open here (and doesn't show them twice).
  useEffect(() => {
    readerSync.set(id, { panels: readerSync.get(id).panels + 1 });
    return () => readerSync.set(id, { panels: Math.max(0, readerSync.get(id).panels - 1) });
  }, [id]);

  if (query.isLoading) return <PageLoader />;
  if (!r) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <EmptyState className="mt-16" title="Livro não encontrado" action={<Link to="/library" className="text-accent">Ir para a biblioteca</Link>} />;
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  const hasPdf = !!doc.data && doc.data.mimeType === 'application/pdf';

  return (
    <div className="px-4 py-4">
      <header className="mb-3 flex items-center gap-2 text-sm">
        <BookOpen className="size-4 shrink-0 text-reading" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-semibold">{r.title}</span>
        {sync.page && <span className="shrink-0 text-xs text-muted tabular-nums">p. {sync.page}</span>}
      </header>
      <ReadingSections
        reading={r}
        doc={doc.data}
        hasPdf={hasPdf}
        page={hasPdf ? (sync.page ?? r.currentPage) : r.currentPage}
        selection={sync.selection}
        onJump={(page) => readerSync.jump(id, page)}
        tab={tab}
        setTab={setTab}
        activeId={activeId}
        setActiveId={setActiveId}
      />
    </div>
  );
}
