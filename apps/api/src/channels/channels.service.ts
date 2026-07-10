import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddChannelMemberInput, CreateChannelInput, UpdateChannelInput } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { toUserDto } from '../auth/auth.service';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async create(userId: string, workspaceId: string, input: CreateChannelInput) {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (member.role === 'GUEST') throw new ForbiddenException('Guests cannot create channels');

    const existing = await this.prisma.channel.findUnique({
      where: { workspaceId_name: { workspaceId, name: input.name } },
    });
    if (existing) throw new ConflictException('A channel with this name already exists');

    return this.prisma.channel.create({
      data: {
        workspaceId,
        name: input.name,
        topic: input.topic,
        description: input.description,
        isPrivate: input.isPrivate,
        createdById: userId,
        members: { create: [{ userId }] },
      },
    });
  }

  /** Channels the caller belongs to (sidebar). */
  async listMine(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const memberships = await this.prisma.channelMember.findMany({
      where: { userId, channel: { workspaceId } },
      include: { channel: true },
      orderBy: { channel: { name: 'asc' } },
    });
    return memberships
      .filter((m) => !m.channel.isArchived)
      .map((m) => ({ ...m.channel, isMember: true, notificationPref: m.notificationPref }));
  }

  /** Channel browser: public channels + own private ones. Guests see only their own. */
  async browse(userId: string, workspaceId: string) {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    const where =
      member.role === 'GUEST'
        ? { workspaceId, members: { some: { userId } } }
        : { workspaceId, OR: [{ isPrivate: false }, { members: { some: { userId } } }] };
    const channels = await this.prisma.channel.findMany({
      where,
      include: {
        _count: { select: { members: true } },
        members: { where: { userId }, select: { id: true } },
      },
      orderBy: { name: 'asc' },
    });
    return channels.map((c) => ({
      id: c.id,
      workspaceId: c.workspaceId,
      name: c.name,
      topic: c.topic,
      description: c.description,
      isPrivate: c.isPrivate,
      isArchived: c.isArchived,
      isDefault: c.isDefault,
      memberCount: c._count.members,
      isMember: c.members.length > 0,
    }));
  }

  async get(userId: string, channelId: string) {
    const { channel, channelMember } = await this.policy.requireChannelMember(userId, channelId);
    return { ...channel, notificationPref: channelMember.notificationPref };
  }

  async update(userId: string, channelId: string, input: UpdateChannelInput) {
    const { channel } = await this.policy.requireChannelMember(userId, channelId);
    if (input.name && channel.isDefault) {
      throw new ForbiddenException('The default channel cannot be renamed');
    }
    if (input.name && input.name !== channel.name) {
      const dup = await this.prisma.channel.findUnique({
        where: { workspaceId_name: { workspaceId: channel.workspaceId, name: input.name } },
      });
      if (dup) throw new ConflictException('A channel with this name already exists');
    }
    return this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
  }

  async archive(userId: string, channelId: string) {
    const { channel } = await this.policy.requireChannelAdmin(userId, channelId);
    if (channel.isDefault) throw new ForbiddenException('The default channel cannot be archived');
    return this.prisma.channel.update({ where: { id: channelId }, data: { isArchived: true } });
  }

  async unarchive(userId: string, channelId: string) {
    await this.policy.requireChannelAdmin(userId, channelId);
    return this.prisma.channel.update({ where: { id: channelId }, data: { isArchived: false } });
  }

  async delete(userId: string, channelId: string) {
    const { channel } = await this.policy.requireChannelAdmin(userId, channelId);
    if (channel.isDefault) throw new ForbiddenException('The default channel cannot be deleted');
    await this.prisma.channel.delete({ where: { id: channelId } });
    return { ok: true };
  }

  async join(userId: string, channelId: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    const member = await this.policy.requireWorkspaceMember(userId, channel.workspaceId);
    // Private channels are invitation-only; guests never self-join.
    if (channel.isPrivate || member.role === 'GUEST') throw new NotFoundException('Channel not found');
    if (channel.isArchived) throw new BadRequestException('Channel is archived');

    const existing = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (existing) return existing;
    return this.prisma.channelMember.create({ data: { channelId, userId } });
  }

  async leave(userId: string, channelId: string) {
    const { channel, channelMember } = await this.policy.requireChannelMember(userId, channelId);
    if (channel.isDefault) throw new ForbiddenException('You cannot leave the default channel');
    await this.prisma.channelMember.delete({ where: { id: channelMember.id } });
    return { ok: true };
  }

  async addMember(actorId: string, channelId: string, input: AddChannelMemberInput) {
    const { channel } = await this.policy.requireChannelMember(actorId, channelId);
    // The target must already belong to the channel's workspace.
    const targetMember = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: channel.workspaceId, userId: input.userId } },
    });
    if (!targetMember || targetMember.deactivatedAt) {
      throw new BadRequestException('User is not a member of this workspace');
    }
    const existing = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: input.userId } },
    });
    if (existing) return existing;
    return this.prisma.channelMember.create({ data: { channelId, userId: input.userId } });
  }

  async removeMember(actorId: string, channelId: string, targetUserId: string) {
    if (actorId === targetUserId) return this.leave(actorId, channelId);
    const { channel } = await this.policy.requireChannelAdmin(actorId, channelId);
    if (channel.isDefault) throw new ForbiddenException('Members cannot be removed from the default channel');
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Member not found');
    await this.prisma.channelMember.delete({ where: { id: membership.id } });
    return { ok: true };
  }

  async setNotificationPref(userId: string, channelId: string, pref: 'ALL' | 'MENTIONS' | 'MUTED') {
    const { channelMember } = await this.policy.requireChannelMember(userId, channelId);
    const updated = await this.prisma.channelMember.update({
      where: { id: channelMember.id },
      data: { notificationPref: pref },
    });
    return { channelId, notificationPref: updated.notificationPref };
  }

  async listMembers(userId: string, channelId: string) {
    await this.policy.requireChannelMember(userId, channelId);
    const members = await this.prisma.channelMember.findMany({
      where: { channelId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({ ...toUserDto(m.user), joinedAt: m.joinedAt }));
  }
}
