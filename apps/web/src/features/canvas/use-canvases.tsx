import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { LayoutDashboard, Plus } from 'lucide-react';
import { uuidv7, type GraphEntityType, type MindMapData } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/layout';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { plural, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { defaultSize } from './canvas-model';

export const canvasPath = (id: string) => `/canvas/${id}`;

export interface NewCanvas {
  title: string;
  topicId?: string | null;
  noteId?: string | null;
  /** The topic or note it is created from: it becomes the first card. */
  first?: { type: GraphEntityType; id: string; title: string } | null;
}

/** Creates a canvas and opens it. */
export function useCreateCanvas() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (input: NewCanvas) => {
      const size = input.first ? defaultSize('item', input.first.type) : null;
      const data: MindMapData | undefined =
        input.first && size
          ? {
              nodes: [{ id: 'c-first', kind: 'item', position: { x: -size.width / 2, y: -size.height / 2 }, ...size, label: input.first.title, color: null, ref: input.first, parentId: null }],
              edges: [],
              viewport: null,
            }
          : undefined;
      return endpoints.mindMaps.create({
        id: uuidv7(),
        kind: 'canvas',
        title: input.title.trim() || 'Canvas sem título',
        topicId: input.topicId ?? null,
        noteId: input.noteId ?? null,
        ...(data ? { data } : {}),
      });
    },
    onSuccess: (canvas) => {
      void qc.invalidateQueries({ queryKey: qk.mindMaps });
      void navigate(canvasPath(canvas.id));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Canvases of a topic or of a note, with a button to start one there. */
export function CanvasList({ topicId, noteId, title, compact }: { topicId?: string; noteId?: string; title: string; compact?: boolean }) {
  const filters = topicId ? { kind: 'canvas' as const, topicId } : { kind: 'canvas' as const, noteId };
  const list = useQuery({ queryKey: qk.mindMapList(filters), queryFn: () => endpoints.mindMaps.list(filters) });
  const create = useCreateCanvas();
  const start = () =>
    create.mutate({
      title: `Canvas — ${title || 'Sem título'}`,
      topicId: topicId ?? null,
      noteId: noteId ?? null,
      first: { type: topicId ? 'topic' : 'note', id: (topicId ?? noteId)!, title },
    });
  const items = list.data ?? [];
  return (
    <div className="space-y-2">
      {items.length > 0 &&
        (compact ? (
          <ul className="space-y-1">
            {items.map((c) => (
              <li key={c.id}>
                <Link to={canvasPath(c.id)} className="flex items-center gap-2 truncate text-sm hover:text-accent">
                  <LayoutDashboard className="size-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="truncate">{c.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((c) => (
              <Link key={c.id} to={canvasPath(c.id)} className="rounded-xl border border-border bg-surface px-4 py-3 hover:border-border-strong">
                <span className="flex items-center gap-2">
                  <LayoutDashboard className="size-4 shrink-0 text-accent" aria-hidden />
                  <span className="truncate font-medium">{c.title}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {plural(c.nodeCount, 'cartão', 'cartões')} · editado {relativeTime(c.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        ))}
      {compact || items.length > 0 ? (
        <button type="button" onClick={start} disabled={create.isPending} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
          <Plus className="size-3.5" aria-hidden /> Novo canvas
        </button>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed px-4 py-3">
          <p className="text-sm text-muted">Um quadro livre para organizar este assunto: cartões de texto, notas, subassuntos, links e grupos.</p>
          <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} loading={create.isPending} onClick={start}>
            Criar canvas
          </Button>
        </Card>
      )}
    </div>
  );
}
