import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Format an instant as an ICS UTC datetime (YYYYMMDDTHHMMSSZ). */
const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

describe('my day (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevFlag = process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;

  interface Actor {
    id: string;
    token: string;
  }
  let alice: Actor;
  let bob: Actor;
  let mallory: Actor;
  let workspaceId: string;
  let channelId: string;
  let icsServer: http.Server;
  let icsPort = 0;
  let icsBody = '';

  // Pick an offset that makes "now" local noon, so "today" never straddles midnight.
  const now = new Date();
  const tz = 12 * 60 - (now.getUTCHours() * 60 + now.getUTCMinutes());
  const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();

  const httpc = () => request(app.getHttpServer());
  const auth = (a: Actor) => ({ Authorization: `Bearer ${a.token}` });
  const myDay = (who: Actor, tzParam: string | number = tz) =>
    httpc().get(`/workspaces/${workspaceId}/my-day?tz=${tzParam}`).set(auth(who));

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY; // never call the real model from tests
    icsServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/calendar' });
      res.end(icsBody);
    });
    await new Promise<void>((r) => icsServer.listen(0, '127.0.0.1', r));
    icsPort = (icsServer.address() as AddressInfo).port;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const mk = async (name: string): Promise<Actor> => {
      const res = await httpc()
        .post('/auth/signup')
        .send({
          email: `md-${name}-${run}@test.local`,
          password: 'password123!',
          displayName: `${name} md`,
        })
        .expect(201);
      return { id: res.body.data.user.id, token: res.body.data.accessToken };
    };
    alice = await mk('alice');
    bob = await mk('bob');
    mallory = await mk('mallory');
    workspaceId = (
      await httpc()
        .post('/workspaces')
        .set(auth(alice))
        .send({ name: `MyDay ${run}` })
        .expect(201)
    ).body.data.id;
    const invite = await httpc()
      .post(`/workspaces/${workspaceId}/invites`)
      .set(auth(alice))
      .send({})
      .expect(201);
    await httpc()
      .post('/invites/accept')
      .set(auth(bob))
      .send({ token: invite.body.data.token })
      .expect(200);
    channelId = (
      await httpc()
        .post(`/workspaces/${workspaceId}/channels`)
        .set(auth(alice))
        .send({ name: `md-${run}` })
        .expect(201)
    ).body.data.id;
    await httpc().post(`/channels/${channelId}/join`).set(auth(bob)).expect(200);
  });

  afterAll(async () => {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevFlag === undefined) delete process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;
    else process.env.OUTBOUND_HTTP_ALLOW_PRIVATE = prevFlag;
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@test.local` } } });
    await app.close();
    await new Promise((r) => icsServer.close(r));
  });

  it('builds the day: tasks in order, meetings, counts, integration states', async () => {
    const mkTask = (who: Actor, body: object) =>
      httpc().post(`/workspaces/${workspaceId}/tasks`).set(auth(who)).send(body).expect(201);
    await mkTask(alice, { title: 'Undated thing' });
    await mkTask(alice, { title: 'Due this afternoon', dueAt: at(120) });
    await mkTask(alice, { title: 'Late report', dueAt: at(-24 * 60) });
    await mkTask(bob, { title: 'Review for Bob', assigneeId: alice.id });
    await mkTask(alice, { title: 'Handed to Bob', assigneeId: bob.id }); // not Alice's to do
    const doneTask = (await mkTask(alice, { title: 'Already done' })).body.data.id;
    await httpc().patch(`/tasks/${doneTask}`).set(auth(alice)).send({ status: 'DONE' }).expect(200);

    await httpc()
      .post(`/channels/${channelId}/scheduled-huddles`)
      .set(auth(bob))
      .send({ title: 'Design sync', scheduledFor: at(30), durationMins: 30 })
      .expect(201);

    const res = await myDay(alice).expect(200);
    const d = res.body.data;
    expect(d.tzOffsetMin).toBe(tz);
    expect(d.focus.map((f: { title: string }) => f.title)).toEqual([
      'Late report',
      'Due this afternoon',
      'Undated thing',
      'Review for Bob',
    ]);
    expect(d.focus[0]).toMatchObject({ kind: 'task', reason: 'Overdue', overdue: true });
    expect(d.focus[1].reason).toBe('Due today');
    expect(d.focus[3].detail).toBe('From bob md');
    expect(d.meetings).toHaveLength(1);
    expect(d.meetings[0]).toMatchObject({ title: 'Design sync', source: 'huddle', channelId });
    expect(d.meetings[0].end).toBeTruthy();
    expect(d.counts).toEqual({ overdue: 1, dueToday: 1, requests: 0, jira: 0, meetings: 1 });
    expect(d.jira.state).toBe('not_connected');
    expect(d.calendar.state).toBe('none');
  });

  it('puts pending workflow requests first', async () => {
    await httpc()
      .post(`/workspaces/${workspaceId}/workflows`)
      .set(auth(alice))
      .send({
        name: 'Approve it',
        trigger: 'message_posted',
        config: {
          channelId,
          keyword: 'needs-ok',
          actions: [{ type: 'request_approval', approver: alice.id, prompt: 'OK {{message}}?' }],
        },
      })
      .expect(201);
    await httpc()
      .post(`/channels/${channelId}/messages`)
      .set(auth(bob))
      .send({
        clientMsgId: randomUUID(),
        contentText: 'needs-ok budget',
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'needs-ok budget' }] }],
        },
      })
      .expect(201);
    let first: { kind: string; title: string } | undefined;
    for (let i = 0; i < 40 && first?.kind !== 'request'; i++) {
      first = (await myDay(alice).expect(200)).body.data.focus[0];
      if (first?.kind !== 'request') await new Promise((r) => setTimeout(r, 50));
    }
    expect(first).toMatchObject({ kind: 'request', title: 'OK needs-ok budget?' });
  });

  it('shows calendar events from a linked ICS feed (through the SSRF guard)', async () => {
    // Normal mode refuses a private feed URL outright…
    delete process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;
    await httpc()
      .put('/me/calendar')
      .set(auth(alice))
      .send({ icsUrl: `http://127.0.0.1:${icsPort}/cal.ics` })
      .expect(400);
    await httpc()
      .put('/me/calendar')
      .set(auth(alice))
      .send({ icsUrl: 'http://169.254.169.254/latest' })
      .expect(400);

    // …dev mode lets the local test server through.
    process.env.OUTBOUND_HTTP_ALLOW_PRIVATE = '1';
    const start = new Date(Date.now() + 60 * 60_000);
    icsBody = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(new Date(start.getTime() + 30 * 60_000))}`,
      'SUMMARY:Customer call\\, ACME',
      'END:VEVENT',
      'BEGIN:VEVENT',
      `DTSTART:${icsDate(new Date(Date.now() + 3 * 86_400_000))}`,
      `DTEND:${icsDate(new Date(Date.now() + 3 * 86_400_000 + 3_600_000))}`,
      'SUMMARY:Not today',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    await httpc()
      .put('/me/calendar')
      .set(auth(alice))
      .send({ icsUrl: `http://127.0.0.1:${icsPort}/cal.ics` })
      .expect(200);

    const d = (await myDay(alice).expect(200)).body.data;
    expect(d.calendar.state).toBe('ok');
    const cal = d.meetings.filter((m: { source: string }) => m.source === 'calendar');
    expect(cal.map((m: { title: string }) => m.title)).toEqual(['Customer call, ACME']);
    delete process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;
  });

  it('plan falls back to the standard order without AI; validates tz; is member-only', async () => {
    const day = (await myDay(alice).expect(200)).body.data;
    const plan = await httpc()
      .post(`/workspaces/${workspaceId}/my-day/plan?tz=${tz}`)
      .set(auth(alice))
      .expect(200);
    expect(plan.body.data.aiUsed).toBe(false);
    expect(plan.body.data.focus.map((f: { id: string }) => f.id)).toEqual(
      day.focus.map((f: { id: string }) => f.id),
    );

    await myDay(alice, 'abc').expect(400);
    await myDay(alice, 9999).expect(400);
    await myDay(mallory).expect(404);
    // Bob's day doesn't include Alice's tasks.
    const bobDay = (await myDay(bob).expect(200)).body.data;
    expect(bobDay.focus.map((f: { title: string }) => f.title)).toEqual(['Handed to Bob']);
  });
});
