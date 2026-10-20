import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';

/**
 * Media transport for huddles running through the self-hosted LiveKit SFU.
 *
 * Only *media* goes through LiveKit; every collaboration feature (state,
 * chat, moderation, whiteboard…) stays on the Socket.IO gateway exactly as in
 * mesh mode. The hook feeds this class its own MediaStreamTracks (so blur,
 * push-to-talk and mute keep working on the very same tracks) and gets back,
 * per remote user, an A/V stream (mic + camera) and a screen stream
 * (screen + tab audio) — the same shapes the mesh produces.
 *
 * LiveKit identities are `<userId>~<tabNonce>` so a second tab never kicks
 * the first (LiveKit rejects duplicate identities); remote media is keyed by
 * the userId part.
 */

export type SfuConnectionState = 'connected' | 'reconnecting' | 'unstable';

export interface SfuCallbacks {
  /** Mic + camera of a remote user (null = gone). */
  onAv: (userId: string, stream: MediaStream | null) => void;
  /** Screen share (+ its audio) of a remote user (null = stopped). */
  onScreen: (userId: string, stream: MediaStream | null) => void;
  onState: (state: SfuConnectionState) => void;
  /** The SFU dropped us for good (not a transient blip LiveKit recovers from). */
  onDropped: (reason: 'removed' | 'error') => void;
}

/** `<userId>~<nonce>` → userId. Identities without a nonce are the userId. */
export function userIdOfIdentity(identity: string): string {
  const i = identity.indexOf('~');
  return i === -1 ? identity : identity.slice(0, i);
}

type Group = 'av' | 'screen';

/** Which of a user's two streams a LiveKit track source belongs to. */
export function groupOfSource(source: Track.Source): Group | null {
  switch (source) {
    case Track.Source.Microphone:
    case Track.Source.Camera:
      return 'av';
    case Track.Source.ScreenShare:
    case Track.Source.ScreenShareAudio:
      return 'screen';
    default:
      return null;
  }
}

/**
 * Pure bookkeeping of subscribed remote tracks → per-user streams. Each change
 * yields a *new* MediaStream so media elements (keyed on the stream) re-bind.
 * When one user has several connections (tabs), the most recent one with
 * tracks in that group wins.
 */
export class RemoteMediaIndex {
  /** identity → group → (trackSid → track) */
  private tracks = new Map<string, Map<Group, Map<string, MediaStreamTrack>>>();
  /** identity order of first appearance, newest last. */
  private order: string[] = [];

  constructor(
    private readonly emit: (group: Group, userId: string, stream: MediaStream | null) => void,
    private readonly makeStream: (tracks: MediaStreamTrack[]) => MediaStream = (t) => new MediaStream(t),
  ) {}

  add(identity: string, group: Group, sid: string, track: MediaStreamTrack) {
    let byGroup = this.tracks.get(identity);
    if (!byGroup) {
      byGroup = new Map();
      this.tracks.set(identity, byGroup);
      this.order.push(identity);
    }
    let set = byGroup.get(group);
    if (!set) {
      set = new Map();
      byGroup.set(group, set);
    }
    set.set(sid, track);
    this.publish(userIdOfIdentity(identity), group);
  }

  remove(identity: string, group: Group, sid: string) {
    const set = this.tracks.get(identity)?.get(group);
    if (!set?.delete(sid)) return;
    this.publish(userIdOfIdentity(identity), group);
  }

  removeIdentity(identity: string) {
    if (!this.tracks.delete(identity)) return;
    this.order = this.order.filter((i) => i !== identity);
    const userId = userIdOfIdentity(identity);
    this.publish(userId, 'av');
    this.publish(userId, 'screen');
  }

  clear() {
    const users = new Set(this.order.map(userIdOfIdentity));
    this.tracks.clear();
    this.order = [];
    for (const u of users) {
      this.emit('av', u, null);
      this.emit('screen', u, null);
    }
  }

  private publish(userId: string, group: Group) {
    // Newest connection of this user that has tracks in the group.
    for (let i = this.order.length - 1; i >= 0; i--) {
      const identity = this.order[i];
      if (userIdOfIdentity(identity) !== userId) continue;
      const set = this.tracks.get(identity)?.get(group);
      if (set && set.size > 0) {
        this.emit(group, userId, this.makeStream([...set.values()]));
        return;
      }
    }
    this.emit(group, userId, null);
  }
}

const SCREEN_ENCODING = { maxBitrate: 3_000_000, maxFramerate: 30 };

