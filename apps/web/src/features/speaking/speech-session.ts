import { createStore, del, entries, get, set } from 'idb-keyval';
import {
  DICTATION_PROMPT_MAX,
  SPEECH_MAX_SECONDS,
  computeSpeechMetrics,
  uuidv7,
  type AcousticFrame,
  type SpeechAttempt,
  type SpeechMode,
  type SpeechSegment,
  type SpeechType,
  type SpeechWord,
} from '@mynotes/shared';
import { NetworkError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { microphoneError, startRecorder, type Recorder } from '@/lib/dictation/recorder';
import { bytesToBase64 } from '@/lib/encoding';
import { todayIso } from '@/lib/format';
import { toTimeline } from '@/lib/speech/analysis';
import { SpeechAnalyzer } from '@/lib/speech/analyzer';

/**
 * One recorded talk: records, transcribes the segments in order while the
 * user speaks, analyzes the audio in a worker and, at the end, computes the
 * metrics and saves the attempt.
 *
 * Every segment and every transcribed piece is kept in IndexedDB until the
 * talk is saved, so a dropped connection or a closed tab loses nothing that
 * was said: an interrupted talk can be recovered (without the voice analysis,
 * which lived in memory).
 */

export interface SpeechSetup {
  mode: SpeechMode;
  speechType: SpeechType;
  topicId: string | null;
  theme: string;
  targetSeconds: number | null;
  /** Terms of the theme (topic title…), which may repeat freely. */
  themeWords: string[];
}

export type SpeechSessionStatus = 'idle' | 'starting' | 'recording' | 'finishing' | 'saving';

export interface SpeechSessionState {
  status: SpeechSessionStatus;
  elapsed: number;
  level: number;
  /** Segments recorded but not transcribed yet. */
  pending: number;
  error: string | null;
  offline: boolean;
  /** Live counters from what was transcribed so far. */
  words: number;
  fillers: number;
}

/** What survives a closed tab. */
interface PendingTalk {
  id: string;
  setup: SpeechSetup;
  startedAt: string;
  localDay: string;
  words: SpeechWord[];
  segments: SpeechSegment[];
  texts: string[];
  /** Recording stopped; only transcription and saving were left. */
  stopped: boolean;
  /** Seconds recorded, for a recovered talk (no audio analysis left). */
  elapsed: number;
}

interface PendingSegment {
  seq: number;
  audio: string;
  start: number;
}

const IDLE: SpeechSessionState = { status: 'idle', elapsed: 0, level: 0, pending: 0, error: null, offline: false, words: 0, fillers: 0 };
const store = createStore('mynotes-speech', 'pending');
const TALK_KEY = 'talk';
const segKey = (seq: number) => `seg:${String(seq).padStart(6, '0')}`;
const LEVEL_INTERVAL_MS = 80;
/** Hesitations written into Whisper's prompt so it keeps them instead of cleaning the speech up. */
const HESITATION_HINT = 'Então, é... tipo, né, hum, eu acho que, assim...';

/** A talk that was interrupted before being saved (tab closed, app crashed). */
export async function pendingTalk(): Promise<{ setup: SpeechSetup; startedAt: string; segments: number } | null> {
  const talk = await get<PendingTalk>(TALK_KEY, store).catch(() => undefined);
  if (!talk) return null;
  const all = await entries<string, PendingSegment>(store).catch(() => []);
  return { setup: talk.setup, startedAt: talk.startedAt, segments: all.filter(([k]) => k.startsWith('seg:')).length };
}

export async function discardPendingTalk(): Promise<void> {
  const all = await entries<string, unknown>(store).catch(() => []);
  await Promise.all(all.map(([k]) => del(k, store)));
}

export class SpeechSession {
  private state: SpeechSessionState = IDLE;
  private readonly listeners = new Set<() => void>();
  private recorder: Recorder | null = null;
  private analyzer: SpeechAnalyzer | null = null;
  private talk: PendingTalk | null = null;
  private seq = 0;
  /** Segments waiting for transcription, in order. */
  private queue: PendingSegment[] = [];
  private busy = false;
  private startedAtMs = 0;
  private clock: ReturnType<typeof setInterval> | undefined;
  private lastLevelAt = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private drained: (() => void) | null = null;
  /** A failed save waits here for retry(). */
  private retryWaiter: (() => void) | null = null;
  /** Segments are encoded one after the other, so they keep their order. */
  private encoding: Promise<void> = Promise.resolve();
  private disposed = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<SpeechSessionState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private readonly onOnline = () => {
    if (this.state.offline) {
      this.set({ offline: false });
      void this.pump();
    }
  };

  constructor() {
    window.addEventListener('online', this.onOnline);
  }

  async start(setup: SpeechSetup): Promise<void> {
    if (this.state.status !== 'idle') return;
    await discardPendingTalk();
    this.set({ ...IDLE, status: 'starting' });
    this.talk = { id: uuidv7(), setup, startedAt: new Date().toISOString(), localDay: todayIso(), words: [], segments: [], texts: [], stopped: false, elapsed: 0 };
    this.seq = 0;
    this.queue = [];
    const analyzer = new SpeechAnalyzer();
    try {
      this.recorder = await startRecorder(
        {
          onSegment: (wav, start) => this.enqueue(wav, start),
          onAudio: (samples) => analyzer.push(samples),
          onLevel: (level) => {
            const now = performance.now();
            if (now - this.lastLevelAt < LEVEL_INTERVAL_MS) return;
            this.lastLevelAt = now;
            this.set({ level });
          },
          onInterrupted: () => {
            this.recorder = null;
            this.set({ error: 'A gravação parou: o microfone foi desconectado. O que já foi dito continua na fala.' });
            void this.stop();
          },
        },
        // Loudness is measured: the browser must not even it out.
        { processing: { autoGainControl: false, echoCancellation: false } },
      );
    } catch (err) {
      analyzer.cancel();
      this.talk = null;
      this.set(IDLE);
      throw new Error(microphoneError(err), { cause: err });
    }
    if (this.disposed) {
      this.recorder.cancel();
      analyzer.cancel();
      return;
    }
    this.analyzer = analyzer;
    await set(TALK_KEY, this.talk, store).catch(() => undefined);
    this.startedAtMs = Date.now();
    this.set({ status: 'recording' });
    this.clock = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startedAtMs) / 1000);
      if (elapsed >= SPEECH_MAX_SECONDS) void this.stop();
      else if (elapsed !== this.state.elapsed) this.set({ elapsed });
    }, 250);
    // A sleeping phone screen would cut the microphone.
    void navigator.wakeLock
      ?.request('screen')
      .then((lock) => {
        if (this.state.status === 'recording') this.wakeLock = lock;
        else void lock.release();
      })
      .catch(() => undefined);
  }

  /**
   * Stops recording, waits for every segment to be transcribed, analyzes and
   * saves the talk. Resolves with the saved attempt.
   */
  async stop(): Promise<SpeechAttempt | null> {
    if (this.state.status !== 'recording' || !this.talk) return null;
    this.recorder?.stop();
    this.recorder = null;
    this.stopClock();
    const elapsed = (Date.now() - this.startedAtMs) / 1000;
    this.talk.stopped = true;
    this.talk.elapsed = elapsed;
    await set(TALK_KEY, this.talk, store).catch(() => undefined);
    this.set({ status: 'finishing', level: 0 });
    const analyzer = this.analyzer;
    this.analyzer = null;
    const framesPromise = analyzer ? analyzer.finish().catch(() => [] as AcousticFrame[]) : Promise.resolve([] as AcousticFrame[]);
    await this.encoding;
    await this.drain();
    if (this.disposed) return null;
    return this.save(await framesPromise);
  }

  /** Throws the talk away (nothing is saved). */
  async cancel(): Promise<void> {
    this.recorder?.cancel();
    this.recorder = null;
    this.analyzer?.cancel();
    this.analyzer = null;
    this.stopClock();
    this.queue = [];
    this.talk = null;
    this.drained?.();
    this.set(IDLE);
    await discardPendingTalk();
  }

  /** Sends the segments again after an error. */
  retry(): void {
    this.set({ error: null, offline: false });
    if (this.retryWaiter) this.retryWaiter();
    else void this.pump();
  }

  /**
   * Finishes a talk interrupted earlier: transcribes what was left and saves
   * it. The voice analysis was lost with the page, so only the text is judged.
   */
  async recover(): Promise<SpeechAttempt | null> {
    const talk = await get<PendingTalk>(TALK_KEY, store);
    if (!talk || this.state.status !== 'idle') return null;
    this.talk = { ...talk, stopped: true };
    const all = await entries<string, PendingSegment>(store);
    this.queue = all
      .filter(([k]) => k.startsWith('seg:'))
      .map(([, v]) => v)
      .sort((a, b) => a.seq - b.seq);
    this.set({ ...IDLE, status: 'finishing', pending: this.queue.length, words: talk.words.length });
    void this.pump();
    await this.drain();
    return this.save([]);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('online', this.onOnline);
    this.recorder?.cancel();
    this.analyzer?.cancel();
    this.stopClock();
    this.drained?.();
    this.retryWaiter?.();
  }

  private stopClock() {
    clearInterval(this.clock);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  private enqueue(wav: Uint8Array<ArrayBuffer>, start: number) {
    const seq = this.seq++;
    this.set({ pending: this.state.pending + 1 });
    this.encoding = this.encoding.then(async () => {
      const item: PendingSegment = { seq, audio: await bytesToBase64(wav, 'audio/wav'), start };
      if (!this.talk) return;
      this.queue.push(item);
      await set(segKey(seq), item, store).catch(() => undefined);
      void this.pump();
    });
  }

  private drain(): Promise<void> {
    if (this.queue.length === 0 && !this.busy) return Promise.resolve();
    return new Promise((resolve) => {
      this.drained = () => {
        this.drained = null;
        resolve();
      };
    });
  }

  /** Text said just before (continuity of names and punctuation), after the hesitation hint. */
  private prompt(): string {
    const room = DICTATION_PROMPT_MAX - HESITATION_HINT.length - 1;
    const tail = (this.talk?.texts.join(' ') ?? '').slice(-room);
    return tail ? `${HESITATION_HINT} ${tail}` : HESITATION_HINT;
  }

  /** Transcribes segments one at a time, in order. */
  private async pump(): Promise<void> {
    if (this.busy || this.state.error || this.state.offline) return;
    this.busy = true;
    try {
      while (this.queue.length > 0 && this.talk && !this.disposed) {
        const item = this.queue[0]!;
        try {
          const res = await endpoints.transcriptions.create({ audio: item.audio, prompt: this.prompt(), detail: 'words' });
          if (this.queue[0] !== item || !this.talk) continue;
          const talk = this.talk;
          talk.texts.push(res.text);
          talk.words.push(...(res.words ?? []).map((w) => ({ text: w.text.slice(0, 100), start: item.start + w.start, end: item.start + w.end })));
          talk.segments.push(...(res.segments ?? []).map((s) => ({ ...s, text: s.text.slice(0, 2000), start: item.start + s.start, end: item.start + s.end })));
          this.queue.shift();
          await set(TALK_KEY, talk, store).catch(() => undefined);
          await del(segKey(item.seq), store).catch(() => undefined);
          const live = computeSpeechMetrics({ frames: [], words: talk.words, segments: [], targetSeconds: null });
          this.set({ pending: this.queue.length, words: live.wordCount, fillers: live.fillers.count });
        } catch (err) {
          if (this.queue[0] !== item) continue;
          if (err instanceof NetworkError || !navigator.onLine) this.set({ offline: true });
          else this.set({ error: errorMessage(err) });
          return;
        }
      }
    } finally {
      this.busy = false;
      if (this.queue.length === 0) this.drained?.();
    }
  }

  private async save(frames: AcousticFrame[]): Promise<SpeechAttempt | null> {
    const talk = this.talk;
    if (!talk) return null;
    this.set({ status: 'saving', pending: 0 });
    const words = [...talk.words].sort((a, b) => a.start - b.start);
    const metrics = computeSpeechMetrics({
      frames,
      words,
      segments: talk.segments,
      targetSeconds: talk.setup.targetSeconds,
      themeWords: talk.setup.themeWords,
    });
    if (metrics.durationSeconds === 0 && frames.length === 0) metrics.durationSeconds = Math.round(talk.elapsed * 100) / 100;
    for (;;) {
      try {
        const attempt = await endpoints.speech.create({
          id: talk.id,
          mode: talk.setup.mode,
          speechType: talk.setup.speechType,
          topicId: talk.setup.topicId,
          theme: talk.setup.theme,
          startedAt: talk.startedAt,
          localDay: talk.localDay,
          transcript: talk.texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 40_000),
          words,
          segments: talk.segments,
          timeline: toTimeline(frames),
          metrics,
        });
        await discardPendingTalk();
        this.talk = null;
        this.set(IDLE);
        return attempt;
      } catch (err) {
        // Kept in IndexedDB: it can be saved later from the speaking page.
        this.set({ error: `Não foi possível salvar a fala: ${errorMessage(err)}` });
        await new Promise<void>((resolve) => {
          this.retryWaiter = () => {
            this.retryWaiter = null;
            resolve();
          };
        });
        if (this.disposed) return null;
      }
    }
  }
}
