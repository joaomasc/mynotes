import { useRef, useState, type PointerEvent } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * One measure across talks (oldest to newest): a single series in the accent
 * color, the reference range as a light band, a crosshair that snaps to the
 * nearest talk and a table view.
 */
export interface TrendPoint {
  date: string;
  value: number;
}

const WIDTH = 600;
const HEIGHT = 120;
const PAD = 8;

export function TrendChart({
  title,
  unit,
  points,
  band,
  digits = 0,
}: {
  title: string;
  unit: string;
  points: TrendPoint[];
  /** Reference range shown behind the line. */
  band?: [number, number];
  digits?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (points.length < 2) {
    return (
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="mt-2 text-sm text-muted">Grave pelo menos duas falas para ver a evolução.</p>
      </div>
    );
  }
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, band?.[0] ?? Infinity);
  const hi = Math.max(...values, band?.[1] ?? -Infinity);
  const span = Math.max(hi - lo, 1e-6);
  const min = lo - span * 0.1;
  const max = hi + span * 0.1;
  const x = (i: number) => (i / (points.length - 1)) * WIDTH;
  const y = (v: number) => PAD + (1 - (v - min) / (max - min)) * (HEIGHT - 2 * PAD);
  const fmt = (v: number) => v.toFixed(digits).replace('.', ',');
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - box.left) / box.width) * (points.length - 1)))));
  };
  const active = hover !== null ? points[hover]! : null;
  const last = points.at(-1)!;
  return (
    <figure className="relative">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-muted tabular-nums">
          última: <span className="font-medium text-text">{fmt(last.value)}</span> {unit}
        </span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block h-28 w-full touch-none" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} aria-hidden>
        {band && <rect x={0} width={WIDTH} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} className="fill-accent-soft" />}
        <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <polyline
          points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={HEIGHT} className="stroke-muted" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-subtle tabular-nums">
        <span>{format(new Date(points[0]!.date), 'd MMM', { locale: ptBR })}</span>
        {band && (
          <span>
            faixa de referência: {fmt(band[0])} a {fmt(band[1])}
          </span>
        )}
        <span>{format(new Date(last.date), 'd MMM', { locale: ptBR })}</span>
      </div>
      {active && (
        <div className="pointer-events-none absolute -top-2 right-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-pop">
          <span className="font-medium tabular-nums">
            {fmt(active.value)} {unit}
          </span>
          <span className="ml-2 text-muted">{format(new Date(active.date), "d 'de' MMM, HH:mm", { locale: ptBR })}</span>
        </div>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-subtle">
            <tr>
              <th className="py-1 font-medium">Fala</th>
              <th className="py-1 font-medium">{title}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {points.map((p, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1">{format(new Date(p.date), 'dd/MM/yyyy HH:mm')}</td>
                <td className="py-1">{fmt(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
