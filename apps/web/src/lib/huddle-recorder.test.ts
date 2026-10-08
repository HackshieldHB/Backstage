import { describe, it, expect, vi } from 'vitest';
import { extensionFor, formatDuration, HuddleRecorder, pickMimeType, recordingSupported } from './huddle-recorder';

/** Minimal fakes for Web Audio + MediaRecorder (jsdom has neither). */
function fakeEnv() {
  const connections: string[] = [];
  const disconnected: string[] = [];
  let closed = false;
  const recorders: FakeRecorder[] = [];

  class FakeAudioContext {
    createMediaStreamDestination() {
      return { stream: { id: 'mix' } };
    }
    createMediaStreamSource(stream: { id: string }) {
      return {
        connect: () => connections.push(stream.id),
        disconnect: () => disconnected.push(stream.id),
      };
    }
    close() {
      closed = true;
      return Promise.resolve();
    }
  }
  class FakeRecorder {
    static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
    state: 'inactive' | 'recording' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(
      public stream: unknown,
      public options: { mimeType?: string; audioBitsPerSecond?: number },
    ) {
      recorders.push(this);
    }
    get mimeType() {
      return this.options.mimeType ?? '';
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['tail']) });
      this.onstop?.();
    }
    emit(size: number) {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
    }
  }
  const env = {
    AudioContext: FakeAudioContext as unknown as typeof AudioContext,
    MediaRecorder: FakeRecorder as unknown as typeof MediaRecorder,
  };
  return { env, connections, disconnected, recorders, isClosed: () => closed };
}

const stream = (id: string, audio = true) =>
  ({ id, getAudioTracks: () => (audio ? [{}] : []) }) as unknown as MediaStream;

describe('HuddleRecorder', () => {
  it('mixes audio streams, follows joins and leaves, and returns a blob', async () => {
    const f = fakeEnv();
    const rec = new HuddleRecorder({ maxBytes: 1000, onLimit: vi.fn() }, f.env);
    rec.start([stream('me'), stream('bob'), stream('screen-only', false)]);
    expect(f.connections).toEqual(['me', 'bob']);
    expect(f.recorders[0].options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48_000 });
    expect(rec.recording).toBe(true);

    rec.sync([stream('me'), stream('carol')]);
    expect(f.disconnected).toEqual(['bob']);
    expect(f.connections).toEqual(['me', 'bob', 'carol']);

    f.recorders[0].emit(100);
    const result = await rec.stop();
    expect(result.mimeType).toBe('audio/webm;codecs=opus');
    expect(result.blob.size).toBe(104); // 100 + "tail"
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(rec.recording).toBe(false);
    expect(f.isClosed()).toBe(true);
    expect(f.disconnected.sort()).toEqual(['bob', 'carol', 'me']);
  });

  it('warns once when nearing the size limit', () => {
    const f = fakeEnv();
    const onLimit = vi.fn();
    const rec = new HuddleRecorder({ maxBytes: 1000, onLimit }, f.env);
    rec.start([stream('me')]);
    f.recorders[0].emit(900);
    expect(onLimit).not.toHaveBeenCalled();
    f.recorders[0].emit(60);
    f.recorders[0].emit(10);
    expect(onLimit).toHaveBeenCalledTimes(1);
  });

  it('refuses without browser support or when started twice', () => {
    expect(() => new HuddleRecorder({ maxBytes: 1, onLimit: vi.fn() }, {})).toThrow(/not supported/);
    expect(recordingSupported({})).toBe(false);
    const f = fakeEnv();
    const rec = new HuddleRecorder({ maxBytes: 1000, onLimit: vi.fn() }, f.env);
    rec.start([]);
    expect(() => rec.start([])).toThrow(/Already/);
    return expect(new HuddleRecorder({ maxBytes: 1, onLimit: vi.fn() }, f.env).stop()).rejects.toThrow(/Not recording/);
  });
});

describe('recorder helpers', () => {
  it('formats durations and picks file extensions', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/webm')).toBe('webm');
    const none = { isTypeSupported: () => false } as unknown as typeof MediaRecorder;
    expect(pickMimeType(none)).toBe('');
  });
});
