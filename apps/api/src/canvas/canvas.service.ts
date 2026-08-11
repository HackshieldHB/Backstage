import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

@Injectable()
export class CanvasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async get(userId: string, channelId: string) {
    await this.policy.requireChannelMember(userId, channelId);
    const canvas = await this.prisma.canvas.findUnique({
      where: { channelId },
      include: { updatedBy: { select: { displayName: true } } },
    });
    if (!canvas) return { contentJson: null, contentText: '', updatedBy: null, updatedAt: null };
    return {
      contentJson: canvas.contentJson,
      contentText: canvas.contentText,
      updatedBy: canvas.updatedBy.displayName,
      updatedAt: canvas.updatedAt.toISOString(),
    };
  }

  async update(
    userId: string,
    channelId: string,
    input: { contentJson: unknown; contentText: string },
  ) {
    await this.policy.requireChannelMember(userId, channelId);
    const data = {
      contentJson: (input.contentJson ?? {}) as Prisma.InputJsonValue,
      contentText: input.contentText ?? '',
      updatedById: userId,
    };
    const canvas = await this.prisma.canvas.upsert({
      where: { channelId },
      create: { channelId, ...data },
      update: data,
    });
    return { updatedAt: canvas.updatedAt.toISOString() };
  }
}
