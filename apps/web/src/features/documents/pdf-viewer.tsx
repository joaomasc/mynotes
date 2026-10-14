import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { GlobalWorkerOptions, TextLayer, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { IconButton } from '@/components/ui/button';
import { Progress, Spinner } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import './pdf-viewer.css';

GlobalWorkerOptions.workerSrc = workerUrl;
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

interface PageProps {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
  baseSize: { width: number; height: number };
  onVisible: (n: number) => void;
  register: (n: number, el: HTMLDivElement | null) => void;
  /** Number of annotations on this page (shown as a marker). */
  marks?: number | undefined;
}

/** One page: renders canvas + selectable text only when near the viewport. */
function PdfPage({ doc, number, scale, baseSize, onVisible, register, marks }: PageProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(number <= 2);
  const [size, setSize] = useState({ width: baseSize.width * scale, height: baseSize.height * scale });

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setNear(true);
          if (e.intersectionRatio > 0.5) onVisible(number);
        }
      },
      { rootMargin: '800px 0px', threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [number, onVisible]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let text: TextLayer | null = null;
    void (async () => {
      const page: PDFPageProxy = await doc.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width, height: viewport.height });
      const c = canvas.current;
      if (!c) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      renderTask = page.render({
        canvas: c,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      await renderTask.promise.catch(() => undefined);
      if (cancelled || !textLayer.current) return;
      textLayer.current.replaceChildren();
      wrapper.current?.style.setProperty('--total-scale-factor', String(viewport.scale));
      text = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer.current, viewport });
      await text.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      text?.cancel();
    };
  }, [near, doc, number, scale]);

  return (
    <div
      ref={(el) => {
        wrapper.current = el;
        register(number, el);
      }}
      className="pdf-page relative mx-auto bg-white shadow-card"
      style={{ width: size.width, height: size.height }}
      data-page={number}
      aria-label={`Página ${number}${marks ? `, ${marks} anotação(ões)` : ''}`}
      role="img"
    >
      <canvas ref={canvas} className="block" />
      <div ref={textLayer} className="textLayer" />
      {!!marks && (
        <span className="pointer-events-none absolute top-2 -right-2 z-10 rounded-full bg-reading px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-card">
          {marks}
        </span>
      )}
      {!near && <span className="absolute inset-0 flex items-center justify-center text-xs text-subtle">{number}</span>}
    </div>
  );
}

export interface PdfSelection {
  text: string;
  page: number;
}

