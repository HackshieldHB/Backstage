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
});
