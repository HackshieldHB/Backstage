import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as http from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Seeing teammates' calendars: opt-in visibility, and per-event privacy — a
 * shared calendar must never reveal a meeting in a channel/DM the viewer isn't in.
 */
describe('calendar sharing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());
  const auth = (a: { token: string }) => ({ Authorization: `Bearer ${a.token}` });

  interface Actor {
    id: string;
    token: string;
  }
  let viewer: Actor; // looks at the calendar
  let owner: Actor; // shares their calendar
  let third: Actor; // shares a private channel + DM with `owner`
  let outsider: Actor;
  let workspaceId: string;

  let feed: http.Server;
  let feedUrl = '';
  const privateBefore = process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;

  // Tomorrow 09:00–17:00 UTC is our window.
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCHours(0, 0, 0, 0);
  const at = (h: number, m = 0) => new Date(day.getTime() + (h * 60 + m) * 60_000);
  const from = at(0).toISOString();
  const to = at(24).toISOString();
  const ics = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const signup = async (name: string): Promise<Actor> => {
    const res = await api()
      .post('/auth/signup')
      .send({ email: `cal-${name}-${run}@test.local`, password: 'password123!', displayName: `${name} cal` })
      .expect(201);
    return { id: res.body.data.user.id, token: res.body.data.accessToken };
  };
  const schedule = async (who: Actor, path: string, title: string, hour: number) =>
    (
      await api()
        .post(`${path}/scheduled-huddles`)
        .set(auth(who))
        .send({ title, scheduledFor: at(hour).toISOString(), durationMins: 60 })
        .expect(201)
    ).body.data as { id: string };
  const calendarsOf = (who: Actor, ids: string[]) =>
    api()
      .get(`/workspaces/${workspaceId}/people-calendars?users=${ids.join(',')}&from=${from}&to=${to}`)
      .set(auth(who));
  const share = (visibility: string) =>
    api().put(`/workspaces/${workspaceId}/calendar-sharing`).set(auth(owner)).send({ visibility }).expect(200);

  beforeAll(async () => {
    // A local ICS feed standing in for the owner's Google/Outlook calendar.
    process.env.OUTBOUND_HTTP_ALLOW_PRIVATE = '1';
    feed = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end(
        ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `DTSTART:${ics(at(15))}`, `DTEND:${ics(at(16))}`, 'SUMMARY:Dentist', 'END:VEVENT', 'END:VCALENDAR'].join(
          '\r\n',
        ),
      );
    });
    await new Promise<void>((r) => feed.listen(0, '127.0.0.1', r));
    feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/secret-feed-token-${run}.ics`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    viewer = await signup('viewer');
    owner = await signup('owner');
    third = await signup('third');
    outsider = await signup('outsider');
    workspaceId = (await api().post('/workspaces').set(auth(viewer)).send({ name: `Cal ${run}` }).expect(201)).body.data.id;
    for (const who of [owner, third]) {
      const invite = await api().post(`/workspaces/${workspaceId}/invites`).set(auth(viewer)).send({}).expect(201);
      await api().post('/invites/accept').set(auth(who)).send({ token: invite.body.data.token }).expect(200);
    }

    const sharedCh = (await api().post(`/workspaces/${workspaceId}/channels`).set(auth(viewer)).send({ name: `shared-${run}` }).expect(201))
      .body.data.id;
    await api().post(`/channels/${sharedCh}/join`).set(auth(owner)).expect((r) => expect([200, 201]).toContain(r.status));
    const secretCh = (
      await api().post(`/workspaces/${workspaceId}/channels`).set(auth(owner)).send({ name: `secret-${run}`, isPrivate: true }).expect(201)
    ).body.data.id;
    await api().post(`/channels/${secretCh}/members`).set(auth(owner)).send({ userId: third.id }).expect((r) => expect([200, 201]).toContain(r.status));
    const dm = (
      await api().post(`/workspaces/${workspaceId}/conversations`).set(auth(owner)).send({ memberIds: [third.id] }).expect(200)
    ).body.data.id;

    await schedule(owner, `/channels/${sharedCh}`, 'Shared standup', 9);
    await schedule(owner, `/channels/${secretCh}`, 'Secret plan', 11);
    await schedule(owner, `/conversations/${dm}`, 'Private 1:1', 13);
    const declined = await schedule(viewer, `/channels/${sharedCh}`, 'Skipped review', 14);
    await api().post(`/scheduled-huddles/${declined.id}/respond`).set(auth(owner)).send({ response: 'DECLINED' }).expect(201);

    await prisma.calendarLink.create({ data: { userId: owner.id, icsUrl: feedUrl } });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { contains: run } } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
    await new Promise((r) => feed.close(r));
    if (privateBefore === undefined) delete process.env.OUTBOUND_HTTP_ALLOW_PRIVATE;
    else process.env.OUTBOUND_HTTP_ALLOW_PRIVATE = privateBefore;
  });

  it('is private by default', async () => {
    const mine = await api().get(`/workspaces/${workspaceId}/calendar-sharing`).set(auth(owner)).expect(200);
    expect(mine.body.data).toEqual({ visibility: 'PRIVATE' });
    const res = await calendarsOf(viewer, [owner.id]).expect(200);
    expect(res.body.data).toEqual([{ userId: owner.id, visibility: 'PRIVATE', events: [], externalUnavailable: false }]);
    const people = await api().get(`/workspaces/${workspaceId}/shared-calendars`).set(auth(viewer)).expect(200);
    expect(people.body.data.map((p: { userId: string }) => p.userId)).not.toContain(owner.id);
  });

  it('free/busy shows when, never what', async () => {
    await share('FREE_BUSY');
    const people = await api().get(`/workspaces/${workspaceId}/shared-calendars`).set(auth(viewer)).expect(200);
    expect(people.body.data).toEqual([expect.objectContaining({ userId: owner.id, visibility: 'FREE_BUSY' })]);

    const res = await calendarsOf(viewer, [owner.id]).expect(200);
    const events = res.body.data[0].events as { start: string; title: string | null; meetingId: string | null; source: string }[];
    // 3 meetings + the dentist; the declined meeting doesn't count.
    expect(events.map((e) => [new Date(e.start).getUTCHours(), e.source])).toEqual([
      [9, 'meeting'],
      [11, 'meeting'],
      [13, 'meeting'],
      [15, 'external'],
    ]);
    expect(events.every((e) => e.title === null && e.meetingId === null)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('secret-feed-token');
  });

  it('details show titles only for meetings the viewer could open', async () => {
    await share('DETAILS');
    const res = await calendarsOf(viewer, [owner.id]).expect(200);
    const events = res.body.data[0].events as { title: string | null; meetingId: string | null }[];
    expect(events.map((e) => e.title)).toEqual(['Shared standup', null, null, 'Dentist']);
    expect(events[0].meetingId).toBeTruthy();
    expect(events[1].meetingId).toBeNull();

    // `third` is in the secret channel and the DM, so they see those titles.
    const theirs = await calendarsOf(third, [owner.id]).expect(200);
    expect((theirs.body.data[0].events as { title: string | null }[]).map((e) => e.title)).toEqual([
      null, // not in #shared
      'Secret plan',
      'Private 1:1',
      'Dentist',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Secret plan');
  });

  it('keeps outsiders and deactivated people out', async () => {
    await calendarsOf(outsider, [owner.id]).expect(404);
    await api().get(`/workspaces/${workspaceId}/shared-calendars`).set(auth(outsider)).expect(404);
    // A user who isn't in this workspace looks exactly like a private one.
    const res = await calendarsOf(viewer, [outsider.id]).expect(200);
    expect(res.body.data[0]).toMatchObject({ visibility: 'PRIVATE', events: [] });

    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: owner.id } },
      data: { deactivatedAt: new Date() },
    });
    try {
      const gone = await calendarsOf(viewer, [owner.id]).expect(200);
      expect(gone.body.data[0]).toMatchObject({ visibility: 'PRIVATE', events: [] });
    } finally {
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: owner.id } },
        data: { deactivatedAt: null },
      });
    }
  });

  it('validates input and lets you see your own calendar', async () => {
    await api().put(`/workspaces/${workspaceId}/calendar-sharing`).set(auth(owner)).send({ visibility: 'EVERYONE' }).expect(400);
    const many = Array.from({ length: 11 }, (_, i) => `u${i}`);
    await calendarsOf(viewer, many).expect(400);
    await api()
      .get(`/workspaces/${workspaceId}/people-calendars?users=${owner.id}&from=${from}&to=${at(24 * 40).toISOString()}`)
      .set(auth(viewer))
      .expect(400);
    await share('PRIVATE');
    const self = await calendarsOf(owner, [owner.id]).expect(200);
    expect(self.body.data[0].visibility).toBe('DETAILS');
    expect(self.body.data[0].events.map((e: { title: string }) => e.title)).toContain('Secret plan');
  });
});
