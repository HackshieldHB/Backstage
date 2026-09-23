import { Injectable } from '@nestjs/common';
import type { BreakoutRoom, HuddleAnnotationShape, HuddleRole, HuddleSettings } from '@backstages/shared';

/** Authoritative per-participant meeting state (server is the source of truth for
 *  moderation and UI). Media flags are advisory (the client owns its tracks) but
 *  role/annotation permission are enforced here. */
export interface HuddleMemberState {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  role: HuddleRole;
  canAnnotate: boolean;
  /** Reported MediaStream ids per source, for deterministic remote classification. */
  cameraStreamId: string | null;
  screenStreamId: string | null;
}

export type AnnotationMode = 'everyone' | 'host' | 'selected';

export interface HuddlePoll {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  createdBy: string;
  closed: boolean;
}

interface ControlSession {
  controllerId: string;
  presenterId: string;
}

interface BreakoutState {
  rooms: BreakoutRoom[];
  /** userId → roomId. Absent = the main room. */
  assignments: Map<string, string>;
}

function defaultSettings(): HuddleSettings {
  return { waitingRoomEnabled: false, locked: false, whiteboardOn: false };
}

function defaultState(role: HuddleRole): HuddleMemberState {
  return {
    audioEnabled: true,
    videoEnabled: false,
    screenSharing: false,
    handRaised: false,
    role,
    canAnnotate: true,
    cameraStreamId: null,
    screenStreamId: null,
  };
}

/**
 * In-memory registry of who is currently in each huddle **and** their meeting
 * state. A huddle is identified by an opaque key — its socket-room name, so it
 * works for both channels ("channel:X") and DM/group conversations
 * ("conversation:Y"). A user counts as present while they have at least one
 * connected socket in the huddle, so multiple tabs and clean disconnect handling
 * both work.
 *
 * The first participant to join becomes the host; if the host leaves while others
 * remain, host is handed to the next participant so a meeting is never orphaned.
 *
 * NOTE: single-instance state. Horizontal scaling would move this into Redis; the
 * socket relay itself already fans out via the Redis adapter.
 */
@Injectable()
export class HuddleService {
  /** key -> (userId -> set of socketIds) */
  private readonly rooms = new Map<string, Map<string, Set<string>>>();
  /** key -> (userId -> meeting state) */
  private readonly states = new Map<string, Map<string, HuddleMemberState>>();
  /** key -> who may annotate the shared screen. */
  private readonly annotationModes = new Map<string, AnnotationMode>();
  /** key -> the single active live poll (if any). */
  private readonly polls = new Map<string, HuddlePoll>();
  /** key -> collaborative notes document. */
  private readonly notes = new Map<string, string>();
  /** key -> (annotation shape id -> owner userId), so only the author (or a
   *  moderator) can edit/delete a given annotation. */
  private readonly annotationOwners = new Map<string, Map<string, string>>();
  /** key -> ordered screen-annotation shapes, so late joiners can be synced and
   *  the presenter always sees what others draw on their shared screen. */
  private readonly annotations = new Map<string, Map<string, HuddleAnnotationShape>>();
  /** key -> active remote-control session (permission only; see gateway). */
  private readonly control = new Map<string, ControlSession>();
  /** key -> room-level meeting settings (waiting room / lock / whiteboard). */
  private readonly settings = new Map<string, HuddleSettings>();
  /** key -> (waiting userId -> their socket ids), for the waiting room. */
  private readonly waiting = new Map<string, Map<string, Set<string>>>();
  /** key -> ordered whiteboard shapes (insertion order preserved by Map). */
  private readonly whiteboard = new Map<string, Map<string, HuddleAnnotationShape>>();
  /** key -> (whiteboard shape id -> owner userId). */
  private readonly whiteboardOwners = new Map<string, Map<string, string>>();
  /** key -> breakout configuration (rooms + per-user assignments). */
  private readonly breakouts = new Map<string, BreakoutState>();

  join(key: string, userId: string, socketId: string): void {
    let room = this.rooms.get(key);
    if (!room) {
      room = new Map();
      this.rooms.set(key, room);
    }
    let sockets = room.get(userId);
    if (!sockets) {
      sockets = new Set();
      room.set(userId, sockets);
    }
    sockets.add(socketId);

    // Ensure meeting state exists; first participant in the room is the host.
    let state = this.states.get(key);
    if (!state) {
      state = new Map();
      this.states.set(key, state);
    }
    if (!state.has(userId)) {
      const role: HuddleRole = state.size === 0 ? 'host' : 'participant';
      state.set(userId, defaultState(role));
    }
  }

