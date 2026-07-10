import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { imageSize } from 'image-size';
import { randomUUID } from 'crypto';
import type { Attachment } from '@prisma/client';
import type { AttachmentDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { StorageService } from '../storage/storage.service';
import { signAttachmentUrl } from './attachment-url';

export function toAttachmentDto(a: Attachment): AttachmentDto {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    url: signAttachmentUrl(a.id),
    width: a.width,
    height: a.height,
  };
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    userId: string,
    workspaceId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ): Promise<AttachmentDto> {
    // Uploads are workspace-scoped; membership is the gate.
    await this.policy.requireWorkspaceMember(userId, workspaceId);

    let width: number | null = null;
    let height: number | null = null;
    if (file.mimetype.startsWith('image/')) {
      try {
        const dims = imageSize(file.buffer);
        width = dims.width ?? null;
        height = dims.height ?? null;
      } catch {
        // Not a parseable image — store it as a generic file.
      }
    }

    const storageKey = randomUUID();
    await this.storage.save(storageKey, file.buffer);

    const attachment = await this.prisma.attachment.create({
      data: {
        uploaderId: userId,
        filename: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        storageKey,
        width,
        height,
      },
    });
    return toAttachmentDto(attachment);
  }

  /**
   * Access: linked attachments require membership of the message's container;
   * unlinked (pending) attachments are visible to their uploader only.
   */
  async authorize(userId: string, attachmentId: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { channelId: true, conversationId: true, deletedAt: true } } },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    if (!attachment.message) {
      if (attachment.uploaderId !== userId) throw new NotFoundException('Attachment not found');
      return attachment;
    }
    if (attachment.message.deletedAt) throw new NotFoundException('Attachment not found');
    if (attachment.message.channelId) {
      await this.policy.requireChannelMember(userId, attachment.message.channelId);
    } else if (attachment.message.conversationId) {
      await this.policy.requireConversationMember(userId, attachment.message.conversationId);
    } else {
      throw new ForbiddenException();
    }
    return attachment;
  }

  async getForSignedDownload(attachmentId: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { deletedAt: true } } },
    });
    if (!attachment || attachment.message?.deletedAt) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  stream(attachment: Attachment) {
    return this.storage.createReadStream(attachment.storageKey);
  }
}
