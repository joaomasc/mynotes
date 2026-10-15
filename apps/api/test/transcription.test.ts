import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanTranscript } from '../src/modules/transcriptions/service';
import { api, client, setupOwner } from './helpers';

let token: string;
let http: ReturnType<typeof client>;

beforeEach(async () => {
  token = (await setupOwner()).token;
  http = client(token);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A tiny but well-formed 16 kHz mono WAV (0.1 s of silence). */
function wavBase64(): string {
  const samples = 1600;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, samples * 2, true);
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function stubAi(impl: (model: string, input: Record<string, unknown>) => Promise<unknown>) {
  return vi.spyOn(env.AI, 'run').mockImplementation(impl as never);
}

describe('dictation transcription', () => {
  it('transcribes a WAV segment in Portuguese, with the preceding text as context', async () => {
    const run = stubAi(async () => ({
      text: '  A mais-valia é   o trabalho não pago. ',
      transcription_info: { duration: 3.2 },
    }));
    const res = await http.post('/transcriptions', { audio: wavBase64(), prompt: 'Capítulo 7 de O Capital.' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ text: 'A mais-valia é o trabalho não pago.', durationSeconds: 3.2 });
    expect(run).toHaveBeenCalledOnce();
    const [model, input] = run.mock.calls[0]!;
    expect(model).toBe('@cf/openai/whisper-large-v3-turbo');
    expect(input).toMatchObject({ task: 'transcribe', language: 'pt', vad_filter: true, initial_prompt: 'Capítulo 7 de O Capital.' });
  });

  it('rejects audio that is not WAV and never calls the model', async () => {
    const run = stubAi(async () => ({ text: 'x' }));
    const res = await http.post('/transcriptions', { audio: btoa('GIF89a'.repeat(30)) });
    expect(res.status).toBe(415);
    expect(run).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await api('POST', '/transcriptions', { body: { audio: wavBase64() } });
    expect(res.status).toBe(401);
  });

  it('reports an exhausted daily allocation as a friendly 429', async () => {
    stubAi(async () => {
      throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
    });
    const res = await http.post('/transcriptions', { audio: wavBase64() });
    expect(res.status).toBe(429);
    expect(res.body.error.message).toMatch(/cota diária/);
  });

  it('hides model failures behind a generic message', async () => {
    stubAi(async () => {
      throw new Error('InferenceUpstreamError: internal');
    });
    const res = await http.post('/transcriptions', { audio: wavBase64() });
    expect(res.status).toBe(500);
    expect(res.body.error.message).toMatch(/Não foi possível transcrever/);
  });
});

describe('cleanTranscript', () => {
  it('drops sentences Whisper invents for silence', () => {
    expect(cleanTranscript('Legendas pela comunidade Amara.org')).toBe('');
    expect(cleanTranscript('Obrigado.')).toBe('');
    expect(cleanTranscript('O autor critica Hegel. Inscreva-se no canal! Depois volta a Kant.')).toBe(
      'O autor critica Hegel. Depois volta a Kant.',
    );
  });

  it('keeps real text, including thanks inside a longer passage', () => {
    expect(cleanTranscript('Obrigado ao professor. A tese central é outra.')).toBe('Obrigado ao professor. A tese central é outra.');
    expect(cleanTranscript('Legendas ajudam na leitura.')).toBe('Legendas ajudam na leitura.');
  });
});
