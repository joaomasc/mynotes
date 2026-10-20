import { Fragment, useMemo } from 'react';
import { MoveDownRight, MoveUpRight, Pause } from 'lucide-react';
import type { SpeechMark, SpeechMarkKind, SpeechWord } from '@mynotes/shared';
import { cn } from '@/lib/cn';
import { clock } from './speaking-ui';

/**
 * The transcript with what the coach found marked on it: fillers, hedges,
 * repetitions, unclear stretches, pauses, endings that rise or fade. Text
 * keeps the text color; marks are backgrounds, underlines and icons, each
 * named in the legend and in the tooltip (never color alone).
 */

const WORD_STYLE: Partial<Record<SpeechMarkKind, string>> = {
  filler: 'rounded bg-danger-soft px-0.5',
  weak: 'rounded bg-warning-soft px-0.5',
  repetition: 'underline decoration-warning decoration-wavy underline-offset-4',
  unclear: 'underline decoration-subtle decoration-dotted decoration-2 underline-offset-4',
};

const LABELS: Record<SpeechMarkKind, string> = {
  filler: 'Vício de linguagem',
  weak: 'Palavra fraca',
  repetition: 'Repetição',
  unclear: 'Trecho pouco claro',
  hesitation: 'Pausa de hesitação',
  blank: 'Branco (silêncio longo)',
  rising: 'Afirmação terminando com o tom subindo',
  drop: 'Volume caindo no fim da frase',
  long: 'Frase longa',
};

const overlaps = (m: SpeechMark, w: SpeechWord) => m.start < w.end - 0.01 && m.end > w.start + 0.01;

export function MarkedTranscript({
  words,
  marks,
  transcript,
  onSeek,
}: {
  words: SpeechWord[];
  marks: SpeechMark[];
  transcript: string;
  /** With a kept recording: clicking a word plays from there. */
  onSeek?: (seconds: number) => void;
}) {
  const layout = useMemo(() => {
    const sorted = [...words].sort((a, b) => a.start - b.start);
    const wordMarks = marks.filter((m) => m.kind !== 'hesitation' && m.kind !== 'blank' && m.kind !== 'long');
    const pauses = marks.filter((m) => m.kind === 'hesitation' || m.kind === 'blank');
    return sorted.map((w, i) => {
      const own = wordMarks.filter((m) => overlaps(m, w));
      // A pause goes before the first word that starts after it.
      const before = pauses.filter((p) => p.end <= w.start + 0.15 && (i === 0 || p.start >= sorted[i - 1]!.end - 0.15));
      return { w, kinds: new Set(own.map((m) => m.kind)), before };
    });
  }, [words, marks]);

  const counts = useMemo(() => {
    const c = new Map<SpeechMarkKind, number>();
    for (const m of marks) if (m.kind !== 'long') c.set(m.kind, (c.get(m.kind) ?? 0) + 1);
    return c;
  }, [marks]);

  if (words.length === 0) return <p className="text-sm leading-relaxed whitespace-pre-wrap">{transcript || 'Nada foi transcrito.'}</p>;

  return (
    <div className="space-y-3">
      {counts.size > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted" aria-label="Legenda">
          {[...counts].map(([kind, n]) => (
            <li key={kind} className="inline-flex items-center gap-1.5">
              <LegendKey kind={kind} />
              {LABELS[kind]} <span className="tabular-nums">({n})</span>
            </li>
          ))}
        </ul>
      )}
      {onSeek && <p className="text-xs text-subtle">Toque numa palavra para ouvir aquele momento.</p>}
      <p className="text-[15px] leading-8">
        {layout.map(({ w, kinds, before }, i) => (
          <Fragment key={i}>
            {before.map((p, k) => (
              <PauseChip key={k} mark={p} />
            ))}
            <span
              className={cn(...[...kinds].map((k) => WORD_STYLE[k]), onSeek && 'cursor-pointer hover:bg-surface-2')}
              title={kinds.size ? `${clock(w.start)} · ${[...kinds].map((k) => LABELS[k]).join(' · ')}` : clock(w.start)}
              onClick={onSeek ? () => onSeek(w.start) : undefined}
            >
              {w.text}
            </span>
            {kinds.has('rising') && <MoveUpRight className="mx-0.5 inline size-3.5 text-warning" aria-label={LABELS.rising} />}
            {kinds.has('drop') && <MoveDownRight className="mx-0.5 inline size-3.5 text-warning" aria-label={LABELS.drop} />}{' '}
          </Fragment>
        ))}
      </p>
    </div>
  );
}

function PauseChip({ mark }: { mark: SpeechMark }) {
  const blank = mark.kind === 'blank';
  return (
    <span
      className={cn(
        'mx-0.5 inline-flex items-center gap-0.5 rounded px-1 align-middle text-[11px] leading-5 font-medium tabular-nums',
        blank ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
      )}
      title={`${clock(mark.start)} · ${LABELS[mark.kind]}`}
    >
      <Pause className="size-3" aria-hidden />
      <span className="sr-only">{LABELS[mark.kind]}: </span>
      {mark.text}
    </span>
  );
}

function LegendKey({ kind }: { kind: SpeechMarkKind }) {
  if (kind === 'hesitation' || kind === 'blank') return <PauseChip mark={{ kind, start: 0, end: 0, text: '' }} />;
  if (kind === 'rising') return <MoveUpRight className="size-3.5 text-warning" aria-hidden />;
  if (kind === 'drop') return <MoveDownRight className="size-3.5 text-warning" aria-hidden />;
  return <span className={cn('text-text', WORD_STYLE[kind])}>abc</span>;
}
