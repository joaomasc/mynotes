import workletUrl from './capture.worklet.ts?worker&url';
import { Resampler, Segmenter, encodeWav, rms } from './audio';

export interface RecorderHandlers {
  /** A finished segment of speech, as 16 kHz mono WAV, and when it starts (seconds since recording started). */
  onSegment(wav: Uint8Array<ArrayBuffer>, startSeconds: number): void;
  /** Every 16 kHz sample, silence included (speech analysis). */
  onAudio?(samples: Float32Array): void;
  /** Input level, 0–1, a few times per second (for the meter). */
  onLevel(level: number): void;
  /** The microphone went away (unplugged, permission revoked). */
  onInterrupted(): void;
}

export interface Recorder {
  /** Stops and emits the last segment. */
  stop(): void;
  /** Stops and drops audio not yet emitted. */
  cancel(): void;
}

export function dictationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioWorkletNode !== 'undefined'
  );
}

/** User-facing reason why the microphone could not be opened. */
export function microphoneError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permita o uso do microfone para este site (no ícone ao lado do endereço) e tente de novo.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhum microfone encontrado.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'O microfone está sendo usado por outro aplicativo.';
  return 'Não foi possível acessar o microfone.';
}

/**
 * Opens the microphone and streams speech segments. Must be called from a
 * user gesture (Safari only starts audio after one).
 */
export interface RecorderOptions {
  /**
   * Browser audio processing. Dictation keeps the defaults (cleaner text);
   * speaking practice turns automatic gain off, or loudness means nothing.
   */
  processing?: Partial<Pick<MediaTrackConstraints, 'echoCancellation' | 'noiseSuppression' | 'autoGainControl'>>;
}

export async function startRecorder(handlers: RecorderHandlers, options: RecorderOptions = {}): Promise<Recorder> {
  // Created before any await, while the click still counts as a user gesture.
  const context = new AudioContext();
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...options.processing },
    });
    await context.audioWorklet.addModule(workletUrl);
    if (context.state === 'suspended') await context.resume();
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop());
    void context.close();
    throw err;
  }

  const resampler = new Resampler(context.sampleRate);
  const segmenter = new Segmenter();
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'mynotes-capture', { numberOfInputs: 1, numberOfOutputs: 1 });
  let active = true;

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (!active) return;
    handlers.onLevel(Math.min(1, rms(event.data) * 4));
    const samples = resampler.process(event.data);
    for (const segment of segmenter.push(samples)) handlers.onSegment(encodeWav(segment), segmenter.startOf(segment));
    handlers.onAudio?.(samples);
  };
  source.connect(node);
  // Some browsers only run nodes that reach the output; the worklet writes silence.
  node.connect(context.destination);

  const close = () => {
    active = false;
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void context.close();
  };
  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      if (!active) return;
      const last = segmenter.flush();
      close();
      if (last) handlers.onSegment(encodeWav(last), segmenter.startOf(last));
      handlers.onInterrupted();
    });
  }

  return {
    stop() {
      if (!active) return;
      const last = segmenter.flush();
      close();
      if (last) handlers.onSegment(encodeWav(last), segmenter.startOf(last));
    },
    cancel() {
      if (active) close();
    },
  };
}
