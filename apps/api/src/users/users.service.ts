import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  MarkNotificationsReadInput,
  UpdateProfileInput,
  UpdateStatusInput,
} from '@backstages/shared';
import { SOCKET_EVENTS } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PresenceService } from '../presence/presence.service';
import { StorageService } from '../storage/storage.service';
import { signAvatarUrl } from '../attachments/attachment-url';
import { toUserDto } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly storage: StorageService,
  ) {}

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: input.displayName },
    });
    await this.broadcastProfile(user.id);
    return toUserDto(user);
  }

  async setAvatar(
    userId: string,
    file: { originalname?: string; mimetype?: string; buffer: Buffer; size: number } | undefined,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Avatar must be an image');
    }
    const storageKey = randomUUID();
    await this.storage.save(storageKey, file.buffer);
    const attachment = await this.prisma.attachment.create({
      data: {
        uploaderId: userId,
        filename: file.originalname ?? 'avatar',
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
      },
    });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: signAvatarUrl(attachment.id) },
    });
    await this.broadcastProfile(user.id);
    return toUserDto(user);
  }

  /** Nudge every workspace the user is in so peers refetch the roster (name/photo). */
  private async broadcastProfile(userId: string) {
    const state = await this.presence.effectiveState(userId);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    for (const m of memberships) {
      this.realtime.emitToWorkspace(m.workspaceId, SOCKET_EVENTS.PRESENCE_CHANGED, {
        userId,
        state,
      });
    }
  }

  async updateStatus(userId: string, input: UpdateStatusInput) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        statusEmoji: input.statusEmoji,
        statusText: input.statusText,
        statusExpiresAt: input.statusExpiresAt ? new Date(input.statusExpiresAt) : null,
      },
    });

    const state = await this.presence.effectiveState(userId);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    for (const m of memberships) {
      this.realtime.emitToWorkspace(m.workspaceId, SOCKET_EVENTS.PRESENCE_CHANGED, {
        userId,
        state,
        statusEmoji: user.statusEmoji,
        statusText: user.statusText,
      });
    }
    return toUserDto(user);
  }

  /** Snooze desktop notifications until a timestamp (null clears). */
  async setDnd(userId: string, until: string | null) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { dndUntil: until ? new Date(until) : null },
    });
    return { dndUntil: user.dndUntil?.toISOString() ?? null };
  }

  /** Start a focus block: snooze notifications and set a self-clearing focus status. */
  async startFocus(userId: string, minutes: number) {
    const until = new Date(Date.now() + minutes * 60_000);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        dndUntil: until,
        statusEmoji: '🎯',
        statusText: 'Focusing',
        statusExpiresAt: until,
      },
    });
    await this.broadcastStatus(userId, user);
    return { active: true, until: until.toISOString() };
  }

  /**
   * End a focus block early: always lift the snooze, but only clear the status if
   * it is still the focus status — so a custom status set before/during focus survives.
   */
  async endFocus(userId: string) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { statusText: true },
    });
    const clearStatus = current?.statusText === 'Focusing';
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        dndUntil: null,
        ...(clearStatus ? { statusEmoji: null, statusText: null, statusExpiresAt: null } : {}),
      },
    });
    await this.broadcastStatus(userId, user);
    return { active: false, until: null };
  }

  private async broadcastStatus(
    userId: string,
    user: { statusEmoji: string | null; statusText: string | null },
  ) {
    const state = await this.presence.effectiveState(userId);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    for (const m of memberships) {
      this.realtime.emitToWorkspace(m.workspaceId, SOCKET_EVENTS.PRESENCE_CHANGED, {
        userId,
        state,
        statusEmoji: user.statusEmoji,
        statusText: user.statusText,
      });
    }
  }

  /** Activity feed: mentions, thread replies, reactions, DMs — newest first. */
  async listNotifications(userId: string, cursor?: string, limit = 30) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      include: {
        actor: true,
        message: { select: { contentText: true, deletedAt: true, parentId: true } },
        channel: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const unreadCount = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return {
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        actor: n.actor ? toUserDto(n.actor) : null,
        messageId: n.messageId,
        channelId: n.channelId,
        channelName: n.channel?.name ?? null,
        conversationId: n.conversationId,
        preview: n.message && !n.message.deletedAt ? n.message.contentText.slice(0, 140) : null,
        payload: n.payload,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
      unreadCount,
    };
  }

  async markNotificationsRead(userId: string, input: MarkNotificationsReadInput) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(input.ids ? { id: { in: input.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
