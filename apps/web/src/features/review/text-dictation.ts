import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { microphoneError, startRecorder, type Recorder } from '@/lib/dictation/recorder';
import { bytesToBase64 } from '@/lib/encoding';

export type TextDictationStatus = 'idle' | 'starting' | 'recording' | 'finishing';

/**
 * Dictation into a plain text field (answers to questions and free recall):
 * the same recorder and transcription as the note editor, the text of each
 * segment appended in order.
 */
export function useTextDictation(append: (text: string) => void) {
  const [status, setStatus] = useState<TextDictationStatus>('idle');
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const appendRef = useRef(append);
  useEffect(() => {
    appendRef.current = append;
  }, [append]);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      recorder.current?.cancel();
    },
    [],
  );

  const enqueue = useCallback((wav: Uint8Array<ArrayBuffer>) => {
    setPending((n) => n + 1);
    const audio = bytesToBase64(wav, 'audio/wav');
    chain.current = chain.current.then(async () => {
      try {
        const { text } = await endpoints.transcriptions.create({ audio: await audio });
        if (alive.current && text.trim()) appendRef.current(text.trim());
      } catch (err) {
        if (alive.current) setError(errorMessage(err));
      } finally {
        if (alive.current) setPending((n) => n - 1);
      }
    });
  }, []);

  const start = useCallback(async () => {
    if (recorder.current) return;
    setError(null);
    setStatus('starting');
    try {
      recorder.current = await startRecorder({
        onSegment: (wav) => enqueue(wav),
        onLevel: () => undefined,
        onInterrupted: () => {
          recorder.current = null;
          setStatus('idle');
        },
      });
      setStatus('recording');
    } catch (err) {
      setStatus('idle');
      setError(microphoneError(err));
    }
  }, [enqueue]);

  const stop = useCallback(() => {
    recorder.current?.stop();
    recorder.current = null;
    setStatus('finishing');
    void chain.current.then(() => alive.current && setStatus('idle'));
  }, []);

  return { status, pending, error, start, stop };
}
