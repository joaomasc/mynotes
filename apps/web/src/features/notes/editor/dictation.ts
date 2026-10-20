import type { Editor, EditorEvents } from '@tiptap/react';
import { Selection } from '@tiptap/pm/state';
import { toast } from 'sonner';
import { DICTATION_PROMPT_MAX } from '@mynotes/shared';
import { NetworkError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { bytesToBase64 } from '@/lib/encoding';
import { microphoneError, startRecorder, type Recorder } from '@/lib/dictation/recorder';

export type DictationStatus = 'idle' | 'starting' | 'recording' | 'finishing';

export interface DictationState {
  status: DictationStatus;
  /** Seconds recorded in this session. */
  elapsed: number;
  /** Microphone level, 0–1. */
  level: number;
  /** Segments recorded but not yet in the text (including the one being sent). */
  pending: number;
  /** Sending stopped on this error until retry() or discard(). */
  error: string | null;
  /** Sending paused until the connection returns. */
  offline: boolean;
  /** Some text was already inserted in this session. */
  wrote: boolean;
}

const IDLE: DictationState = { status: 'idle', elapsed: 0, level: 0, pending: 0, error: null, offline: false, wrote: false };
/** Long enough for any note; stops a microphone left on by mistake. */
const MAX_SECONDS = 30 * 60;
const LEVEL_INTERVAL_MS = 80;

/**
 * Dictation for one editor: records speech, sends it in segments for
 * transcription (in order) and writes the text where the cursor was when
 * recording started — even if the user keeps editing meanwhile.
 */
export class Dictation {
  private state: DictationState = IDLE;
  private readonly listeners = new Set<() => void>();
  private editor: Editor | null = null;
  /** Insertion point, mapped through every edit. */
  private insertPos = 0;
  private recorder: Recorder | null = null;
  private queue: Promise<string>[] = [];
  private busy = false;
  private startedAt = 0;
  private clock: ReturnType<typeof setInterval> | undefined;
  private lastLevelAt = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private disposed = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<DictationState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private readonly onTransaction = ({ transaction }: EditorEvents['transaction']) => {
    if (transaction.docChanged) this.insertPos = transaction.mapping.map(this.insertPos);
  };

  private readonly onOnline = () => {
    if (this.state.offline) {
      this.set({ offline: false });
      void this.pump();
    }
  };

  attach(editor: Editor): () => void {
    this.editor = editor;
    this.disposed = false;
    editor.on('transaction', this.onTransaction);
    window.addEventListener('online', this.onOnline);
    return () => {
      editor.off('transaction', this.onTransaction);
      window.removeEventListener('online', this.onOnline);
      this.dispose();
    };
  }

  async start(): Promise<void> {
    const editor = this.editor;
    if (!editor || this.state.status !== 'idle') return;
    // At the cursor if the user is writing; otherwise at the end of the text.
    const { doc, selection } = editor.state;
    this.insertPos = editor.isFocused ? selection.to : Selection.atEnd(doc).from;
    this.set({ ...IDLE, status: 'starting' });
    try {
      this.recorder = await startRecorder({
        onSegment: (wav) => this.enqueue(wav),
        onLevel: (level) => {
          const now = performance.now();
          if (now - this.lastLevelAt < LEVEL_INTERVAL_MS) return;
          this.lastLevelAt = now;
          this.set({ level });
        },
        onInterrupted: () => {
          this.recorder = null;
          this.finish();
          toast.warning('A gravação parou: o microfone foi desconectado.');
        },
      });
    } catch (err) {
      this.set(IDLE);
      throw new Error(microphoneError(err), { cause: err });
    }
    if (this.disposed) {
      this.recorder.cancel();
      return;
    }
    this.startedAt = Date.now();
    this.set({ status: 'recording' });
    this.clock = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
      if (elapsed >= MAX_SECONDS) this.stop();
      else if (elapsed !== this.state.elapsed) this.set({ elapsed });
    }, 250);
    // Keep a phone screen on: a sleeping screen would cut the microphone.
    void navigator.wakeLock
      ?.request('screen')
      .then((lock) => {
        if (this.state.status === 'recording') this.wakeLock = lock;
        else void lock.release();
      })
      .catch(() => undefined);
  }

  /** Stops recording; the text of what was said still arrives. */
  stop(): void {
    if (this.state.status !== 'recording') return;
    this.recorder?.stop();
    this.recorder = null;
    this.finish();
  }

  /** Sends the segments again after an error. */
  retry(): void {
    this.set({ error: null, offline: false });
    void this.pump();
  }

  /** Drops the audio that was not transcribed yet. */
  discard(): void {
    this.queue = [];
    this.set({ pending: 0, error: null, offline: false });
    this.settle();
  }

  dispose(): void {
    this.disposed = true;
    this.recorder?.cancel();
    this.recorder = null;
    this.queue = [];
    this.stopClock();
    this.editor = null;
  }

  private finish() {
    this.stopClock();
    this.set({ status: 'finishing', level: 0 });
    this.settle();
  }

  private stopClock() {
    clearInterval(this.clock);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  /** Back to idle once recording ended and every segment is in the text. */
  private settle() {
    if (this.state.status === 'finishing' && this.queue.length === 0 && !this.busy) this.set({ status: 'idle', pending: 0 });
  }

  private enqueue(wav: Uint8Array<ArrayBuffer>) {
    this.queue.push(bytesToBase64(wav, 'audio/wav'));
    this.set({ pending: this.queue.length });
    void this.pump();
  }

  /** Sends segments one at a time, in order, so the text reads in sequence. */
  private async pump(): Promise<void> {
    if (this.busy || this.state.error || this.state.offline) return;
    this.busy = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const item = this.queue[0]!;
        try {
          const audio = await item;
          const { text } = await endpoints.transcriptions.create({ audio, prompt: this.context() });
          if (this.queue[0] !== item) continue; // discarded meanwhile
          this.queue.shift();
          this.insert(text);
          this.set({ pending: this.queue.length });
        } catch (err) {
          if (this.queue[0] !== item) continue;
          if (err instanceof NetworkError || !navigator.onLine) this.set({ offline: true });
          else this.set({ error: errorMessage(err) });
          return;
        }
      }
    } finally {
      this.busy = false;
      this.settle();
    }
  }

  /** The insertion point, moved into text if edits left it between blocks. */
  private position(): number {
    const doc = this.editor!.state.doc;
    const pos = Math.max(0, Math.min(this.insertPos, doc.content.size));
    const $pos = doc.resolve(pos);
    return $pos.parent.inlineContent ? pos : Selection.near($pos).from;
  }

  /** Text just before the insertion point: helps with names and terms already in the note. */
  private context(): string | undefined {
    if (!this.editor || this.editor.isDestroyed) return undefined;
    const pos = this.position();
    const text = this.editor.state.doc.textBetween(Math.max(0, pos - DICTATION_PROMPT_MAX * 2), pos, ' ', ' ').replace(/\s+/g, ' ').trim();
    return text ? text.slice(-DICTATION_PROMPT_MAX) : undefined;
  }

  private insert(text: string) {
    const editor = this.editor;
    if (!text || !editor || editor.isDestroyed) return;
    const pos = this.position();
    const $pos = editor.state.doc.resolve(pos);
    const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 1), $pos.parentOffset, undefined, ' ');
    const after = $pos.parent.textBetween($pos.parentOffset, Math.min($pos.parent.content.size, $pos.parentOffset + 1), undefined, ' ');
    const chunk = `${before && !/\s/.test(before) ? ' ' : ''}${text}${after && !/[\s.,;:!?)]/.test(after) ? ' ' : ''}`;
    this.insertPos = pos;
    // Not focusing: the user may be typing elsewhere in the note.
    editor.chain().insertContentAt(pos, { type: 'text', text: chunk }, { updateSelection: false }).run();
    // The mapping keeps insertPos after the new text (it was inserted right at it).
    if (!this.state.wrote) this.set({ wrote: true });
  }
}
