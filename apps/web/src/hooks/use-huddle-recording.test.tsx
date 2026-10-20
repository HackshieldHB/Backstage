import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { HuddleController } from './use-huddle';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
const pushToast = vi.fn();
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (sel: (s: { pushToast: typeof pushToast }) => unknown) => sel({ pushToast }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

// A controllable fake recorder: records start/sync/stop calls.
const rec = {
  started: [] as string[][],
  synced: [] as string[][],
  stopped: 0,
  onLimit: null as null | (() => void),
};
vi.mock('@/lib/huddle-recorder', async (orig) => {
  const actual = await orig<typeof import('@/lib/huddle-recorder')>();
  class FakeRecorder {
    recording = false;
    constructor(opts: { onLimit: () => void }) {
      rec.onLimit = opts.onLimit;
    }
    start(streams: MediaStream[]) {
      this.recording = true;
      rec.started.push(streams.map((s) => s.id));
    }
    sync(streams: MediaStream[]) {
      rec.synced.push(streams.map((s) => s.id));
    }
    stop() {
      this.recording = false;
      rec.stopped++;
      return Promise.resolve({ blob: new Blob(['audio']), mimeType: 'audio/webm', durationMs: 65_000 });
    }
  }
  return { ...actual, HuddleRecorder: FakeRecorder, recordingSupported: () => true };
});

const s = (id: string) => ({ id }) as MediaStream;

function fakeHuddle(over: Partial<HuddleController> = {}): HuddleController {
  return {
    joined: true,
    activeTarget: { kind: 'channel', id: 'c1' },
    myRole: 'host',
    settings: { waitingRoomEnabled: false, locked: false, whiteboardOn: false, recordingBy: null },
    remoteStreams: { bob: s('bob') },
    remoteScreens: {},
    getLocalStream: () => s('mine'),
    updateSettings: vi.fn(),
    ...over,
  } as unknown as HuddleController;
}

describe('useHuddleRecording', () => {
  beforeEach(() => {
    apiMock.mockReset();
    pushToast.mockReset();
    rec.started = [];
    rec.synced = [];
    rec.stopped = 0;
    apiMock.mockImplementation(async (_m: string, path: string) => (path.endsWith('/attachments') ? { id: 'att1' } : {}));
  });

  it('records as a moderator, then uploads and posts the file when stopped', async () => {
    const { useHuddleRecording } = await import('./use-huddle-recording');
    let huddle = fakeHuddle();
    const { result, rerender } = renderHook(({ h }) => useHuddleRecording(h, 'w1'), { initialProps: { h: huddle } });
    expect(result.current.canStart).toBe(true);

    act(() => result.current.start());
    expect(rec.started).toEqual([['mine', 'bob']]);
    expect(huddle.updateSettings).toHaveBeenCalledWith({ recording: true });
    expect(result.current.isMine).toBe(true);

    // Server confirms; then someone joins (mix follows).
    huddle = fakeHuddle({
      settings: { ...huddle.settings, recordingBy: 'me' },
      remoteStreams: { bob: s('bob'), carol: s('carol') },
      updateSettings: huddle.updateSettings,
    });
    rerender({ h: huddle });
    expect(rec.synced.at(-1)).toEqual(['mine', 'bob', 'carol']);
    expect(rec.stopped).toBe(0);

    act(() => result.current.stop());
    expect(huddle.updateSettings).toHaveBeenCalledWith({ recording: false });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(apiMock.mock.calls[0][1]).toBe('/workspaces/w1/attachments');
    expect(apiMock.mock.calls[1][1]).toBe('/channels/c1/messages');
    expect(apiMock.mock.calls[1][2]).toMatchObject({ attachmentIds: ['att1'], contentText: '🔴 Huddle recording · 1:05' });
    expect(rec.stopped).toBe(1);
  });

  it('finishes when another moderator stops it or the recorder leaves', async () => {
    const { useHuddleRecording } = await import('./use-huddle-recording');
    let huddle = fakeHuddle();
    const { result, rerender } = renderHook(({ h }) => useHuddleRecording(h, 'w1'), { initialProps: { h: huddle } });
    act(() => result.current.start());
    rerender({ h: (huddle = fakeHuddle({ settings: { ...huddle.settings, recordingBy: 'me' } })) });
    // A co-host stops the recording → server clears recordingBy.
    rerender({ h: fakeHuddle({ settings: { ...huddle.settings, recordingBy: null } }) });
    await waitFor(() => expect(rec.stopped).toBe(1));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));

    act(() => result.current.start());
    rerender({ h: fakeHuddle({ joined: false }) });
    await waitFor(() => expect(rec.stopped).toBe(2));
  });

  it('only moderators can start, and never while someone else records', async () => {
    const { useHuddleRecording } = await import('./use-huddle-recording');
    const participant = renderHook(() => useHuddleRecording(fakeHuddle({ myRole: 'participant' }), 'w1'));
    expect(participant.result.current.canStart).toBe(false);
    act(() => participant.result.current.start());
    expect(rec.started).toEqual([]);

    const busy = renderHook(() =>
      useHuddleRecording(
        fakeHuddle({ settings: { waitingRoomEnabled: false, locked: false, whiteboardOn: false, recordingBy: 'bob' } }),
        'w1',
      ),
    );
    expect(busy.result.current.canStart).toBe(false);
    expect(busy.result.current.canStop).toBe(true); // a host may stop bob's recording
    expect(busy.result.current.recordingBy).toBe('bob');
  });

  it('records on the media server in SFU huddles, with no browser recorder or upload', async () => {
    const { useHuddleRecording } = await import('./use-huddle-recording');
    const base = { waitingRoomEnabled: false, locked: false, whiteboardOn: false, recordingBy: null };
    let huddle = fakeHuddle({ serverRecordingAvailable: true });
    const { result, rerender } = renderHook(({ h }) => useHuddleRecording(h, 'w1'), { initialProps: { h: huddle } });
    expect(result.current).toMatchObject({ serverMode: true, canStart: true, onServer: false });

    act(() => result.current.start());
    expect(huddle.updateSettings).toHaveBeenCalledWith({ recording: true, onServer: true });
    expect(rec.started).toEqual([]);

    // Server confirms: it's mine, on the server, with a running timer.
    huddle = fakeHuddle({
      serverRecordingAvailable: true,
      settings: { ...base, recordingBy: 'me', recordingOnServer: true },
      updateSettings: huddle.updateSettings,
    });
    rerender({ h: huddle });
    expect(result.current).toMatchObject({ onServer: true, isMine: true, canStop: true, canStart: false });

    act(() => result.current.stop());
    expect(huddle.updateSettings).toHaveBeenCalledWith({ recording: false });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('once the server has processed it'), 'success');
    rerender({ h: fakeHuddle({ serverRecordingAvailable: true, settings: base }) });
    expect(rec.stopped).toBe(0);
    expect(apiMock).not.toHaveBeenCalled(); // the server posts the file itself
    expect(pushToast).toHaveBeenCalledTimes(1);
  });

  it('tells the starter when the server recording ends without them stopping it', async () => {
    const { useHuddleRecording } = await import('./use-huddle-recording');
    const base = { waitingRoomEnabled: false, locked: false, whiteboardOn: false, recordingBy: null };
    const { result, rerender } = renderHook(({ h }) => useHuddleRecording(h, 'w1'), {
      initialProps: { h: fakeHuddle({ serverRecordingAvailable: true }) },
    });
    act(() => result.current.start());
    rerender({ h: fakeHuddle({ serverRecordingAvailable: true, settings: { ...base, recordingBy: 'me', recordingOnServer: true } }) });
    rerender({ h: fakeHuddle({ serverRecordingAvailable: true, settings: base }) });
    expect(pushToast).toHaveBeenCalledWith('The server recording has ended.', 'info');
  });

  it('shows someone else’s server recording without a timer of mine', async () => {
    const { useHuddleRecording } = await import('./use-huddle-recording');
    const { result } = renderHook(() =>
      useHuddleRecording(
        fakeHuddle({
          myRole: 'participant',
          settings: { waitingRoomEnabled: false, locked: false, whiteboardOn: false, recordingBy: 'bob', recordingOnServer: true },
        }),
        'w1',
      ),
    );
    expect(result.current).toMatchObject({ recordingBy: 'bob', onServer: true, isMine: false, canStop: false, elapsedMs: 0 });
  });

  it('downloads the file if posting fails, so the recording is never lost', async () => {
    apiMock.mockRejectedValue(new Error('Channel is archived'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const { useHuddleRecording } = await import('./use-huddle-recording');
    const { result } = renderHook(() => useHuddleRecording(fakeHuddle(), 'w1'));
    act(() => result.current.start());
    act(() => result.current.stop());
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('downloaded instead'), 'error');
    click.mockRestore();
  });
});
