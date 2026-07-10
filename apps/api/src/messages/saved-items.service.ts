import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { messageInclude, toMessageDto } from './message-serializer';
import { toUserDto } from '../auth/auth.service';

/** Pins (per channel/DM, visible to all members) and saved items (private). */
@Injectable()
export class SavedItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  private async requireMessageAccess(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (message.channelId) await this.policy.requireChannelMember(userId, message.channelId);
    else if (message.conversationId)
      await this.policy.requireConversationMember(userId, message.conversationId);
    return message;
  }

  // ---------- pins ----------

  async pin(userId: string, messageId: string) {
    await this.requireMessageAccess(userId, messageId);
    const existing = await this.prisma.pinnedMessage.findUnique({ where: { messageId } });
    if (existing) throw new BadRequestException('Message is already pinned');
    await this.prisma.pinnedMessage.create({ data: { messageId, pinnedById: userId } });
    return { ok: true };
  }

  async unpin(userId: string, messageId: string) {
    await this.requireMessageAccess(userId, messageId);
    await this.prisma.pinnedMessage.deleteMany({ where: { messageId } });
    return { ok: true };
  }

  async channelPins(userId: string, channelId: string) {
    await this.policy.requireChannelMember(userId, channelId);
    const pins = await this.prisma.pinnedMessage.findMany({
      where: { message: { channelId, deletedAt: null } },
      include: { message: { include: messageInclude }, pinnedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    return pins.map((p) => ({
      message: toMessageDto(p.message),
      pinnedBy: toUserDto(p.pinnedBy),
      pinnedAt: p.createdAt.toISOString(),
    }));
  }

  // ---------- saved items ----------

  async save(userId: string, messageId: string) {
    await this.requireMessageAccess(userId, messageId);
    await this.prisma.savedItem.upsert({
      where: { userId_messageId: { userId, messageId } },
      create: { userId, messageId },
      update: {},
    });
    return { ok: true };
  }

  async unsave(userId: string, messageId: string) {
    await this.prisma.savedItem.deleteMany({ where: { userId, messageId } });
    return { ok: true };
  }

  async listSaved(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const items = await this.prisma.savedItem.findMany({
      where: { userId, message: { workspaceId, deletedAt: null } },
      include: { message: { include: messageInclude } },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((i) => ({
      message: toMessageDto(i.message),
      savedAt: i.createdAt.toISOString(),
    }));
  }
}
