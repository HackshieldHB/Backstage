import { describe, it, expect } from 'vitest';
import { Track } from 'livekit-client';
import { RemoteMediaIndex, groupOfSource, userIdOfIdentity } from './sfu-transport';

const track = (id: string) => ({ id }) as MediaStreamTrack;
/** A stand-in MediaStream that just remembers its tracks. */
const makeStream = (tracks: MediaStreamTrack[]) => ({ tracks: tracks.map((t) => t.id) }) as unknown as MediaStream;
const ids = (s: MediaStream | null) => (s ? (s as unknown as { tracks: string[] }).tracks : null);

function setup() {
  const events: { group: string; userId: string; tracks: string[] | null }[] = [];
  const index = new RemoteMediaIndex((group, userId, stream) => events.push({ group, userId, tracks: ids(stream) }), makeStream);
  return { index, events, last: () => events[events.length - 1] };
}

describe('sfu-transport', () => {
  it('maps identities and sources', () => {
    expect(userIdOfIdentity('u1~abc')).toBe('u1');
    expect(userIdOfIdentity('u1')).toBe('u1');
    expect(groupOfSource(Track.Source.Microphone)).toBe('av');
    expect(groupOfSource(Track.Source.Camera)).toBe('av');
    expect(groupOfSource(Track.Source.ScreenShare)).toBe('screen');
    expect(groupOfSource(Track.Source.ScreenShareAudio)).toBe('screen');
    expect(groupOfSource(Track.Source.Unknown)).toBeNull();
  });

  it('builds one A/V stream (mic + camera) and one screen stream per user', () => {
    const { index, last } = setup();
    index.add('bob~1', 'av', 'TR_mic', track('mic'));
    expect(last()).toEqual({ group: 'av', userId: 'bob', tracks: ['mic'] });
    index.add('bob~1', 'av', 'TR_cam', track('cam'));
    expect(last()).toEqual({ group: 'av', userId: 'bob', tracks: ['mic', 'cam'] });
    index.add('bob~1', 'screen', 'TR_scr', track('scr'));
    expect(last()).toEqual({ group: 'screen', userId: 'bob', tracks: ['scr'] });
    index.remove('bob~1', 'av', 'TR_cam');
    expect(last()).toEqual({ group: 'av', userId: 'bob', tracks: ['mic'] });
    index.remove('bob~1', 'screen', 'TR_scr');
    expect(last()).toEqual({ group: 'screen', userId: 'bob', tracks: null });
  });

  it('prefers the newest connection when a user has two tabs, and falls back when it leaves', () => {
    const { index, last } = setup();
    index.add('bob~old', 'av', 'A', track('old-mic'));
    index.add('bob~new', 'av', 'B', track('new-mic'));
    expect(last()).toEqual({ group: 'av', userId: 'bob', tracks: ['new-mic'] });
    index.removeIdentity('bob~new');
    expect(last()).toEqual({ group: 'screen', userId: 'bob', tracks: null });
    // The A/V event just before the screen one fell back to the older tab.
    index.removeIdentity('bob~old');
    expect(last()).toEqual({ group: 'screen', userId: 'bob', tracks: null });
  });

  it('falls back to the older tab on leave', () => {
    const { index, events } = setup();
    index.add('bob~old', 'av', 'A', track('old-mic'));
    index.add('bob~new', 'av', 'B', track('new-mic'));
    events.length = 0;
    index.removeIdentity('bob~new');
    expect(events).toEqual([
      { group: 'av', userId: 'bob', tracks: ['old-mic'] },
      { group: 'screen', userId: 'bob', tracks: null },
    ]);
  });

  it('ignores removals it never saw and clears everyone on disconnect', () => {
    const { index, events } = setup();
    index.remove('nobody~1', 'av', 'X');
    index.removeIdentity('nobody~1');
    expect(events).toEqual([]);
    index.add('ann~1', 'av', 'A', track('a'));
    index.add('bob~1', 'screen', 'B', track('b'));
    events.length = 0;
    index.clear();
    expect(events).toEqual([
      { group: 'av', userId: 'ann', tracks: null },
      { group: 'screen', userId: 'ann', tracks: null },
      { group: 'av', userId: 'bob', tracks: null },
      { group: 'screen', userId: 'bob', tracks: null },
    ]);
  });
});
