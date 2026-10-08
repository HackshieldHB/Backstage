/**
 * Records a huddle's audio in the browser: every participant's audio (and the
 * local mic) is mixed through Web Audio into one MediaRecorder track. Muted
 * mics stay silent because a disabled track yields silence.
 *
 * Audio only, Opus at ~48 kbps (≈ 0.36 MB/min), so a recording fits in an
 * attachment; it stops itself before `maxBytes` is reached.
 */

export interface RecorderEnv {
  AudioContext: typeof AudioContext;
  MediaRecorder: typeof MediaRecorder;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

export function recordingSupported(env: Partial<RecorderEnv> = browserEnv()): boolean {
  return !!env.AudioContext && !!env.MediaRecorder;
}

function browserEnv(): Partial<RecorderEnv> {
  if (typeof window === 'undefined') return {};
  return {
    AudioContext: window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext,
    MediaRecorder: window.MediaRecorder,
  };
}

export function pickMimeType(MR: typeof MediaRecorder): string {
  return PREFERRED_TYPES.find((t) => MR.isTypeSupported?.(t)) ?? '';
}

export class HuddleRecorder {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt = 0;
  private limitHit = false;
  private readonly env: RecorderEnv;

  constructor(
    private readonly opts: { maxBytes: number; onLimit: () => void },
    env: Partial<RecorderEnv> = browserEnv(),
  ) {
    if (!env.AudioContext || !env.MediaRecorder) throw new Error('Recording is not supported in this browser');
    this.env = env as RecorderEnv;
  }

  get recording(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive';
  }

  start(streams: MediaStream[]) {
    if (this.recorder) throw new Error('Already recording');
    this.ctx = new this.env.AudioContext();
    this.dest = this.ctx.createMediaStreamDestination();
    this.sync(streams);
    const mimeType = pickMimeType(this.env.MediaRecorder);
    this.recorder = new this.env.MediaRecorder(this.dest.stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 48_000,
    });
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0) return;
      this.chunks.push(e.data);
      this.bytes += e.data.size;
      // Leave headroom for the final chunk.
      if (!this.limitHit && this.bytes >= this.opts.maxBytes * 0.95) {
        this.limitHit = true;
        this.opts.onLimit();
      }
    };
    this.startedAt = Date.now();
    this.recorder.start(1000);
  }

  /** Mix in streams that appeared (people joining) and drop ones that left. */
  sync(streams: MediaStream[]) {
    if (!this.ctx || !this.dest) return;
    const wanted = new Map(streams.filter((s) => s.getAudioTracks().length > 0).map((s) => [s.id, s]));
    for (const [id, node] of this.sources) {
      if (!wanted.has(id)) {
        node.disconnect();
        this.sources.delete(id);
      }
    }
    for (const [id, stream] of wanted) {
      if (this.sources.has(id)) continue;
      const node = this.ctx.createMediaStreamSource(stream);
      node.connect(this.dest);
      this.sources.set(id, node);
    }
  }

  /** Stop and return the recording (resolves once the final chunk has been flushed). */
  stop(): Promise<RecordingResult> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('Not recording'));
    return new Promise((resolve) => {
      const finish = () => {
        const mimeType = recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
        const result = {
          blob: new Blob(this.chunks, { type: mimeType }),
          mimeType,
          durationMs: Date.now() - this.startedAt,
        };
        this.teardown();
        resolve(result);
      };
      if (recorder.state === 'inactive') finish();
      else {
        recorder.onstop = finish;
        recorder.stop();
      }
    });
  }

  private teardown() {
    for (const node of this.sources.values()) node.disconnect();
    this.sources.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.dest = null;
    this.recorder = null;
    this.chunks = [];
    this.bytes = 0;
    this.limitHit = false;
  }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}
