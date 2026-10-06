import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TasksService } from '../src/tasks/tasks.service';
import { ScheduledMessagesService } from '../src/messages/scheduled-messages.service';

describe('tasks & message reminders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  interface Actor {
    id: string;
    token: string;
  }
  let alice: Actor; // owner
  let bob: Actor; // member
  let carol: Actor; // member, never party to the tasks below
  let mallory: Actor; // outsider
  let workspaceId: string;
  let channelId: string; // public, everyone joined
  let secretId: string; // private, alice only

  const http = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const post = (cid: string, who: Actor, text: string) =>
    http()
      .post(`/channels/${cid}/messages`)
      .set(auth(who))
      .send({ clientMsgId: randomUUID(), contentJson: doc(text), contentText: text })
      .expect(201);
  const taskNotifications = (userId: string, action: string) =>
    prisma.notification.count({
      where: { userId, type: 'SYSTEM', payload: { path: ['action'], equals: action } },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string, displayName: string): Promise<Actor> => {
      const res = await http()
        .post('/auth/signup')
        .send({ email: `tasks-${name}-${run}@test.local`, password: 'password123!', displayName })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice', `Alice ${run}`);
    bob = await mk('bob', `Bobby ${run}`);
    carol = await mk('carol', `Carol ${run}`);
    mallory = await mk('mallory', `Mallory ${run}`);

    const ws = await http()
      .post('/workspaces')
      .set(auth(alice))
      .send({ name: `Tasks ${run}` })
      .expect(201);
    workspaceId = ws.body.data.id;
    for (const who of [bob, carol]) {
      const invite = await http()
        .post(`/workspaces/${workspaceId}/invites`)
        .set(auth(alice))
        .send({})
        .expect(201);
      await http()
        .post('/invites/accept')
        .set(auth(who))
        .send({ token: invite.body.data.token })
        .expect(200);
    }

    const ch = await http()
      .post(`/workspaces/${workspaceId}/channels`)
      .set(auth(alice))
      .send({ name: `tasks-${run}` })
      .expect(201);
    channelId = ch.body.data.id;
    await http().post(`/channels/${channelId}/join`).set(auth(bob)).expect(200);
    await http().post(`/channels/${channelId}/join`).set(auth(carol)).expect(200);

    const secret = await http()
      .post(`/workspaces/${workspaceId}/channels`)
      .set(auth(alice))
      .send({ name: `tasks-secret-${run}`, isPrivate: true })
      .expect(201);
    secretId = secret.body.data.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
  });

  describe('tasks', () => {
    it('creates a personal task (assigned to the creator by default) and lists it', async () => {
      const res = await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .send({ title: '  Write the plan  ' })
        .expect(201);
      expect(res.body.data.title).toBe('Write the plan');
      expect(res.body.data.assignee.id).toBe(alice.id);
      expect(res.body.data.status).toBe('OPEN');

      const list = await http()
        .get(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .expect(200);
      expect(list.body.data.map((t: { id: string }) => t.id)).toContain(res.body.data.id);
    });

    it('validates input', async () => {
      await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .send({ title: '' })
        .expect(400);
      await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .send({ title: 'x', dueAt: 'tomorrow' })
        .expect(400);
      await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(mallory))
        .send({ title: 'x' })
        .expect(404);
    });

    it('assigning notifies the assignee; only creator + assignee can see or edit it', async () => {
      const before = await taskNotifications(bob.id, 'assigned');
      const created = await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .send({ title: 'Review PR', assigneeId: bob.id })
        .expect(201);
      const id = created.body.data.id;
      expect(await taskNotifications(bob.id, 'assigned')).toBe(before + 1);

      const bobList = await http()
        .get(`/workspaces/${workspaceId}/tasks`)
        .set(auth(bob))
        .expect(200);
      expect(bobList.body.data.map((t: { id: string }) => t.id)).toContain(id);

      // Carol (same workspace, not party) and Mallory (outsider) get 404s.
      const carolList = await http()
        .get(`/workspaces/${workspaceId}/tasks`)
        .set(auth(carol))
        .expect(200);
      expect(carolList.body.data.map((t: { id: string }) => t.id)).not.toContain(id);
      await http().patch(`/tasks/${id}`).set(auth(carol)).send({ status: 'DONE' }).expect(404);
      await http().patch(`/tasks/${id}`).set(auth(mallory)).send({ status: 'DONE' }).expect(404);
      await http().delete(`/tasks/${id}`).set(auth(carol)).expect(404);

      // The assignee completes it → completedAt set, creator notified.
      const aliceBefore = await taskNotifications(alice.id, 'completed');
      const done = await http()
        .patch(`/tasks/${id}`)
        .set(auth(bob))
        .send({ status: 'DONE' })
        .expect(200);
      expect(done.body.data.status).toBe('DONE');
      expect(done.body.data.completedAt).toBeTruthy();
      expect(await taskNotifications(alice.id, 'completed')).toBe(aliceBefore + 1);

      // Reopening clears completedAt.
      const reopened = await http()
        .patch(`/tasks/${id}`)
        .set(auth(bob))
        .send({ status: 'OPEN' })
        .expect(200);
      expect(reopened.body.data.completedAt).toBeNull();

      // Only the creator may delete.
      await http().delete(`/tasks/${id}`).set(auth(bob)).expect(403);
      await http().delete(`/tasks/${id}`).set(auth(alice)).expect(200);
      expect(await prisma.task.count({ where: { id } })).toBe(0);
    });

    it('rejects assignees outside the workspace', async () => {
      await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .send({ title: 'nope', assigneeId: mallory.id })
        .expect(403);
      const mine = await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .send({ title: 'mine' })
        .expect(201);
      await http()
        .patch(`/tasks/${mine.body.data.id}`)
        .set(auth(alice))
        .send({ assigneeId: mallory.id })
        .expect(403);
      // Clearing the assignee is allowed.
      const cleared = await http()
        .patch(`/tasks/${mine.body.data.id}`)
        .set(auth(alice))
        .send({ assigneeId: null })
        .expect(200);
      expect(cleared.body.data.assignee).toBeNull();
    });

    it('a task can be made from a readable message, never from an unreadable one', async () => {
      const msg = await post(channelId, alice, 'Someone should update the runbook');
      const res = await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(bob))
        .send({ title: 'Update the runbook', messageId: msg.body.data.id })
        .expect(201);
      expect(res.body.data.messageId).toBe(msg.body.data.id);
      expect(res.body.data.channelId).toBe(channelId);

      const secretMsg = await post(secretId, alice, 'classified plan');
      await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(bob))
        .send({ title: 'leak', messageId: secretMsg.body.data.id })
        .expect(404);
    });

    it('sends exactly one due notification, and again after the deadline changes', async () => {
      const created = await http()
        .post(`/workspaces/${workspaceId}/tasks`)
        .set(auth(alice))
        .send({
          title: 'Due soon',
          assigneeId: bob.id,
          dueAt: new Date(Date.now() + 60_000).toISOString(),
        })
        .expect(201);
      const id = created.body.data.id;
      const tasks = app.get(TasksService);
      const before = await taskNotifications(bob.id, 'due');

      await tasks.notifyDue(new Date()); // not yet due
      expect(await taskNotifications(bob.id, 'due')).toBe(before);

      const later = new Date(Date.now() + 120_000);
      await tasks.notifyDue(later);
      await tasks.notifyDue(later); // idempotent
      expect(await taskNotifications(bob.id, 'due')).toBe(before + 1);

      await http()
        .patch(`/tasks/${id}`)
        .set(auth(bob))
        .send({ dueAt: new Date(Date.now() + 60_000).toISOString() })
        .expect(200);
      await tasks.notifyDue(later);
      expect(await taskNotifications(bob.id, 'due')).toBe(before + 2);

      // Completed tasks never fire.
      await http()
        .patch(`/tasks/${id}`)
        .set(auth(bob))
        .send({ status: 'DONE', dueAt: new Date(Date.now() + 60_000).toISOString() })
        .expect(200);
      await tasks.notifyDue(later);
      expect(await taskNotifications(bob.id, 'due')).toBe(before + 2);
    });

    it('turns a meeting action item into a task, auto-assigning a named owner', async () => {
      const record = await prisma.meetingRecord.create({
        data: {
          workspaceId,
          channelId,
          roomKey: `channel:${channelId}`,
          startedAt: new Date(Date.now() - 600_000),
          endedAt: new Date(),
          transcript: [],
          actionItems: ['Bobby — write the docs', 'Zed — order pizza', 'Book the retro'],
        },
      });

      const named = await http()
        .post(`/meeting-records/${record.id}/action-items/0/task`)
        .set(auth(alice))
        .expect(201);
      expect(named.body.data.assignee.id).toBe(bob.id);
      expect(named.body.data.title).toBe('write the docs');
      expect(named.body.data.meetingRecordId).toBe(record.id);

      const unknown = await http()
        .post(`/meeting-records/${record.id}/action-items/1/task`)
        .set(auth(alice))
        .expect(201);
      expect(unknown.body.data.assignee.id).toBe(alice.id);
      expect(unknown.body.data.title).toBe('Zed — order pizza');

      const plain = await http()
        .post(`/meeting-records/${record.id}/action-items/2/task`)
        .set(auth(alice))
        .expect(201);
      expect(plain.body.data.title).toBe('Book the retro');

      await http()
        .post(`/meeting-records/${record.id}/action-items/9/task`)
        .set(auth(alice))
        .expect(404);
      await http()
        .post(`/meeting-records/${record.id}/action-items/0/task`)
        .set(auth(mallory))
        .expect(404);
    });
  });

  describe('remind me about a message', () => {
    it('schedules a private reminder that links back to the message on delivery', async () => {
      const msg = await post(channelId, alice, 'Remember to rotate the keys');
      const remindAt = new Date(Date.now() + 60_000).toISOString();
      const res = await http()
        .post(`/messages/${msg.body.data.id}/remind`)
        .set(auth(bob))
        .send({ remindAt })
        .expect(201);
      expect(res.body.data.isReminder).toBe(true);
      expect(res.body.data.messageId).toBe(msg.body.data.id);
      expect(res.body.data.channelId).toBeNull(); // never posted into the channel

      const messagesBefore = await prisma.message.count({ where: { channelId } });
      await app.get(ScheduledMessagesService).deliverDue(new Date(Date.now() + 120_000));
      expect(await prisma.message.count({ where: { channelId } })).toBe(messagesBefore);

      const notif = await prisma.notification.findFirst({
        where: { userId: bob.id, type: 'SYSTEM', messageId: msg.body.data.id },
      });
      expect(notif).toBeTruthy();
      expect(notif!.channelId).toBe(channelId);
      expect((notif!.payload as { source: string }).source).toBe('reminder');
    });

    it('rejects unreadable messages and past times', async () => {
      const secretMsg = await post(secretId, alice, 'top secret');
      await http()
        .post(`/messages/${secretMsg.body.data.id}/remind`)
        .set(auth(bob))
        .send({ remindAt: new Date(Date.now() + 60_000).toISOString() })
        .expect(404);
      const msg = await post(channelId, alice, 'past');
      await http()
        .post(`/messages/${msg.body.data.id}/remind`)
        .set(auth(bob))
        .send({ remindAt: new Date(Date.now() - 1000).toISOString() })
        .expect(400);
    });
  });
});