  /** Removes one socket; returns true if the user fully left the huddle. */
  leave(key: string, userId: string, socketId: string): boolean {
    const room = this.rooms.get(key);
    const sockets = room?.get(userId);
    if (!sockets) return false;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      room!.delete(userId);
      this.cleanupMember(key, userId);
      if (room!.size === 0) this.cleanupRoom(key);
      return true;
    }
    return false;
  }

  /** Removes a socket from every huddle it was in; returns keys the user fully left. */
  removeSocket(userId: string, socketId: string): string[] {
    const affected: string[] = [];
    for (const key of [...this.rooms.keys()]) {
      const sockets = this.rooms.get(key)?.get(userId);
      if (sockets?.has(socketId) && this.leave(key, userId, socketId)) {
        affected.push(key);
      }
    }
    return affected;
  }

  /** State cleanup when a user fully leaves: drop their state, hand off host,
   *  retract their poll votes, and tear down any control session they were in. */
  private cleanupMember(key: string, userId: string): void {
    const state = this.states.get(key);
    if (state) {
      const wasHost = state.get(userId)?.role === 'host';
      state.delete(userId);
      if (wasHost && state.size > 0) {
        // Promote a co-host if one exists, else the earliest-remaining member.
        const next = [...state.entries()].find(([, s]) => s.role === 'cohost') ?? [...state.entries()][0];
        if (next) next[1].role = 'host';
      }
    }
    const poll = this.polls.get(key);
    if (poll) delete poll.votes[userId];
    const session = this.control.get(key);
    if (session && (session.controllerId === userId || session.presenterId === userId)) {
      this.control.delete(key);
    }
    // A leaving member relinquishes any breakout assignment they held.
    this.breakouts.get(key)?.assignments.delete(userId);
  }

  private cleanupRoom(key: string): void {
    this.rooms.delete(key);
    this.states.delete(key);
    this.annotationModes.delete(key);
    this.polls.delete(key);
    this.notes.delete(key);
    this.control.delete(key);
    this.annotationOwners.delete(key);
    this.annotations.delete(key);
    this.settings.delete(key);
    this.waiting.delete(key);
    this.whiteboard.delete(key);
    this.whiteboardOwners.delete(key);
    this.breakouts.delete(key);
  }

  userIds(key: string): string[] {
    return [...(this.rooms.get(key)?.keys() ?? [])];
  }

  stateOf(key: string, userId: string): HuddleMemberState | undefined {
    return this.states.get(key)?.get(userId);
  }

  roleOf(key: string, userId: string): HuddleRole {
    return this.states.get(key)?.get(userId)?.role ?? 'participant';
  }

  isModerator(key: string, userId: string): boolean {
    const role = this.roleOf(key, userId);
    return role === 'host' || role === 'cohost';
  }

  isPresent(key: string, userId: string): boolean {
    return (this.rooms.get(key)?.get(userId)?.size ?? 0) > 0;
  }

  /** Merge a self-reported media/hand update. Ignores unknown members. */
  setState(
    key: string,
    userId: string,
    patch: Partial<
      Pick<
        HuddleMemberState,
        'audioEnabled' | 'videoEnabled' | 'screenSharing' | 'handRaised' | 'cameraStreamId' | 'screenStreamId'
      >
    >,
  ): void {
    const s = this.states.get(key)?.get(userId);
    if (!s) return;
    if (patch.audioEnabled !== undefined) s.audioEnabled = patch.audioEnabled;
    if (patch.videoEnabled !== undefined) s.videoEnabled = patch.videoEnabled;
    if (patch.screenSharing !== undefined) s.screenSharing = patch.screenSharing;
    if (patch.handRaised !== undefined) s.handRaised = patch.handRaised;
    if (patch.cameraStreamId !== undefined) s.cameraStreamId = patch.cameraStreamId;
    if (patch.screenStreamId !== undefined) s.screenStreamId = patch.screenStreamId;
    // Stopping a screen share always ends any control session over it.
    if (patch.screenSharing === false) {
      s.screenStreamId = null;
      const session = this.control.get(key);
      if (session?.presenterId === userId) this.control.delete(key);
    }
    if (patch.videoEnabled === false) s.cameraStreamId = null;
  }

  setRole(key: string, userId: string, role: HuddleRole): void {
    const s = this.states.get(key)?.get(userId);
    if (s) s.role = role;
  }

  lowerHand(key: string, userId: string): void {
    const s = this.states.get(key)?.get(userId);
    if (s) s.handRaised = false;
  }

  // ----- annotation permission -----
  annotationMode(key: string): AnnotationMode {
    return this.annotationModes.get(key) ?? 'everyone';
  }
  setAnnotationMode(key: string, mode: AnnotationMode): void {
    this.annotationModes.set(key, mode);
    const state = this.states.get(key);
    if (!state) return;
    for (const [, s] of state) {
      if (mode === 'everyone') s.canAnnotate = true;
      else if (mode === 'host') s.canAnnotate = s.role === 'host' || s.role === 'cohost';
      // 'selected' leaves existing per-user flags as the host set them.
    }
  }
  setCanAnnotate(key: string, userId: string, value: boolean): void {
    const s = this.states.get(key)?.get(userId);
    if (s) s.canAnnotate = value;
  }
  canAnnotate(key: string, userId: string): boolean {
    return this.states.get(key)?.get(userId)?.canAnnotate ?? false;
  }

  // ----- annotation ownership -----
  recordAnnotation(key: string, shapeId: string, userId: string): void {
    let m = this.annotationOwners.get(key);
    if (!m) {
      m = new Map();
      this.annotationOwners.set(key, m);
    }
    m.set(shapeId, userId);
  }
  annotationOwner(key: string, shapeId: string): string | undefined {
    return this.annotationOwners.get(key)?.get(shapeId);
  }
  deleteAnnotation(key: string, shapeId: string): void {
    this.annotationOwners.get(key)?.delete(shapeId);
    this.annotations.get(key)?.delete(shapeId);
  }
  clearAnnotationOwners(key: string): void {
    this.annotationOwners.delete(key);
    this.annotations.delete(key);
  }

  // ----- annotation shape store (for late-join sync) -----
  annotationShapes(key: string): HuddleAnnotationShape[] {
    return [...(this.annotations.get(key)?.values() ?? [])];
  }
  putAnnotation(key: string, shape: HuddleAnnotationShape): void {
    let shapes = this.annotations.get(key);
    if (!shapes) {
      shapes = new Map();
      this.annotations.set(key, shapes);
    }
    shapes.set(shape.id, shape);
  }

  // ----- polls -----
  getPoll(key: string): HuddlePoll | null {
    return this.polls.get(key) ?? null;
  }
  createPoll(key: string, poll: HuddlePoll): void {
    this.polls.set(key, poll);
  }
  votePoll(key: string, pollId: string, userId: string, optionIndex: number): void {
    const poll = this.polls.get(key);
    if (poll && poll.id === pollId && !poll.closed && optionIndex >= 0 && optionIndex < poll.options.length) {
      poll.votes[userId] = optionIndex;
    }
  }
  closePoll(key: string, pollId: string): void {
    const poll = this.polls.get(key);
    if (poll && poll.id === pollId) poll.closed = true;
  }

  // ----- notes -----
  getNotes(key: string): string {
    return this.notes.get(key) ?? '';
  }
  setNotes(key: string, content: string): void {
    this.notes.set(key, content.slice(0, 20000));
  }

  // ----- remote-control sessions -----
  getControl(key: string): ControlSession | null {
    return this.control.get(key) ?? null;
  }
  grantControl(key: string, controllerId: string, presenterId: string): void {
    this.control.set(key, { controllerId, presenterId });
  }
  revokeControl(key: string): void {
    this.control.delete(key);
  }

  // ----- room settings (waiting room / lock / whiteboard) -----
  getSettings(key: string): HuddleSettings {
    return this.settings.get(key) ?? defaultSettings();
  }
  setSettings(key: string, patch: Partial<HuddleSettings>): HuddleSettings {
    const current = this.settings.get(key) ?? defaultSettings();
    const next: HuddleSettings = {
      waitingRoomEnabled: patch.waitingRoomEnabled ?? current.waitingRoomEnabled,
      locked: patch.locked ?? current.locked,
      whiteboardOn: patch.whiteboardOn ?? current.whiteboardOn,
    };
    this.settings.set(key, next);
    return next;
  }

  // ----- waiting room -----
  /** Hold a socket in the waiting room. Returns true if this is a new waiter. */
  addWaiting(key: string, userId: string, socketId: string): boolean {
    let room = this.waiting.get(key);
    if (!room) {
      room = new Map();
      this.waiting.set(key, room);
    }
    const isNew = !room.has(userId);
    let sockets = room.get(userId);
    if (!sockets) {
      sockets = new Set();
      room.set(userId, sockets);
    }
    sockets.add(socketId);
    return isNew;
  }
  isWaiting(key: string, userId: string): boolean {
    return this.waiting.get(key)?.has(userId) ?? false;
  }
  waitingUserIds(key: string): string[] {
    return [...(this.waiting.get(key)?.keys() ?? [])];
  }
  /** Remove a user from the waiting room, returning the socket ids they held. */
  removeWaiting(key: string, userId: string): string[] {
    const room = this.waiting.get(key);
    const sockets = room?.get(userId);
    if (!room || !sockets) return [];
    room.delete(userId);
    if (room.size === 0) this.waiting.delete(key);
    return [...sockets];
  }
  /** Drop a socket from every waiting room it was in; returns keys that changed. */
  removeWaitingSocket(userId: string, socketId: string): string[] {
    const affected: string[] = [];
    for (const [key, room] of this.waiting) {
      const sockets = room.get(userId);
      if (sockets?.delete(socketId)) {
        affected.push(key);
        if (sockets.size === 0) room.delete(userId);
        if (room.size === 0) this.waiting.delete(key);
      }
    }
    return affected;
  }

  // ----- whiteboard (standalone shared surface) -----
  whiteboardShapes(key: string): HuddleAnnotationShape[] {
    return [...(this.whiteboard.get(key)?.values() ?? [])];
  }
  whiteboardCreate(key: string, shape: HuddleAnnotationShape, userId: string): void {
    let shapes = this.whiteboard.get(key);
    if (!shapes) {
      shapes = new Map();
      this.whiteboard.set(key, shapes);
    }
    shapes.set(shape.id, shape);
    let owners = this.whiteboardOwners.get(key);
    if (!owners) {
      owners = new Map();
      this.whiteboardOwners.set(key, owners);
    }
    owners.set(shape.id, userId);
  }
  whiteboardUpdate(key: string, shape: HuddleAnnotationShape): void {
    const shapes = this.whiteboard.get(key);
    if (shapes?.has(shape.id)) shapes.set(shape.id, shape);
  }
  whiteboardDelete(key: string, id: string): void {
    this.whiteboard.get(key)?.delete(id);
    this.whiteboardOwners.get(key)?.delete(id);
  }
  whiteboardClear(key: string): void {
    this.whiteboard.delete(key);
    this.whiteboardOwners.delete(key);
  }
  whiteboardOwner(key: string, id: string): string | undefined {
    return this.whiteboardOwners.get(key)?.get(id);
  }

  // ----- breakout rooms -----
  getBreakouts(key: string): { open: boolean; rooms: BreakoutRoom[]; assignments: Record<string, string> } {
    const b = this.breakouts.get(key);
    if (!b) return { open: false, rooms: [], assignments: {} };
    return { open: true, rooms: b.rooms, assignments: Object.fromEntries(b.assignments) };
  }
  openBreakouts(key: string, rooms: BreakoutRoom[], assignments: Record<string, string>): void {
    const valid = new Set(rooms.map((r) => r.id));
    const map = new Map<string, string>();
    for (const [userId, roomId] of Object.entries(assignments)) {
      if (valid.has(roomId)) map.set(userId, roomId);
    }
    this.breakouts.set(key, { rooms, assignments: map });
  }
  assignBreakout(key: string, userId: string, roomId: string | null): void {
    const b = this.breakouts.get(key);
    if (!b) return;
    if (roomId === null) b.assignments.delete(userId);
    else if (b.rooms.some((r) => r.id === roomId)) b.assignments.set(userId, roomId);
  }
  closeBreakouts(key: string): void {
    this.breakouts.delete(key);
  }
  breakoutOf(key: string, userId: string): string | null {
    return this.breakouts.get(key)?.assignments.get(userId) ?? null;
  }
}
