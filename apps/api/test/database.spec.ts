import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Integration tests against the real database: verifies the hand-written FTS
 * migration (trigger + GIN index) and the message container check constraint.
 * Requires PostgreSQL running with migrations applied (see README).
 */
describe('database schema', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  let userId: string;
  let workspaceId: string;
  let channelId: string;
  let conversationId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `dbspec-${suffix}@test.local`, displayName: 'DB Spec', passwordHash: 'x' },
    });
    userId = user.id;
    const workspace = await prisma.workspace.create({
      data: { name: 'DB Spec WS', slug: `dbspec-${suffix}`, ownerId: userId },
    });
    workspaceId = workspace.id;
    const channel = await prisma.channel.create({
      data: { workspaceId, name: `dbspec-${suffix}` },
    });
    channelId = channel.id;
    const conversation = await prisma.conversation.create({
      data: { workspaceId, memberKey: `dbspec:${suffix}` },
    });
    conversationId = conversation.id;
  });

  afterAll(async () => {
    // Workspace cascade removes channels/conversations/messages.
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('populates searchVector via trigger on insert and finds it with an FTS query', async () => {
    const marker = `zebrafish-${suffix}`;
    const message = await prisma.message.create({
      data: {
        workspaceId,
        channelId,
        userId,
        contentJson: { type: 'doc' },
        contentText: `The ${marker} swims upstream`,
      },
    });

    const hits = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "Message" WHERE "searchVector" @@ plainto_tsquery('english', ${marker})`,
    );
    expect(hits.map((h) => h.id)).toContain(message.id);
  });

  it('updates searchVector via trigger when contentText changes', async () => {
    const before = `quokka-${suffix}`;
    const after = `wombat-${suffix}`;
    const message = await prisma.message.create({
      data: {
        workspaceId,
        channelId,
        userId,
        contentJson: { type: 'doc' },
        contentText: `original ${before}`,
      },
    });
    await prisma.message.update({
      where: { id: message.id },
      data: { contentText: `edited ${after}` },
    });

    const afterHits = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "Message" WHERE "searchVector" @@ plainto_tsquery('english', ${after})`,
    );
    const beforeHits = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "Message" WHERE "searchVector" @@ plainto_tsquery('english', ${before})`,
    );
    expect(afterHits.map((h) => h.id)).toContain(message.id);
    expect(beforeHits.map((h) => h.id)).not.toContain(message.id);
  });

  it('has a GIN index on searchVector', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>(
      Prisma.sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'Message' AND indexname = 'Message_searchVector_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/USING gin/i);
  });

  it('rejects a message with both channelId and conversationId', async () => {
    await expect(
      prisma.message.create({
        data: {
          workspaceId,
          channelId,
          conversationId,
          userId,
          contentJson: { type: 'doc' },
          contentText: 'in two places at once',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a message with neither channelId nor conversationId', async () => {
    await expect(
      prisma.message.create({
        data: {
          workspaceId,
          userId,
          contentJson: { type: 'doc' },
          contentText: 'nowhere at all',
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces idempotency: duplicate (userId, clientMsgId) is rejected', async () => {
    const clientMsgId = randomUUID();
    await prisma.message.create({
      data: {
        workspaceId,
        channelId,
        userId,
        contentJson: { type: 'doc' },
        contentText: 'first send',
        clientMsgId,
      },
    });
    await expect(
      prisma.message.create({
        data: {
          workspaceId,
          channelId,
          userId,
          contentJson: { type: 'doc' },
          contentText: 'duplicate send',
          clientMsgId,
        },
      }),
    ).rejects.toThrow();
  });
});
