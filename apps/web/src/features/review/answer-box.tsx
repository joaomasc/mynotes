import { useCallback } from 'react';
import { LoaderCircle, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { dictationSupported } from '@/lib/dictation/recorder';
import { useTextDictation } from './text-dictation';

/** A text answer that can also be spoken (explaining out loud is the Feynman technique). */
export function AnswerBox({
  value,
  onChange,
  rows = 6,
  placeholder,
  label,
  disabled,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  label: string;
  disabled?: boolean;
  /** Ctrl+Enter. */
  onSubmit?: () => void;
}) {
  const append = useCallback((text: string) => onChange(value ? `${value}${/\s$/.test(value) ? '' : ' '}${text}` : text), [onChange, value]);
  const dictation = useTextDictation(append);
  const recording = dictation.status === 'recording' || dictation.status === 'starting';
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={label}
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {dictationSupported() && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {recording ? (
            <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} onClick={dictation.stop}>
              Parar de falar
            </Button>
          ) : (
            <Button size="sm" variant="outline" icon={<Mic className="size-3.5" />} onClick={() => void dictation.start()} disabled={disabled}>
              Responder falando
            </Button>
          )}
          {dictation.status === 'recording' && <span className="text-danger">Gravando… explique como se ensinasse alguém.</span>}
          {dictation.pending > 0 && (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> transcrevendo…
            </span>
          )}
          {dictation.error && <span className="text-danger">{dictation.error}</span>}
        </div>
      )}
    </div>
  );
}
