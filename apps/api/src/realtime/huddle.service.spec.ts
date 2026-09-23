import { HuddleService } from './huddle.service';

const A = 'channel:room-a';
const B = 'channel:room-b';

describe('HuddleService', () => {
  let svc: HuddleService;
  beforeEach(() => {
    svc = new HuddleService();
  });

  describe('membership & presence', () => {
    it('tracks a user as present across multiple sockets and only leaves on the last', () => {
      svc.join(A, 'u1', 's1');
      svc.join(A, 'u1', 's2');
      expect(svc.isPresent(A, 'u1')).toBe(true);
      expect(svc.leave(A, 'u1', 's1')).toBe(false); // still has s2
      expect(svc.isPresent(A, 'u1')).toBe(true);
      expect(svc.leave(A, 'u1', 's2')).toBe(true); // fully left
      expect(svc.isPresent(A, 'u1')).toBe(false);
      expect(svc.userIds(A)).toEqual([]);
    });

    it('removeSocket drops the socket from every huddle it was in', () => {
      svc.join(A, 'u1', 's1');
      svc.join(B, 'u1', 's1');
      const left = svc.removeSocket('u1', 's1');
      expect(left.sort()).toEqual([A, B].sort());
      expect(svc.isPresent(A, 'u1')).toBe(false);
      expect(svc.isPresent(B, 'u1')).toBe(false);
    });
  });

  describe('roles & host handoff', () => {
    it('makes the first participant host and later ones participants', () => {
      svc.join(A, 'u1', 's1');
      svc.join(A, 'u2', 's2');
      expect(svc.roleOf(A, 'u1')).toBe('host');
      expect(svc.roleOf(A, 'u2')).toBe('participant');
      expect(svc.isModerator(A, 'u1')).toBe(true);
      expect(svc.isModerator(A, 'u2')).toBe(false);
    });

    it('hands host to a co-host first when the host leaves', () => {
      svc.join(A, 'u1', 's1'); // host
      svc.join(A, 'u2', 's2');
      svc.join(A, 'u3', 's3');
      svc.setRole(A, 'u3', 'cohost');
      svc.leave(A, 'u1', 's1'); // host leaves
      expect(svc.roleOf(A, 'u3')).toBe('host'); // co-host promoted, not u2
      expect(svc.roleOf(A, 'u2')).toBe('participant');
    });

    it('promotes the earliest remaining member when the host leaves and there is no co-host', () => {
      svc.join(A, 'u1', 's1'); // host
      svc.join(A, 'u2', 's2');
      svc.leave(A, 'u1', 's1');
      expect(svc.roleOf(A, 'u2')).toBe('host');
    });
  });

  describe('media state & explicit stream-id mapping', () => {
    it('merges media flags and records camera/screen stream ids', () => {
      svc.join(A, 'u1', 's1');
      svc.setState(A, 'u1', { videoEnabled: true, cameraStreamId: 'cam-1' });
      svc.setState(A, 'u1', { screenSharing: true, screenStreamId: 'scr-1' });
      const st = svc.stateOf(A, 'u1')!;
      expect(st.videoEnabled).toBe(true);
      expect(st.cameraStreamId).toBe('cam-1');
      expect(st.screenSharing).toBe(true);
      expect(st.screenStreamId).toBe('scr-1');
    });

    it('clears the screen stream id when screen sharing stops', () => {
      svc.join(A, 'u1', 's1');
      svc.setState(A, 'u1', { screenSharing: true, screenStreamId: 'scr-1' });
      svc.setState(A, 'u1', { screenSharing: false });
      expect(svc.stateOf(A, 'u1')!.screenStreamId).toBeNull();
    });

    it('clears the camera stream id when video stops', () => {
      svc.join(A, 'u1', 's1');
      svc.setState(A, 'u1', { videoEnabled: true, cameraStreamId: 'cam-1' });
      svc.setState(A, 'u1', { videoEnabled: false });
      expect(svc.stateOf(A, 'u1')!.cameraStreamId).toBeNull();
    });

    it('ignores state updates for a user who is not in the huddle', () => {
      svc.setState(A, 'ghost', { videoEnabled: true });
      expect(svc.stateOf(A, 'ghost')).toBeUndefined();
    });
  });

  describe('annotation permissions', () => {
    it('defaults to everyone', () => {
      svc.join(A, 'u1', 's1');
      svc.join(A, 'u2', 's2');
      expect(svc.canAnnotate(A, 'u2')).toBe(true);
    });

    it('host-only mode revokes annotate for non-moderators', () => {
      svc.join(A, 'u1', 's1'); // host
      svc.join(A, 'u2', 's2');
      svc.setAnnotationMode(A, 'host');
      expect(svc.canAnnotate(A, 'u1')).toBe(true);
      expect(svc.canAnnotate(A, 'u2')).toBe(false);
    });

    it('selected mode preserves explicit per-user grants', () => {
      svc.join(A, 'u1', 's1');
      svc.join(A, 'u2', 's2');
      svc.setAnnotationMode(A, 'selected');
      svc.setCanAnnotate(A, 'u2', false);
      expect(svc.canAnnotate(A, 'u2')).toBe(false);
      svc.setCanAnnotate(A, 'u2', true);
      expect(svc.canAnnotate(A, 'u2')).toBe(true);
    });
  });

  describe('annotation ownership', () => {
    it('records the author and only reports that owner', () => {
      svc.join(A, 'u1', 's1');
      svc.recordAnnotation(A, 'shape-1', 'u1');
      expect(svc.annotationOwner(A, 'shape-1')).toBe('u1');
      expect(svc.annotationOwner(A, 'unknown')).toBeUndefined();
    });

    it('forgets an owner after delete and after clear', () => {
      svc.join(A, 'u1', 's1');
      svc.recordAnnotation(A, 's1', 'u1');
      svc.recordAnnotation(A, 's2', 'u1');
      svc.deleteAnnotation(A, 's1');
      expect(svc.annotationOwner(A, 's1')).toBeUndefined();
      expect(svc.annotationOwner(A, 's2')).toBe('u1');
      svc.clearAnnotationOwners(A);
      expect(svc.annotationOwner(A, 's2')).toBeUndefined();
    });

    it('keeps annotation ownership isolated per huddle', () => {
      svc.join(A, 'u1', 's1');
      svc.join(B, 'u2', 's2');
      svc.recordAnnotation(A, 'shared-id', 'u1');
      expect(svc.annotationOwner(A, 'shared-id')).toBe('u1');
      expect(svc.annotationOwner(B, 'shared-id')).toBeUndefined();
    });
  });

  describe('polls', () => {
    it('records votes and prevents voting on a closed or unknown poll', () => {
      svc.join(A, 'u1', 's1');
      svc.createPoll(A, { id: 'p1', question: 'Ship?', options: ['Yes', 'No'], votes: {}, createdBy: 'u1', closed: false });
      svc.votePoll(A, 'p1', 'u1', 0);
      svc.votePoll(A, 'p1', 'u2', 1);
      expect(svc.getPoll(A)!.votes).toEqual({ u1: 0, u2: 1 });
      // re-vote overwrites (one vote per user)
      svc.votePoll(A, 'p1', 'u1', 1);
      expect(svc.getPoll(A)!.votes.u1).toBe(1);
      // out-of-range option is ignored
      svc.votePoll(A, 'p1', 'u3', 9);
      expect(svc.getPoll(A)!.votes.u3).toBeUndefined();
      // closing blocks further votes
      svc.closePoll(A, 'p1');
      svc.votePoll(A, 'p1', 'u4', 0);
      expect(svc.getPoll(A)!.votes.u4).toBeUndefined();
      expect(svc.getPoll(A)!.closed).toBe(true);
    });
  });

  describe('remote-control sessions', () => {
    it('grants and revokes a control session', () => {
      svc.join(A, 'u1', 's1');
      svc.join(A, 'u2', 's2');
      svc.grantControl(A, 'u2', 'u1'); // controller u2, presenter u1
      expect(svc.getControl(A)).toEqual({ controllerId: 'u2', presenterId: 'u1' });
      svc.revokeControl(A);
      expect(svc.getControl(A)).toBeNull();
    });

    it('auto-revokes control when the presenter stops sharing', () => {
      svc.join(A, 'u1', 's1');
      svc.join(A, 'u2', 's2');
      svc.setState(A, 'u1', { screenSharing: true, screenStreamId: 'scr-1' });
      svc.grantControl(A, 'u2', 'u1');
      svc.setState(A, 'u1', { screenSharing: false });
      expect(svc.getControl(A)).toBeNull();
    });

    it('auto-revokes control when either party leaves', () => {
      svc.join(A, 'u1', 's1');
      svc.join(A, 'u2', 's2');
      svc.grantControl(A, 'u2', 'u1');
      svc.leave(A, 'u2', 's2'); // controller leaves
      expect(svc.getControl(A)).toBeNull();
    });
  });

  describe('notes', () => {
    it('stores and caps notes content', () => {
      svc.join(A, 'u1', 's1');
      svc.setNotes(A, 'Agenda');
      expect(svc.getNotes(A)).toBe('Agenda');
      svc.setNotes(A, 'x'.repeat(30000));
      expect(svc.getNotes(A).length).toBe(20000);
    });
  });

  describe('cross-meeting isolation', () => {
    it('keeps state, polls, notes and control fully separate per huddle key', () => {
      svc.join(A, 'u1', 's1');
      svc.join(B, 'u2', 's2');
      svc.setNotes(A, 'A notes');
      svc.setNotes(B, 'B notes');
      svc.createPoll(A, { id: 'pa', question: 'A?', options: ['1', '2'], votes: {}, createdBy: 'u1', closed: false });
      svc.grantControl(A, 'u1', 'u1');

      expect(svc.getNotes(A)).toBe('A notes');
      expect(svc.getNotes(B)).toBe('B notes');
      expect(svc.getPoll(A)?.id).toBe('pa');
      expect(svc.getPoll(B)).toBeNull();
      expect(svc.getControl(A)).not.toBeNull();
      expect(svc.getControl(B)).toBeNull();
      expect(svc.userIds(A)).toEqual(['u1']);
      expect(svc.userIds(B)).toEqual(['u2']);
      // u1 is a member of A but not B
      expect(svc.isPresent(B, 'u1')).toBe(false);
    });

    it('fully cleans a room once the last member leaves', () => {
      svc.join(A, 'u1', 's1');
      svc.setNotes(A, 'notes');
      svc.createPoll(A, { id: 'p', question: 'q', options: ['a', 'b'], votes: {}, createdBy: 'u1', closed: false });
      svc.leave(A, 'u1', 's1');
      expect(svc.getNotes(A)).toBe('');
      expect(svc.getPoll(A)).toBeNull();
      expect(svc.userIds(A)).toEqual([]);
    });
  });

  describe('room settings', () => {
    it('defaults every setting to off and merges partial patches', () => {
      expect(svc.getSettings(A)).toEqual({ waitingRoomEnabled: false, locked: false, whiteboardOn: false });
      svc.setSettings(A, { waitingRoomEnabled: true });
      svc.setSettings(A, { whiteboardOn: true });
      expect(svc.getSettings(A)).toEqual({ waitingRoomEnabled: true, locked: false, whiteboardOn: true });
    });
  });

  describe('waiting room', () => {
    it('tracks waiters per socket and reports the pending list', () => {
      expect(svc.addWaiting(A, 'u2', 's2')).toBe(true); // new
      expect(svc.addWaiting(A, 'u2', 's2b')).toBe(false); // same user, another tab
      expect(svc.isWaiting(A, 'u2')).toBe(true);
      expect(svc.waitingUserIds(A)).toEqual(['u2']);
    });

    it('removeWaiting returns every held socket and clears the entry', () => {
      svc.addWaiting(A, 'u2', 's2');
      svc.addWaiting(A, 'u2', 's2b');
      expect(svc.removeWaiting(A, 'u2').sort()).toEqual(['s2', 's2b'].sort());
      expect(svc.isWaiting(A, 'u2')).toBe(false);
      expect(svc.removeWaiting(A, 'unknown')).toEqual([]);
    });

    it('removeWaitingSocket drops one socket from every room it waited in', () => {
      svc.addWaiting(A, 'u2', 's2');
      svc.addWaiting(B, 'u2', 's2');
      expect(svc.removeWaitingSocket('u2', 's2').sort()).toEqual([A, B].sort());
      expect(svc.isWaiting(A, 'u2')).toBe(false);
      expect(svc.isWaiting(B, 'u2')).toBe(false);
    });
  });

  describe('whiteboard', () => {
    it('stores shapes in order, enforces ownership tracking, and replays via shapes()', () => {
      const shape = (id: string, userId: string) => ({
        id,
        userId,
        tool: 'pen' as const,
        color: '#fff',
        points: [{ x: 0, y: 0 }],
        createdAt: 1,
      });
      svc.whiteboardCreate(A, shape('s1', 'u1'), 'u1');
      svc.whiteboardCreate(A, shape('s2', 'u2'), 'u2');
      expect(svc.whiteboardShapes(A).map((s) => s.id)).toEqual(['s1', 's2']);
      expect(svc.whiteboardOwner(A, 's1')).toBe('u1');
      svc.whiteboardUpdate(A, { ...shape('s1', 'u1'), color: '#000' });
      expect(svc.whiteboardShapes(A).find((s) => s.id === 's1')!.color).toBe('#000');
      svc.whiteboardDelete(A, 's1');
      expect(svc.whiteboardOwner(A, 's1')).toBeUndefined();
      svc.whiteboardClear(A);
      expect(svc.whiteboardShapes(A)).toEqual([]);
    });
  });

  describe('breakout rooms', () => {
    const rooms = [
      { id: 'r1', name: 'Room 1' },
      { id: 'r2', name: 'Room 2' },
    ];

    it('opens with filtered assignments and reports per-user breakout', () => {
      svc.openBreakouts(A, rooms, { u1: 'r1', u2: 'r2', ghost: 'bad-room' });
      const b = svc.getBreakouts(A);
      expect(b.open).toBe(true);
      expect(b.assignments).toEqual({ u1: 'r1', u2: 'r2' }); // invalid room dropped
      expect(svc.breakoutOf(A, 'u1')).toBe('r1');
      expect(svc.breakoutOf(A, 'nobody')).toBeNull();
    });

    it('reassigns and returns a user to the main room with null', () => {
      svc.openBreakouts(A, rooms, {});
      svc.assignBreakout(A, 'u1', 'r2');
      expect(svc.breakoutOf(A, 'u1')).toBe('r2');
      svc.assignBreakout(A, 'u1', 'unknown'); // ignored
      expect(svc.breakoutOf(A, 'u1')).toBe('r2');
      svc.assignBreakout(A, 'u1', null);
      expect(svc.breakoutOf(A, 'u1')).toBeNull();
    });

    it('closing clears breakouts and a leaving member drops their assignment', () => {
      svc.join(A, 'u1', 's1');
      svc.openBreakouts(A, rooms, { u1: 'r1' });
      svc.leave(A, 'u1', 's1'); // cleanupMember drops assignment (and empties the room)
      expect(svc.getBreakouts(A).open).toBe(false);
      svc.join(A, 'u1', 's1');
      svc.openBreakouts(A, rooms, { u1: 'r1' });
      svc.closeBreakouts(A);
      expect(svc.getBreakouts(A)).toEqual({ open: false, rooms: [], assignments: {} });
    });
  });
});
