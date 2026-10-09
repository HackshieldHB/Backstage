import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SearchQueryInput, SearchResponse } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { parseSearchQuery } from './query-parser';
import { messageInclude, toMessageDto } from '../messages/message-serializer';
import { toUserDto } from '../auth/auth.service';
import { toAttachmentDto } from '../attachments/attachments.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async search(userId: string, workspaceId: string, input: SearchQueryInput): Promise<SearchResponse> {
    // Everything below is scoped to containers this caller can actually read.
    const { channelIds, conversationIds } = await this.policy.accessibleContainers(
      userId,
      workspaceId,
    );
    // Channels other workspaces shared into this one (joined) are searchable here too.
    const sharedIds = await this.policy.sharedChannelIdsIn(userId, workspaceId);
    const parsed = parseSearchQuery(input.q);

    const response: SearchResponse = {
      messages: [],
      files: [],
      channels: [],
      people: [],
      decisions: [],
      tasks: [],
    };
    const wants = (t: string) => input.type === 'all' || input.type === t;

    if (wants('messages')) {
      response.messages = await this.searchMessages(
        workspaceId,
        channelIds,
        conversationIds,
        sharedIds,
        parsed,
        input.limit,
      );
    }
    if (wants('files')) {
      response.files = await this.searchFiles([...channelIds, ...sharedIds], conversationIds, parsed, input.limit);
    }
    if (wants('channels') && parsed.text) {
      response.channels = await this.searchChannels(userId, workspaceId, channelIds, sharedIds, parsed.text, input.limit);
    }
    if (wants('people') && parsed.text) {
      response.people = await this.searchPeople(workspaceId, parsed.text, input.limit);
    }
    if (wants('tasks') && parsed.text) {
      response.tasks = await this.searchTasks(userId, workspaceId, parsed.text, input.limit);
    }
    if (wants('decisions') && parsed.text) {
      response.decisions = await this.searchDecisions(
        workspaceId,
        channelIds,
        parsed.text,
        input.limit,
      );
    }
    return response;
  }

  /** Only tasks the caller created or is assigned — the same visibility as the Tasks pane. */
  private async searchTasks(userId: string, workspaceId: string, text: string, limit: number) {
    const rows = await this.prisma.task.findMany({
      where: {
        workspaceId,
        OR: [{ createdById: userId }, { assigneeId: userId }],
        AND: [
          {
            OR: [
              { title: { contains: text, mode: 'insensitive' } },
              { notes: { contains: text, mode: 'insensitive' } },
            ],
          },
        ],
      },
      include: { assignee: { select: { displayName: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      status: t.status,
      dueAt: t.dueAt?.toISOString() ?? null,
      assigneeName: t.assignee?.displayName ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  private async searchDecisions(
    workspaceId: string,
    channelIds: string[],
    text: string,
    limit: number,
  ) {
    if (channelIds.length === 0) return [];
    const rows = await this.prisma.decision.findMany({
      where: {
        workspaceId,
        channelId: { in: channelIds },
        OR: [
          { title: { contains: text, mode: 'insensitive' } },
          { detail: { contains: text, mode: 'insensitive' } },
          { outcome: { contains: text, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return rows.map((d) => ({
      id: d.id,
      channelId: d.channelId,
      title: d.title,
      detail: d.detail,
      status: d.status,
      outcome: d.outcome,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  private async searchMessages(
    workspaceId: string,
    channelIds: string[],
    conversationIds: string[],
    sharedIds: string[],
    parsed: ReturnType<typeof parseSearchQuery>,
    limit: number,
  ) {
    if (channelIds.length === 0 && conversationIds.length === 0 && sharedIds.length === 0) return [];
    const allChannelIds = [...channelIds, ...sharedIds];

    const conditions: Prisma.Sql[] = [
      // This workspace's messages, plus those of channels shared into it.
      Prisma.sql`(m."workspaceId" = ${workspaceId} OR m."channelId" = ANY(${sharedIds}))`,
      Prisma.sql`m."deletedAt" IS NULL`,
      Prisma.sql`(m."channelId" = ANY(${allChannelIds}) OR m."conversationId" = ANY(${conversationIds}))`,
    ];

    if (parsed.text) {
      conditions.push(
        Prisma.sql`m."searchVector" @@ websearch_to_tsquery('english', ${parsed.text})`,
      );
    }
    if (parsed.from) {
      const users = await this.prisma.user.findMany({
        where: {
          AND: [
            {
              OR: [
                { workspaceMemberships: { some: { workspaceId } } },
                // Partners of a shared channel the caller can read.
                { channelMemberships: { some: { channelId: { in: allChannelIds } } } },
              ],
            },
          ],
          OR: [
            { email: { equals: parsed.from, mode: 'insensitive' } },
            { displayName: { contains: parsed.from, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      const ids = users.map((u) => u.id);
      if (ids.length === 0) return [];
      conditions.push(Prisma.sql`m."userId" = ANY(${ids})`);
    }
    if (parsed.in) {
      const channel = await this.prisma.channel.findFirst({
        where: {
          name: parsed.in,
          OR: [{ workspaceId, id: { in: channelIds } }, { id: { in: sharedIds } }],
        },
        select: { id: true },
      });
      if (!channel) return []; // unknown or inaccessible channel: empty, never leak
      conditions.push(Prisma.sql`m."channelId" = ${channel.id}`);
    }
    if (parsed.before) conditions.push(Prisma.sql`m."createdAt" < ${parsed.before}`);
    if (parsed.after) conditions.push(Prisma.sql`m."createdAt" > ${parsed.after}`);
    if (parsed.hasLink) conditions.push(Prisma.sql`m."contentText" ~* 'https?://'`);
    if (parsed.hasFile) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "Attachment" a WHERE a."messageId" = m.id)`,
      );
    }

    const where = Prisma.join(conditions, ' AND ');
    const order = parsed.text
      ? Prisma.sql`ts_rank(m."searchVector", websearch_to_tsquery('english', ${parsed.text})) DESC, m."createdAt" DESC`
      : Prisma.sql`m."createdAt" DESC`;

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT m.id FROM "Message" m WHERE ${where} ORDER BY ${order} LIMIT ${limit}`,
    );
    if (rows.length === 0) return [];

    const messages = await this.prisma.message.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: messageInclude,
    });
    const byId = new Map(messages.map((m) => [m.id, m]));
    return rows.map((r) => toMessageDto(byId.get(r.id)!)).filter(Boolean);
  }

  private async searchFiles(
    channelIds: string[],
    conversationIds: string[],
    parsed: ReturnType<typeof parseSearchQuery>,
    limit: number,
  ) {
    const rows = await this.prisma.attachment.findMany({
      where: {
        ...(parsed.text ? { filename: { contains: parsed.text, mode: 'insensitive' } } : {}),
        message: {
          is: {
            deletedAt: null,
            OR: [{ channelId: { in: channelIds } }, { conversationId: { in: conversationIds } }],
          },
        },
      },
      include: { uploader: true, message: { select: { id: true, channelId: true, conversationId: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((a) => ({
      ...toAttachmentDto(a),
      messageId: a.message?.id ?? null,
      channelId: a.message?.channelId ?? null,
      conversationId: a.message?.conversationId ?? null,
      uploader: a.uploader ? toUserDto(a.uploader) : null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  private async searchChannels(
    userId: string,
    workspaceId: string,
    memberChannelIds: string[],
    sharedIds: string[],
    text: string,
    limit: number,
  ) {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.channel.findMany({
      where: {
        name: { contains: text, mode: 'insensitive' },
        OR: [
          {
            workspaceId,
            // Guests search only their channels; others also see public ones.
            ...(member.role === 'GUEST'
              ? { id: { in: memberChannelIds } }
              : { OR: [{ isPrivate: false }, { id: { in: memberChannelIds } }] }),
          },
          // Joined channels shared into this workspace.
          { id: { in: sharedIds } },
        ],
      },
      include: { _count: { select: { members: true } } },
      take: limit,
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      workspaceId: c.workspaceId,
      name: c.name,
      topic: c.topic,
      description: c.description,
      isPrivate: c.isPrivate,
      isArchived: c.isArchived,
      isDefault: c.isDefault,
      memberCount: c._count.members,
      isMember: memberChannelIds.includes(c.id) || sharedIds.includes(c.id),
    }));
  }

  private async searchPeople(workspaceId: string, text: string, limit: number) {
    const rows = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        deactivatedAt: null,
        user: {
          OR: [
            { displayName: { contains: text, mode: 'insensitive' } },
            { email: { contains: text, mode: 'insensitive' } },
          ],
        },
      },
      include: { user: true },
      take: limit,
    });
    return rows.map((m) => toUserDto(m.user));
  }
}