export class SfuTransport {
  private room: Room | null = null;
  private readonly index: RemoteMediaIndex;
  private camera: LocalTrackPublication | null = null;
  private screen: LocalTrackPublication[] = [];
  private closed = false;
  /** Connected and the mic is published: publishing is allowed. */
  private ready = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly myUserId: string,
    private readonly cb: SfuCallbacks,
  ) {
    this.index = new RemoteMediaIndex((group, userId, stream) =>
      group === 'av' ? cb.onAv(userId, stream) : cb.onScreen(userId, stream),
    );
  }

  get connected(): boolean {
    return !!this.room && !this.closed;
  }

  async connect(url: string, token: string, mic: MediaStreamTrack | null): Promise<void> {
    const room = new Room({
      // We own every track (blur pipeline, PTT, mute) — LiveKit must never stop them.
      stopLocalTrackOnUnpublish: false,
      adaptiveStream: false,
      dynacast: true,
      disconnectOnPageLeave: true,
    });
    this.room = room;
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) =>
        this.onSubscribed(track, pub, p),
      )
      .on(RoomEvent.TrackUnsubscribed, (_t: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
        const group = groupOfSource(pub.source);
        if (group) this.index.remove(p.identity, group, pub.trackSid);
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => this.index.removeIdentity(p.identity))
      .on(RoomEvent.Reconnecting, () => this.cb.onState('reconnecting'))
      .on(RoomEvent.SignalReconnecting, () => this.cb.onState('reconnecting'))
      .on(RoomEvent.Reconnected, () => this.cb.onState('connected'))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (this.closed) return;
        this.index.clear();
        this.room = null;
        this.ready = false;
        this.camera = null;
        this.screen = [];
        const removed =
          reason === DisconnectReason.PARTICIPANT_REMOVED ||
          reason === DisconnectReason.ROOM_DELETED ||
          reason === DisconnectReason.DUPLICATE_IDENTITY;
        this.cb.onState('unstable');
        this.cb.onDropped(removed ? 'removed' : 'error');
      });
    await room.connect(url, token, { autoSubscribe: true });
    if (this.closed) {
      await room.disconnect(false); // never stop our own tracks
      return;
    }
    // Pick up anyone who published before we finished connecting.
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.isSubscribed) this.onSubscribed(pub.track, pub, p);
      }
    }
    if (mic) await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone, name: 'microphone' });
    this.ready = true;
    this.cb.onState('connected');
  }

  private onSubscribed(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    if (userIdOfIdentity(p.identity) === this.myUserId) return; // my own other tab
    const group = groupOfSource(pub.source);
    if (group && track.mediaStreamTrack) this.index.add(p.identity, group, pub.trackSid, track.mediaStreamTrack);
  }

  /** Publish operations run one at a time, and only once connected — a change made
   *  while connecting is picked up by the caller's re-publish after connect(). */
  private serial(fn: (room: Room) => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (this.ready && this.room ? fn(this.room) : undefined));
    this.queue = run.catch(() => undefined);
    return run;
  }

  publishCamera(track: MediaStreamTrack) {
    return this.serial(async (room) => {
      if (this.camera?.track) await room.localParticipant.unpublishTrack(this.camera.track, false).catch(() => undefined);
      this.camera = null;
      this.camera = await room.localParticipant.publishTrack(track, {
        source: Track.Source.Camera,
        name: 'camera',
        simulcast: true,
      });
    });
  }

  replaceCamera(track: MediaStreamTrack) {
    return this.serial(async () => {
      const local = this.camera?.track;
      if (local) await local.replaceTrack(track, { userProvidedTrack: true });
    });
  }

  unpublishCamera() {
    return this.serial(async (room) => {
      const pub = this.camera;
      this.camera = null;
      if (pub?.track) await room.localParticipant.unpublishTrack(pub.track, false).catch(() => undefined);
    });
  }

  publishScreen(stream: MediaStream) {
    return this.serial(async (room) => {
      await this.dropScreen(room);
      const video = stream.getVideoTracks()[0];
      const audio = stream.getAudioTracks()[0];
      if (video) {
        this.screen.push(
          await room.localParticipant.publishTrack(video, {
            source: Track.Source.ScreenShare,
            name: 'screen',
            simulcast: false,
            videoEncoding: SCREEN_ENCODING,
          }),
        );
      }
      if (audio) {
        this.screen.push(
          await room.localParticipant.publishTrack(audio, { source: Track.Source.ScreenShareAudio, name: 'screen-audio' }),
        );
      }
    });
  }

  unpublishScreen() {
    return this.serial((room) => this.dropScreen(room));
  }

  private async dropScreen(room: Room) {
    const pubs = this.screen;
    this.screen = [];
    for (const pub of pubs) {
      if (pub.track) await room.localParticipant.unpublishTrack(pub.track, false).catch(() => undefined);
    }
  }

  /** Leave the SFU room for good. Never fires onDropped. */
  async disconnect() {
    this.closed = true;
    const room = this.room;
    this.room = null;
    this.ready = false;
    this.camera = null;
    this.screen = [];
    this.index.clear();
    // false: the tracks are ours (blur pipeline, PTT) and outlive this room —
    // LiveKit would otherwise stop the mic on every breakout move.
    await room?.disconnect(false).catch(() => undefined);
  }
}
