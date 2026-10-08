import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  RetentionSettingsDto,
  RetentionSettingsInput,
  WorkspaceExportDto,
  WorkspaceExportScope,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';
import { StorageService } from '../storage/storage.service';

const PURGE_BATCH = 500;
/** One sweep never deletes more than this per workspace; the next run continues. */
const PURGE_MAX_PER_RUN = 20_000;
export const EXPORT_MAX_MESSAGES = 50_000;

/**
 * Message retention and workspace export.
 *
 * Retention: with `retentionDays` set and no legal hold, messages older than the
 * window are permanently deleted (with their reactions, files, edits, …). A
 * thread root is kept while any reply is still inside the window, so a live
 * thread never loses its parent. Legal hold suspends all deletion.
 *
 * Export: admins get public channels; the owner may also include private
 * channels and direct messages. Every export is audit-logged.
 */
@Injectable()
export class DataGovernanceService {
  private readonly logger = new Logger(DataGovernanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async getRetention(userId: string, workspaceId: string): Promise<RetentionSettingsDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return { retentionDays: ws.retentionDays, legalHold: ws.legalHold };
  }

  async setRetention(
    userId: string,
    workspaceId: string,
    input: RetentionSettingsInput,
  ): Promise<RetentionSettingsDto> {
    // Deleting history is irreversible — owner only.
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'OWNER');
    const ws = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { retentionDays: input.retentionDays, legalHold: input.legalHold },
    });
    this.audit.record(workspaceId, userId, 'retention.update', {
      targetType: 'workspace',
      targetId: workspaceId,
      meta: { retentionDays: input.retentionDays, legalHold: input.legalHold },
    });
    return { retentionDays: ws.retentionDays, legalHold: ws.legalHold };
  }

  /** Apply every workspace's retention policy. Returns the number of messages deleted. */
  async sweep(now = new Date()): Promise<number> {
    const workspaces = await this.prisma.workspace.findMany({
      where: { retentionDays: { not: null }, legalHold: false },
      select: { id: true, retentionDays: true },
    });
    let total = 0;
    for (const ws of workspaces) {
      const deleted = await this.purgeWorkspace(ws.id, ws.retentionDays!, now);
      if (deleted > 0) {
        total += deleted;
        this.audit.record(ws.id, null, 'retention.purge', {
          targetType: 'workspace',
          targetId: ws.id,
          meta: { deleted, retentionDays: ws.retentionDays },
        });
      }
    }
    return total;
  }

  private async purgeWorkspace(workspaceId: string, days: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const where: Prisma.MessageWhereInput = {
      workspaceId,
      createdAt: { lt: cutoff },
      OR: [{ parentId: { not: null } }, { replies: { none: { createdAt: { gte: cutoff } } } }],
    };
    let deleted = 0;
    while (deleted < PURGE_MAX_PER_RUN) {
      // Oldest first. A root's old replies go with it by cascade (all are past the cutoff).
      const batch = await this.prisma.message.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: PURGE_BATCH,
      });
      if (batch.length === 0) break;
      const ids = batch.map((m) => m.id);
      const files = await this.prisma.attachment.findMany({
        where: { message: { OR: [{ id: { in: ids } }, { parentId: { in: ids } }] } },
        select: { storageKey: true },
      });
      // Re-check the cutoff inside the delete: a reply posted meanwhile keeps its root.
      const { count } = await this.prisma.message.deleteMany({ where: { ...where, id: { in: ids } } });
      deleted += count;
      for (const f of files) await this.storage.delete(f.storageKey).catch(() => undefined);
      if (count === 0) break;
    }
    if (deleted > 0) this.logger.log(`Retention removed ${deleted} message(s) from workspace ${workspaceId}`);
    return deleted;
  }

  async export(userId: string, workspaceId: string, scope: WorkspaceExportScope): Promise<WorkspaceExportDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, scope === 'all' ? 'OWNER' : 'ADMIN');
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, displayName: true, isBot: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const channels = await this.prisma.channel.findMany({
      where: { workspaceId, ...(scope === 'all' ? {} : { isPrivate: false }) },
      orderBy: { createdAt: 'asc' },
    });
    const conversations =
      scope === 'all'
        ? await this.prisma.conversation.findMany({
            where: { workspaceId },
            include: { members: { select: { userId: true } } },
            orderBy: { createdAt: 'asc' },
          })
        : [];

    let remaining = EXPORT_MAX_MESSAGES;
    let truncated = false;
    const loadMessages = async (filter: Prisma.MessageWhereInput) => {
      if (remaining <= 0) {
        truncated = true;
        return [];
      }
      const rows = await this.prisma.message.findMany({
        where: { workspaceId, deletedAt: null, ...filter },
        select: {
          id: true,
          userId: true,
          parentId: true,
          contentText: true,
          kind: true,
          createdAt: true,
          editedAt: true,
          attachments: { select: { filename: true, mimeType: true, sizeBytes: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: remaining + 1,
      });
      if (rows.length > remaining) {
        truncated = true;
        rows.length = remaining;
      }
      remaining -= rows.length;
      return rows.map((m) => ({
        id: m.id,
        userId: m.userId,
        parentId: m.parentId,
        kind: m.kind,
        text: m.contentText,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
        files: m.attachments,
      }));
    };

    const out: WorkspaceExportDto = {
      format: 'backstages-export/1',
      exportedAt: new Date().toISOString(),
      scope,
      truncated: false,
      workspace: { id: ws.id, name: ws.name },
      members: members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        displayName: m.user.displayName,
        role: m.role,
        isBot: m.user.isBot,
        deactivated: !!m.deactivatedAt,
      })),
      channels: [],
      conversations: [],
    };
    for (const c of channels) {
      out.channels.push({
        id: c.id,
        name: c.name,
        isPrivate: c.isPrivate,
        isArchived: c.isArchived,
        createdAt: c.createdAt.toISOString(),
        messages: await loadMessages({ channelId: c.id }),
      });
    }
    for (const c of conversations) {
      out.conversations.push({
        id: c.id,
        isGroup: c.isGroup,
        title: c.title,
        memberIds: c.members.map((m) => m.userId),
        messages: await loadMessages({ conversationId: c.id }),
      });
    }
    out.truncated = truncated;

    this.audit.record(workspaceId, userId, 'workspace.export', {
      targetType: 'workspace',
      targetId: workspaceId,
      meta: { scope, messages: EXPORT_MAX_MESSAGES - remaining, truncated },
    });
    return out;
  }
}
