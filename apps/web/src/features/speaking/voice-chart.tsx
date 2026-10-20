import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { SpeechTimeline } from '@mynotes/shared';
import { clock } from './speaking-ui';

/**
 * Pitch and loudness along the talk. Two stacked charts sharing the time axis
 * (never one chart with two scales); each is a single series in the accent
 * color, so the title names it and there is no legend. One crosshair moves
 * over both and the readout lists both values.
 */

const WIDTH = 600;
const HEIGHT = 96;
const PAD_Y = 6;

interface Series {
  title: string;
  unit: string;
  values: (number | null)[];
  min: number;
  max: number;
}

/** SVG path with gaps where the value is missing (silence, unvoiced). */
function pathOf(values: (number | null)[], min: number, max: number): string {
  const n = values.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * WIDTH);
  const y = (v: number) => PAD_Y + (1 - (v - min) / Math.max(max - min, 1e-6)) * (HEIGHT - 2 * PAD_Y);
  let d = '';
  let open = false;
  values.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    open = true;
  });
  return d;
}

function niceRange(values: (number | null)[], pad: number): [number, number] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return [0, 1];
  return [Math.floor(Math.min(...present) - pad), Math.ceil(Math.max(...present) + pad)];
}

function Chart({ s, hover, onHover }: { s: Series; hover: number | null; onHover: (i: number | null) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const n = s.values.length;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || n === 0) return;
    onHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };
  const x = hover !== null && n > 1 ? (hover / (n - 1)) * WIDTH : null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-text">{s.title}</span>
        <span className="text-subtle tabular-nums">
          {s.min} a {s.max} {s.unit}
        </span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-24 w-full touch-none overflow-visible"
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => onHover(null)}
        aria-hidden
      >
        <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path
          d={pathOf(s.values, s.min, s.max)}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {x !== null && <line x1={x} x2={x} y1={0} y2={HEIGHT} className="stroke-muted" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

export function VoiceChart({ timeline }: { timeline: SpeechTimeline }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo<Series[]>(() => {
    const [pMin, pMax] = niceRange(timeline.f0, 10);
    const [vMin, vMax] = niceRange(timeline.db, 3);
    return [
      { title: 'Tom da voz', unit: 'Hz', values: timeline.f0, min: pMin, max: pMax },
      { title: 'Volume', unit: 'dB (relativo ao microfone)', values: timeline.db, min: vMin, max: vMax },
    ];
  }, [timeline]);
  const step = timeline.step;
  const total = timeline.db.length * step;
  if (!timeline.f0.some((v) => v !== null)) {
    return <p className="text-sm text-muted">Sem dados de tom e volume para esta fala (a análise do áudio não estava disponível).</p>;
  }
  const value = (v: number | null | undefined, unit: string) => (v == null ? 'silêncio' : `${v} ${unit}`);
  return (
    <figure className="relative space-y-4">
      {series.map((s) => (
        <Chart key={s.title} s={s} hover={hover} onHover={setHover} />
      ))}
      <div className="flex justify-between border-t border-border pt-1.5 text-[11px] text-subtle tabular-nums">
        <span>0:00</span>
        <span>{clock(total)}</span>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-2 right-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-pop">
          <span className="text-muted tabular-nums">{clock(hover * step)}</span>
          <span className="ml-2 font-medium tabular-nums">{value(timeline.f0[hover], 'Hz')}</span>
          <span className="ml-1 text-muted">tom</span>
          <span className="ml-2 font-medium tabular-nums">{value(timeline.db[hover], 'dB')}</span>
          <span className="ml-1 text-muted">volume</span>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Ver dados em tabela (a cada segundo)</summary>
        <div className="mt-2 max-h-60 overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface text-subtle">
              <tr>
                <th className="py-1 font-medium">Tempo</th>
                <th className="py-1 font-medium">Tom (Hz)</th>
                <th className="py-1 font-medium">Volume (dB)</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {timeline.db.map((db, i) =>
                i % Math.round(1 / step) === 0 ? (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1">{clock(i * step)}</td>
                    <td className="py-1">{timeline.f0[i] ?? '—'}</td>
                    <td className="py-1">{db ?? '—'}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
