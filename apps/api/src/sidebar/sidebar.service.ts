import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_CHANNEL_BOOKMARKS,
  MAX_SIDEBAR_SECTIONS,
  type ChannelBookmarkDto,
  type CreateChannelBookmarkInput,
  type SidebarSectionDto,
  type UpdateSidebarSectionInput,
} from '@backstages/shared';
import type { SidebarSection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

/**
 * Personal sidebar sections and shared channel bookmarks.
 * Sections belong to one user in one workspace; a channel/DM is placed in a
 * section on the caller's *own* membership row, so nobody else's sidebar
 * changes. Bookmarks are visible to channel members; their creator or a channel
 * admin can remove them.
 */
@Injectable()
export class SidebarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  // ---------- sections ----------

  async listSections(userId: string, workspaceId: string): Promise<SidebarSectionDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.sidebarSection.findMany({
      where: { userId, workspaceId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toSectionDto);
  }

  async createSection(userId: string, workspaceId: string, name: string): Promise<SidebarSectionDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const count = await this.prisma.sidebarSection.count({ where: { userId, workspaceId } });
    if (count >= MAX_SIDEBAR_SECTIONS) {
      throw new BadRequestException(`You can have at most ${MAX_SIDEBAR_SECTIONS} sections`);
    }
    const row = await this.prisma.sidebarSection.create({
      data: { userId, workspaceId, name, position: count },
    });
    return toSectionDto(row);
  }

  async updateSection(
    userId: string,
    id: string,
    input: UpdateSidebarSectionInput,
  ): Promise<SidebarSectionDto> {
    await this.ownSection(userId, id);
    const row = await this.prisma.sidebarSection.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });
    return toSectionDto(row);
  }

  /** Deleting a section returns its channels/DMs to the default lists. */
  async deleteSection(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.ownSection(userId, id);
    await this.prisma.sidebarSection.delete({ where: { id } });
    return { ok: true };
  }

  async setChannelSection(userId: string, channelId: string, sectionId: string | null) {
    const { channel, channelMember } = await this.policy.requireChannelMember(userId, channelId);
    if (sectionId) await this.ownSection(userId, sectionId, channel.workspaceId);
    await this.prisma.channelMember.update({ where: { id: channelMember.id }, data: { sectionId } });
    return { channelId, sectionId };
  }

  async setConversationSection(userId: string, conversationId: string, sectionId: string | null) {
    const { conversation } = await this.policy.requireConversationMember(userId, conversationId);
    if (sectionId) await this.ownSection(userId, sectionId, conversation.workspaceId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { sectionId },
    });
    return { conversationId, sectionId };
  }

  /** The section must be the caller's (and in `workspaceId` when given) — else 404. */
  private async ownSection(userId: string, id: string, workspaceId?: string): Promise<SidebarSection> {
    const s = await this.prisma.sidebarSection.findUnique({ where: { id } });
    if (!s || s.userId !== userId || (workspaceId && s.workspaceId !== workspaceId)) {
      throw new NotFoundException('Section not found');
    }
    return s;
  }

  // ---------- bookmarks ----------

  async listBookmarks(userId: string, channelId: string): Promise<ChannelBookmarkDto[]> {
    await this.policy.requireChannelMember(userId, channelId);
    const rows = await this.prisma.channelBookmark.findMany({
      where: { channelId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { createdBy: { select: { id: true, displayName: true } } },
    });
    return rows.map(toBookmarkDto);
  }

  async addBookmark(
    userId: string,
    channelId: string,
    input: CreateChannelBookmarkInput,
  ): Promise<ChannelBookmarkDto> {
    const { workspaceMember } = await this.policy.requireChannelMember(userId, channelId);
    if (workspaceMember.role === 'GUEST') throw new ForbiddenException('Guests cannot add bookmarks');
    const count = await this.prisma.channelBookmark.count({ where: { channelId } });
    if (count >= MAX_CHANNEL_BOOKMARKS) {
      throw new BadRequestException(`A channel can have at most ${MAX_CHANNEL_BOOKMARKS} bookmarks`);
    }
    const row = await this.prisma.channelBookmark.create({
      data: { channelId, title: input.title, url: input.url, createdById: userId, position: count },
      include: { createdBy: { select: { id: true, displayName: true } } },
    });
    return toBookmarkDto(row);
  }

  async removeBookmark(userId: string, id: string): Promise<{ ok: boolean }> {
    const b = await this.prisma.channelBookmark.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Bookmark not found');
    await this.policy.requireChannelMember(userId, b.channelId);
    if (b.createdById !== userId) {
      // Others' bookmarks: channel admins only.
      await this.policy.requireChannelAdmin(userId, b.channelId);
    }
    await this.prisma.channelBookmark.delete({ where: { id } });
    return { ok: true };
  }
}

function toSectionDto(s: SidebarSection): SidebarSectionDto {
  return { id: s.id, name: s.name, position: s.position };
}

function toBookmarkDto(b: {
  id: string;
  channelId: string;
  title: string;
  url: string;
  createdAt: Date;
  createdBy: { id: string; displayName: string };
}): ChannelBookmarkDto {
  return {
    id: b.id,
    channelId: b.channelId,
    title: b.title,
    url: b.url,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
  };
}