/** In-app PDF viewer. The file bytes are fetched with authentication by the caller. */
export function PdfViewer({
  data,
  className,
  initialPage,
  goto,
  onPageChange,
  onLoaded,
  markers,
  onSelection,
}: {
  data: ArrayBuffer;
  className?: string;
  /** Page shown when the document opens (e.g. where the reading stopped). */
  initialPage?: number | null | undefined;
  /** Request to show a page; `seq` makes repeated requests for the same page work. */
  goto?: { page: number; seq: number } | null | undefined;
  onPageChange?: ((page: number, total: number) => void) | undefined;
  onLoaded?: ((pages: number) => void) | undefined;
  /** Annotations per page. */
  markers?: Map<number, number> | undefined;
  /** Text selected in the PDF (with its page), or null when the selection is cleared. */
  onSelection?: ((selection: PdfSelection | null) => void) | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const pages = useRef(new Map<number, HTMLDivElement>());
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<number | 'fit'>('fit');
  const [current, setCurrent] = useState(1);
  const [width, setWidth] = useState(800);
  const [goTo, setGoTo] = useState('1');

  useEffect(() => {
    let destroyed = false;
    const task = getDocument({
      // pdf.js transfers the buffer to its worker: give it a copy.
      data: new Uint8Array(data.slice(0)),
      cMapUrl: `${ASSETS}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSETS}standard_fonts/`,
      wasmUrl: `${ASSETS}wasm/`,
    });
    task.promise
      .then(async (pdf) => {
        if (destroyed) return;
        const first = await pdf.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setBaseSize({ width: vp.width, height: vp.height });
        setDoc(pdf);
        onLoadedRef.current?.(pdf.numPages);
      })
      .catch(() => !destroyed && setError('Não foi possível abrir este PDF. Ele pode estar corrompido ou protegido.'));
    return () => {
      destroyed = true;
      void task.destroy();
    };
  }, [data]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveScale = useMemo(() => {
    if (scale !== 'fit') return scale;
    return Math.max(0.3, Math.min(2.5, (width - 32) / baseSize.width));
  }, [scale, width, baseSize.width]);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;

  const onVisible = useCallback((n: number) => {
    setCurrent(n);
    setGoTo(String(n));
  }, []);
  useEffect(() => {
    if (doc) onPageChangeRef.current?.(current, doc.numPages);
  }, [current, doc]);

  // Open at the requested page (instantly: page placeholders already have their size).
  const opened = useRef(false);
  useEffect(() => {
    if (!doc || opened.current) return;
    opened.current = true;
    const target = Math.min(Math.max(1, initialPage ?? 1), doc.numPages);
    if (target > 1) requestAnimationFrame(() => pages.current.get(target)?.scrollIntoView({ block: 'start' }));
  }, [doc, initialPage]);

  useEffect(() => {
    if (!doc || !goto) return;
    const target = Math.min(Math.max(1, goto.page), doc.numPages);
    pages.current.get(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [doc, goto]);

  // Report text selected inside the pages, with the page it belongs to.
  useEffect(() => {
    const onChange = () => {
      const sel = document.getSelection();
      const node = sel && !sel.isCollapsed ? sel.anchorNode : null;
      const pageEl = node && container.current?.contains(node) ? (node.parentElement?.closest('[data-page]') ?? null) : null;
      const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
      onSelectionRef.current?.(pageEl && text ? { text: text.slice(0, 2000), page: Number(pageEl.getAttribute('data-page')) } : null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);
  const register = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) pages.current.set(n, el);
    else pages.current.delete(n);
  }, []);
  const jump = (n: number) => {
    if (!doc) return;
    const target = Math.min(Math.max(1, n), doc.numPages);
    pages.current.get(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const zoom = (factor: number) => setScale(Math.max(0.3, Math.min(4, Math.round(effectiveScale * factor * 100) / 100)));

  if (error) return <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-2 py-1.5">
        <div className="flex items-center gap-1">
          <IconButton label="Página anterior" size="sm" disabled={current <= 1} onClick={() => jump(current - 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              jump(Number.parseInt(goTo, 10) || 1);
            }}
            className="flex items-center gap-1 text-sm text-muted"
          >
            <input
              value={goTo}
              onChange={(e) => setGoTo(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              aria-label="Ir para a página"
              className="h-8 w-12 rounded-md border border-border bg-bg text-center text-sm text-text outline-none focus:border-accent"
            />
            <span>/ {doc?.numPages ?? '…'}</span>
          </form>
          <IconButton label="Próxima página" size="sm" disabled={!doc || current >= doc.numPages} onClick={() => jump(current + 1)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Diminuir zoom" size="sm" onClick={() => zoom(1 / 1.2)}>
            <ZoomOut className="size-4" />
          </IconButton>
          <span className="w-12 text-center text-xs text-muted tabular-nums">{Math.round(effectiveScale * 100)}%</span>
          <IconButton label="Aumentar zoom" size="sm" onClick={() => zoom(1.2)}>
            <ZoomIn className="size-4" />
          </IconButton>
          <IconButton label="Ajustar à largura" size="sm" active={scale === 'fit'} onClick={() => setScale('fit')}>
            <Maximize2 className="size-4" />
          </IconButton>
        </div>
      </div>
      <div ref={container} className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-surface-3/60 p-4">
        {!doc ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner label="Abrindo PDF" />
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={doc}
                number={i + 1}
                scale={effectiveScale}
                baseSize={baseSize}
                onVisible={onVisible}
                register={register}
                marks={markers?.get(i + 1)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DownloadProgress({ fraction }: { fraction: number | null }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <Spinner label="Baixando arquivo" />
      {fraction !== null && <Progress value={fraction * 100} className="max-w-60" label="Baixando arquivo" />}
    </div>
  );
}
