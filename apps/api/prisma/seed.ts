/* eslint-disable no-console */
import { PrismaClient, MentionType, NotificationType, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Deterministic PRNG so re-seeding produces the same shape of data.
let rngState = 42;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function tiptapDoc(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

const SENTENCES = [
  'Just pushed the fix for the login redirect loop, can someone review?',
  'The staging deploy is green again.',
  'Anyone else seeing flaky tests on the payments suite?',
  "Let's move the standup to 10:30 tomorrow.",
  'New designs for the onboarding flow are up in Figma.',
  'The database migration took 4 minutes in prod, no downtime.',
  'Can we get a decision on the pricing page copy today?',
  'Heads up: rotating the API keys at 5pm.',
  'The customer call went really well, they want the SSO feature.',
  'I filed a bug for the broken avatar upload.',
  'Reminder: retro notes are due by end of week.',
  'The new caching layer cut p95 latency by 40%.',
  'Who owns the notification service these days?',
  'Draft of the Q3 roadmap is ready for comments.',
  'We should upgrade Postgres before the traffic spike.',
  'The demo environment is back up.',
  'Found the memory leak — it was the event listener cleanup.',
  'Shipping the dark theme behind a feature flag today.',
  'Can someone pair with me on the websocket reconnect logic?',
  'The error rate dropped after the rollback.',
];

const THREAD_REPLIES = [
  'On it, give me 20 minutes.',
  'LGTM, approved.',
  'Interesting — can you share the stack trace?',
  'I think this is related to the config change from Tuesday.',
  '+1, this has been bugging me too.',
  'Fixed in the latest commit.',
  'Let me check the logs and get back to you.',
  'Nice catch!',
];

const EMOJIS = ['thumbsup', 'heart', 'joy', 'rocket', 'eyes', 'tada', 'fire', 'pray'];

// 1x1 red pixel PNG.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  console.log('Clearing existing data...');
  // Dependency order: children first.
  await prisma.notification.deleteMany();
  await prisma.mention.deleteMany();
  await prisma.savedItem.deleteMany();
  await prisma.pinnedMessage.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.reaction.deleteMany();
  await prisma.channelMember.updateMany({ data: { lastReadMessageId: null } });
  await prisma.conversationMember.updateMany({ data: { lastReadMessageId: null } });
  await prisma.message.deleteMany();
  await prisma.conversationMember.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.channelMember.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.workspaceInvite.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.atlassianAccountLink.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123!', 10);

  const userDefs: Array<{ email: string; displayName: string; role: WorkspaceRole }> = [
    { email: 'alice@example.com', displayName: 'Alice Chen', role: 'OWNER' },
    { email: 'bob@example.com', displayName: 'Bob Martinez', role: 'ADMIN' },
    { email: 'carol@example.com', displayName: 'Carol Okafor', role: 'MEMBER' },
    { email: 'dave@example.com', displayName: 'Dave Kim', role: 'MEMBER' },
    { email: 'erin@example.com', displayName: 'Erin Walsh', role: 'MEMBER' },
    { email: 'frank@example.com', displayName: 'Frank Novak', role: 'MEMBER' },
    { email: 'grace@example.com', displayName: 'Grace Ibarra', role: 'MEMBER' },
    { email: 'henry@example.com', displayName: 'Henry Guest', role: 'GUEST' },
  ];

  console.log('Creating users...');
  const users = [];
  for (const def of userDefs) {
    users.push(
      await prisma.user.create({
        data: { email: def.email, displayName: def.displayName, passwordHash },
      }),
    );
  }
  const [alice, bob, carol, dave, erin, frank, grace, henry] = users;

  console.log('Creating workspace...');
  const workspace = await prisma.workspace.create({
    data: { name: 'Backstages HQ', slug: 'backstages-hq', ownerId: alice.id },
  });

  for (let i = 0; i < users.length; i++) {
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: users[i].id, role: userDefs[i].role },
    });
  }

  console.log('Creating channels...');
  const fullMembers = [alice, bob, carol, dave, erin, frank, grace]; // everyone but the guest
  const channelDefs = [
    { name: 'general', isDefault: true, isPrivate: false, topic: 'Company-wide announcements', members: fullMembers },
    { name: 'engineering', isPrivate: false, topic: 'Ship it', members: [alice, bob, carol, dave, erin] },
    { name: 'design', isPrivate: false, topic: 'Pixels and flows', members: [alice, frank, grace] },
    { name: 'product', isPrivate: false, topic: 'Roadmap and priorities', members: [alice, bob, frank, grace] },
    { name: 'random', isPrivate: false, topic: 'Anything goes', members: [...fullMembers, henry] }, // guest here only
    { name: 'incidents', isPrivate: true, topic: 'Production incidents — private', members: [alice, bob, dave] },
  ];

  const channels = [];
  for (const def of channelDefs) {
    const channel = await prisma.channel.create({
      data: {
        workspaceId: workspace.id,
        name: def.name,
        topic: def.topic,
        isPrivate: def.isPrivate ?? false,
        isDefault: def.isDefault ?? false,
        createdById: alice.id,
      },
    });
    for (const m of def.members) {
      await prisma.channelMember.create({ data: { channelId: channel.id, userId: m.id } });
    }
    channels.push({ ...channel, seedMembers: def.members });
  }

  console.log('Creating conversations...');
  const dmKey = (ids: string[]) => [...ids].sort().join(':');
  const dm = await prisma.conversation.create({
    data: {
      workspaceId: workspace.id,
      isGroup: false,
      memberKey: dmKey([alice.id, bob.id]),
      members: { create: [{ userId: alice.id }, { userId: bob.id }] },
    },
  });
  const groupDm = await prisma.conversation.create({
    data: {
      workspaceId: workspace.id,
      isGroup: true,
      memberKey: dmKey([alice.id, carol.id, dave.id]),
      members: { create: [{ userId: alice.id }, { userId: carol.id }, { userId: dave.id }] },
    },
  });

  console.log('Creating messages (with threads, reactions, mentions, files)...');
  const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR ?? './uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  let messageCount = 0;
  let reactionCount = 0;
  let mentionCount = 0;
  let attachmentCount = 0;
  const baseTime = Date.now() - 14 * 24 * 60 * 60 * 1000; // spread over the last 2 weeks
  let tick = 0;

  const allParents: Array<{ id: string; channelId: string | null; conversationId: string | null }> = [];

  async function createMessage(opts: {
    channelId?: string;
    conversationId?: string;
    author: { id: string };
    text: string;
    parentId?: string;
    audience: Array<{ id: string }>;
  }) {
    tick += 1;
    const createdAt = new Date(baseTime + tick * 7 * 60 * 1000 + Math.floor(rand() * 60000));
    const msg = await prisma.message.create({
      data: {
        workspaceId: workspace.id,
        channelId: opts.channelId ?? null,
        conversationId: opts.conversationId ?? null,
        userId: opts.author.id,
        contentJson: tiptapDoc(opts.text),
        contentText: opts.text,
        parentId: opts.parentId ?? null,
        clientMsgId: randomUUID(),
        createdAt,
      },
    });
    messageCount++;

    // Occasional reactions from other members.
    if (rand() < 0.3) {
      const reactors = opts.audience.filter((u) => u.id !== opts.author.id);
      const n = 1 + Math.floor(rand() * Math.min(2, reactors.length));
      const used = new Set<string>();
      for (let i = 0; i < n && reactors.length > 0; i++) {
        const reactor = pick(reactors);
        const emoji = pick(EMOJIS);
        const key = `${reactor.id}:${emoji}`;
        if (used.has(key)) continue;
        used.add(key);
        await prisma.reaction.create({
          data: { messageId: msg.id, userId: reactor.id, emoji },
        });
        reactionCount++;
      }
    }

    return msg;
  }

  for (const channel of channels) {
    const audience = channel.seedMembers;
    const topLevelCount = channel.name === 'general' ? 40 : 25;
    for (let i = 0; i < topLevelCount; i++) {
      const author = pick(audience);
      let text = pick(SENTENCES);

      // Occasional @mention of another member.
      let mentioned: { id: string; displayName: string } | null = null;
      if (rand() < 0.15) {
        const others = audience.filter((u) => u.id !== author.id);
        if (others.length > 0) {
          mentioned = pick(others);
          text = `@${mentioned.displayName} ${text}`;
        }
      }

      const msg = await createMessage({ channelId: channel.id, author, text, audience });
      allParents.push({ id: msg.id, channelId: channel.id, conversationId: null });

      if (mentioned) {
        await prisma.mention.create({
          data: { messageId: msg.id, userId: mentioned.id, type: MentionType.USER },
        });
        await prisma.notification.create({
          data: {
            userId: mentioned.id,
            type: NotificationType.MENTION,
            actorId: author.id,
            messageId: msg.id,
            channelId: channel.id,
          },
        });
        mentionCount++;
      }

      // ~20% of top-level messages get a small thread.
      if (rand() < 0.2) {
        const replyCount = 1 + Math.floor(rand() * 3);
        for (let r = 0; r < replyCount; r++) {
          const replier = pick(audience);
          await createMessage({
            channelId: channel.id,
            author: replier,
            text: pick(THREAD_REPLIES),
            parentId: msg.id,
            audience,
          });
        }
      }
    }
  }

  // DM traffic.
  for (let i = 0; i < 12; i++) {
    const author = i % 2 === 0 ? alice : bob;
    await createMessage({ conversationId: dm.id, author, text: pick(SENTENCES), audience: [alice, bob] });
  }
  for (let i = 0; i < 10; i++) {
    const author = pick([alice, carol, dave]);
    await createMessage({
      conversationId: groupDm.id,
      author,
      text: pick(SENTENCES),
      audience: [alice, carol, dave],
    });
  }

  // A few messages with real file attachments.
  const fileDefs = [
    { filename: 'screenshot.png', mimeType: 'image/png', bytes: PNG_BYTES, width: 1, height: 1 },
    { filename: 'logo.png', mimeType: 'image/png', bytes: PNG_BYTES, width: 1, height: 1 },
    { filename: 'meeting-notes.txt', mimeType: 'text/plain', bytes: Buffer.from('Q3 planning notes:\n- Ship Atlassian integration\n- Harden auth\n') },
  ];
  const engineering = channels.find((c) => c.name === 'engineering')!;
  for (const fd of fileDefs) {
    const storageKey = `${randomUUID()}-${fd.filename}`;
    fs.writeFileSync(path.join(uploadDir, storageKey), fd.bytes);
    const author = pick(engineering.seedMembers);
    const msg = await createMessage({
      channelId: engineering.id,
      author,
      text: `Uploaded ${fd.filename}`,
      audience: engineering.seedMembers,
    });
    await prisma.attachment.create({
      data: {
        messageId: msg.id,
        uploaderId: author.id,
        filename: fd.filename,
        mimeType: fd.mimeType,
        sizeBytes: fd.bytes.length,
        storageKey,
        width: 'width' in fd ? (fd as { width?: number }).width ?? null : null,
        height: 'height' in fd ? (fd as { height?: number }).height ?? null : null,
      },
    });
    attachmentCount++;
  }

  // Pins and saved items.
  const pinnable = allParents.slice(0, 3);
  for (const p of pinnable) {
    await prisma.pinnedMessage.create({ data: { messageId: p.id, pinnedById: alice.id } });
  }
  for (const p of allParents.slice(3, 8)) {
    await prisma.savedItem.create({ data: { userId: alice.id, messageId: p.id } });
  }

  // Mark some channels read up to the latest message.
  for (const channel of channels) {
    const latest = await prisma.message.findFirst({
      where: { channelId: channel.id, parentId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) continue;
    for (const m of channel.seedMembers.slice(0, 3)) {
      await prisma.channelMember.update({
        where: { channelId_userId: { channelId: channel.id, userId: m.id } },
        data: { lastReadMessageId: latest.id },
      });
    }
  }

  // A pending email invite, to exercise the invite flow.
  await prisma.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      email: 'newhire@example.com',
      tokenHash: createHash('sha256').update('seed-invite-token').digest('hex'),
      createdById: alice.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('\nSeed complete. Row counts:');
  const counts: Record<string, number> = {
    users: await prisma.user.count(),
    workspaces: await prisma.workspace.count(),
    workspaceMembers: await prisma.workspaceMember.count(),
    workspaceInvites: await prisma.workspaceInvite.count(),
    channels: await prisma.channel.count(),
    channelMembers: await prisma.channelMember.count(),
    conversations: await prisma.conversation.count(),
    conversationMembers: await prisma.conversationMember.count(),
    messages: await prisma.message.count(),
    reactions: await prisma.reaction.count(),
    attachments: await prisma.attachment.count(),
    pinnedMessages: await prisma.pinnedMessage.count(),
    savedItems: await prisma.savedItem.count(),
    mentions: await prisma.mention.count(),
    notifications: await prisma.notification.count(),
  };
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count}`);
  }
  console.log(
    `\n(created this run: ${messageCount} messages, ${reactionCount} reactions, ${mentionCount} mentions, ${attachmentCount} attachments)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
