import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, ChannelMember, Conversation, WorkspaceMember, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ROLE_ORDER: Record<WorkspaceRole, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, GUEST: 1 };

/**
 * The single authorization layer. Every message, channel, conversation, file and
 * search operation resolves access through these checks. All methods fail closed:
 * missing rows throw (404 for containers the caller may not even know exist).
 *
 * Multi-tenancy rule: workspace scope is always derived from the resource row +
 * verified membership — never trusted from client input.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
    return ROLE_ORDER[role] >= ROLE_ORDER[min];
  }

  /** The caller must be an active member of the workspace (optionally at least `minRole`). */
  async requireWorkspaceMember(
    userId: string,
    workspaceId: string,
    minRole?: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member || member.deactivatedAt) {
      // 404, not 403: don't confirm the workspace exists to outsiders.
      throw new NotFoundException('Workspace not found');
    }
    if (minRole && !this.roleAtLeast(member.role, minRole)) {
      throw new ForbiddenException('Insufficient role');
    }
    return member;
  }

  /**
   * The caller must be a member of the channel (which implies workspace membership
   * is re-verified against the channel's actual workspace). Read and post access.
   */
  async requireChannelMember(
    userId: string,
    channelId: string,
  ): Promise<{ channel: Channel; channelMember: ChannelMember; workspaceMember: WorkspaceMember }> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    const workspaceMember = await this.requireWorkspaceMember(userId, channel.workspaceId);
    const channelMember = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!channelMember) throw new NotFoundException('Channel not found');
    return { channel, channelMember, workspaceMember };
  }

  /**
   * Admin-level access to a channel: role is verified against the channel's OWN
   * workspace (an admin of another workspace has no power here).
   */
  async requireChannelAdmin(
    userId: string,
    channelId: string,
  ): Promise<{ channel: Channel; workspaceMember: WorkspaceMember }> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    const workspaceMember = await this.requireWorkspaceMember(userId, channel.workspaceId, 'ADMIN');
    if (channel.isPrivate) {
      // Even admins must be members to act on a private channel's contents.
      const channelMember = await this.prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId } },
      });
      if (!channelMember) throw new NotFoundException('Channel not found');
    }
    return { channel, workspaceMember };
  }

  /** The caller must be a participant of the conversation. */
  async requireConversationMember(
    userId: string,
    conversationId: string,
  ): Promise<{ conversation: Conversation }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    await this.requireWorkspaceMember(userId, conversation.workspaceId);
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) throw new NotFoundException('Conversation not found');
    return { conversation };
  }

  /**
   * Ids of every channel/conversation the user may read in a workspace — the only
   * allowed scope for search and cross-container listings.
   */
  async accessibleContainers(
    userId: string,
    workspaceId: string,
  ): Promise<{ channelIds: string[]; conversationIds: string[] }> {
    await this.requireWorkspaceMember(userId, workspaceId);
    const [channels, conversations] = await Promise.all([
      this.prisma.channelMember.findMany({
        where: { userId, channel: { workspaceId } },
        select: { channelId: true },
      }),
      this.prisma.conversationMember.findMany({
        where: { userId, conversation: { workspaceId } },
        select: { conversationId: true },
      }),
    ]);
    return {
      channelIds: channels.map((c) => c.channelId),
      conversationIds: conversations.map((c) => c.conversationId),
    };
  }
}
