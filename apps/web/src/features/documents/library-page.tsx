import { useEffect, useState, type DragEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { LibraryBig, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, ListSkeleton } from '@/components/ui/feedback';
import { Segmented, Select } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { fileSize, relativeTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { TopicChip } from '../shared/topic-breadcrumb';
import { useTopics } from '../topics/use-topics';
import { DocIcon, docTypeLabel } from './doc-icon';
import { UploadDialog } from './upload-dialog';

export function Component() {
  const [params, setParams] = useSearchParams();
  const { tree } = useTopics();
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebounced(q.trim(), 250);
  const type = params.get('type') ?? '';
  const topicId = params.get('topic') ?? '';
  const [upload, setUpload] = useState<{ files?: File[] } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (params.get('upload') === '1') {
      setUpload({});
      const next = new URLSearchParams(params);
      next.delete('upload');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const docs = useInfiniteQuery({
    queryKey: qk.documents({ q: query, type, topicId, infinite: true }),
    queryFn: ({ pageParam }) =>
      endpoints.documents.list({
        ...(query ? { q: query } : {}),
        ...(type ? { type } : {}),
        ...(topicId ? { topicId } : {}),
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const items = docs.data?.pages.flatMap((p) => p.data) ?? [];

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) setUpload({ files: [...e.dataTransfer.files] });
  };

  return (
    <Page
      className={cn(dragging && 'rounded-xl outline-2 outline-offset-4 outline-accent outline-dashed')}
    >
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        <PageHeader
          title="Biblioteca"
          subtitle="PDFs, livros, artigos e outros arquivos, armazenados de forma privada."
          actions={
            <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setUpload({})}>
              Enviar
            </Button>
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por título, nome do arquivo ou descrição"
              aria-label="Buscar documentos"
              className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 sm:h-9 sm:text-sm"
            />
          </div>
          <Segmented
            label="Tipo"
            value={type as '' | 'pdf' | 'image' | 'other'}
            onChange={(v) => update('type', v)}
            options={[
              { value: '', label: 'Todos' },
              { value: 'pdf', label: 'PDF' },
              { value: 'image', label: 'Imagens' },
              { value: 'other', label: 'Outros' },
            ]}
          />
          <div className="w-52">
            <Select aria-label="Assunto" value={topicId} onChange={(e) => update('topic', e.target.value)}>
              <option value="">Todos os assuntos</option>
              <option value="none">Sem assunto</option>
              {tree.flat.map((t) => (
                <option key={t.id} value={t.id}>
                  {'  '.repeat(t.depth)}
                  {t.title}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {docs.isLoading ? (
          <ListSkeleton rows={5} />
        ) : docs.isError && items.length === 0 ? (
          <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<LibraryBig />}
            title={query || type || topicId ? 'Nenhum documento encontrado' : 'Sua biblioteca está vazia'}
            description="Envie PDFs e outros arquivos — você também pode arrastá-los para esta página."
            action={
              <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setUpload({})}>
                Enviar arquivos
              </Button>
            }
          />
        ) : (
          <>
            <Card className="divide-y divide-border overflow-hidden">
              {items.map((d) => (
                <Link key={d.id} to={`/library/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                    <DocIcon mime={d.mimeType} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{d.title}</span>
                      {d.status === 'pending' && <Badge tone="warning">arquivo pendente</Badge>}
                      {d.status === 'failed' && <Badge tone="danger">falha no envio</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span>{docTypeLabel(d.mimeType)}</span>
                      <span aria-hidden>·</span>
                      <span>{fileSize(d.sizeBytes)}</span>
                      <span aria-hidden>·</span>
                      <span>{relativeTime(d.createdAt)}</span>
                      {d.topicId && <TopicChip topicId={d.topicId} link={false} />}
                    </div>
                  </div>
                </Link>
              ))}
            </Card>
            {docs.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" loading={docs.isFetchingNextPage} onClick={() => void docs.fetchNextPage()}>
                  Carregar mais
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <UploadDialog
        open={!!upload}
        onOpenChange={(o) => !o && setUpload(null)}
        initialTopicId={params.get('topicId') ?? (topicId && topicId !== 'none' ? topicId : null)}
        initialFiles={upload?.files ?? null}
      />
    </Page>
  );
}
