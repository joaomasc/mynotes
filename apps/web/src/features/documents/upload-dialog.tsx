import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, FileText, RefreshCw, TriangleAlert, Upload, X } from 'lucide-react';
import { ALLOWED_FILE_TYPES } from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/feedback';
import { Field } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { fileSize } from '@/lib/format';
import { qk } from '@/lib/query';
import { ACCEPT_ATTR, uploadNewDocument, validateFile } from '@/lib/uploads';
import { TopicSelect } from '../topics/topic-dialogs';

interface Item {
  key: string;
  file: File;
  progress: number;
  state: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

export function UploadDialog({
  open,
  onOpenChange,
  initialTopicId = null,
  initialFiles,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTopicId?: string | null;
  initialFiles?: File[] | null;
}) {
  const qc = useQueryClient();
  const [topicId, setTopicId] = useState<string | null>(initialTopicId);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const aborts = useRef(new Map<string, AbortController>());

  useEffect(() => {
    if (!open) return;
    setTopicId(initialTopicId);
    setItems([]);
    if (initialFiles?.length) add(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const add = (files: FileList | File[]) => {
    const next: Item[] = [...files].map((file) => {
      const check = validateFile(file);
      return {
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        state: 'error' in check ? 'error' : 'queued',
        ...('error' in check ? { error: check.error } : {}),
      };
    });
    setItems((list) => [...list, ...next]);
  };

  const start = async (item: Item) => {
    const ctrl = new AbortController();
    aborts.current.set(item.key, ctrl);
    patch(item.key, { state: 'uploading', progress: 0, error: undefined });
    try {
      await uploadNewDocument(item.file, topicId, (f) => patch(item.key, { progress: f }), ctrl.signal);
      patch(item.key, { state: 'done', progress: 1 });
      void qc.invalidateQueries({ queryKey: qk.documentsAll });
      void qc.invalidateQueries({ queryKey: qk.topics });
    } catch (err) {
      if ((err as Error).name === 'AbortError') patch(item.key, { state: 'error', error: 'Envio cancelado' });
      else patch(item.key, { state: 'error', error: errorMessage(err) });
    } finally {
      aborts.current.delete(item.key);
    }
  };

  const startAll = async () => {
    for (const item of items) if (item.state === 'queued') await start(item);
  };

  const busy = items.some((i) => i.state === 'uploading');
  const queued = items.filter((i) => i.state === 'queued').length;
  const allDone = items.length > 0 && items.every((i) => i.state === 'done');

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) return;
        onOpenChange(o);
      }}
      title="Enviar documentos"
      description="PDF, imagens, EPUB, DOCX, TXT e Markdown, sem limite prático de tamanho (arquivos grandes são enviados em partes)."
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {allDone ? 'Fechar' : 'Cancelar'}
          </Button>
          {!allDone && (
            <Button variant="primary" loading={busy} disabled={queued === 0} onClick={() => void startAll()} icon={<Upload className="size-4" />}>
              Enviar {queued > 0 ? `(${queued})` : ''}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Assunto" optional>
          {(p) => <TopicSelect {...p} value={topicId} onChange={setTopicId} emptyLabel="Sem assunto" />}
        </Field>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
            dragging ? 'border-accent bg-accent-soft' : 'border-border',
          )}
        >
          <Upload className="mb-2 size-6 text-subtle" aria-hidden />
          <p className="text-sm text-muted">
            Arraste arquivos para cá ou{' '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => input.current?.click()}>
              escolha no dispositivo
            </button>
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) add(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {items.length > 0 && (
          <ul className="space-y-2" aria-live="polite">
            {items.map((item) => (
              <li key={item.key} className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <FileText className="size-4 shrink-0 text-document" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.file.name}</p>
                    <p className="text-xs text-muted">
                      {fileSize(item.file.size)}
                      {item.state === 'uploading' && ` · ${Math.round(item.progress * 100)}%`}
                    </p>
                  </div>
                  {item.state === 'done' && <CircleCheck className="size-5 text-success" aria-label="Enviado" />}
                  {item.state === 'error' && !('error' in validateFile(item.file)) && (
                    <IconButton label="Tentar novamente" size="sm" onClick={() => void start(item)}>
                      <RefreshCw className="size-4" />
                    </IconButton>
                  )}
                  {item.state === 'uploading' ? (
                    <IconButton label="Cancelar envio" size="sm" onClick={() => aborts.current.get(item.key)?.abort()}>
                      <X className="size-4" />
                    </IconButton>
                  ) : item.state !== 'done' ? (
                    <IconButton label="Remover da lista" size="sm" onClick={() => setItems((l) => l.filter((i) => i.key !== item.key))}>
                      <X className="size-4" />
                    </IconButton>
                  ) : null}
                </div>
                {item.state === 'uploading' && <Progress value={item.progress * 100} className="mt-2" label={`Enviando ${item.file.name}`} />}
                {item.error && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-danger">
                    <TriangleAlert className="size-3.5" aria-hidden /> {item.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-subtle">
          Visualização no app: {Object.values(ALLOWED_FILE_TYPES).filter((t) => t.preview).map((t) => t.label).join(', ')}. Os demais formatos ficam
          disponíveis para download.
        </p>
      </div>
    </Dialog>
  );
}
