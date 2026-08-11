import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SOCKET_EVENTS, type MessageDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { RealtimeService } from '../realtime/realtime.service';
import { messageInclude, toMessageDto } from '../messages/message-serializer';

interface CreatePollInput {
  question: string;
  options: string[];
  allowMultiple?: boolean;
}

@Injectable()
export class PollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(userId: string, channelId: string, input: CreatePollInput): Promise<MessageDto> {
    const { channel } = await this.policy.requireChannelMember(userId, channelId);
    const question = input.question?.trim();
    const options = (input.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (!question) throw new BadRequestException('Poll question is required');
    if (options.length < 2) throw new BadRequestException('A poll needs at least two options');
    if (options.length > 10) throw new BadRequestException('At most 10 options');

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          workspaceId: channel.workspaceId,
          channelId,
          userId,
          contentText: question,
          contentJson: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: question }] }],
          } as Prisma.InputJsonValue,
        },
      });
      await tx.poll.create({
        data: {
          messageId: created.id,
          question,
          options: options as Prisma.InputJsonValue,
          allowMultiple: input.allowMultiple ?? false,
          createdById: userId,
        },
      });
      return created;
    });

    const full = await this.prisma.message.findUniqueOrThrow({
      where: { id: message.id },
      include: messageInclude,
    });
    const dto = toMessageDto(full);
    this.realtime.emitToContainer({ channelId, conversationId: null }, SOCKET_EVENTS.MESSAGE_NEW, {
      message: dto,
    });
    return dto;
  }

  async vote(userId: string, pollId: string, optionIndex: number): Promise<MessageDto> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      include: { message: { select: { channelId: true } } },
    });
    if (!poll || !poll.message.channelId) throw new NotFoundException('Poll not found');
    await this.policy.requireChannelMember(userId, poll.message.channelId);
    const options = poll.options as string[];
    if (optionIndex < 0 || optionIndex >= options.length) {
      throw new BadRequestException('Invalid option');
    }

    const existing = await this.prisma.pollVote.findMany({ where: { pollId, userId } });
    const already = existing.find((v) => v.optionIndex === optionIndex);
    if (already) {
      // Toggle off.
      await this.prisma.pollVote.delete({ where: { id: already.id } });
    } else {
      if (!poll.allowMultiple && existing.length > 0) {
        await this.prisma.pollVote.deleteMany({ where: { pollId, userId } });
      }
      await this.prisma.pollVote.create({ data: { pollId, userId, optionIndex } });
    }

    const full = await this.prisma.message.findUniqueOrThrow({
      where: { id: poll.messageId },
      include: messageInclude,
    });
    const dto = toMessageDto(full);
    this.realtime.emitToContainer(
      { channelId: poll.message.channelId, conversationId: null },
      SOCKET_EVENTS.MESSAGE_UPDATED,
      { message: dto },
    );
    return dto;
  }
}
