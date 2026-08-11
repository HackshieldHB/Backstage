import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { StorageService } from '../storage/storage.service';

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const MAX_EMOJI_BYTES = 256 * 1024; // 256 KB — emoji are small
const MAX_PER_WORKSPACE = 500;

export interface CustomEmojiView {
  id: string;
  name: string;
  url: string;
}

@Injectable()
export class EmojiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly storage: StorageService,
  ) {}

  private view(e: { id: string; name: string }): CustomEmojiView {
    return { id: e.id, name: e.name, url: `/emoji/${e.id}` };
  }

  async list(userId: string, workspaceId: string): Promise<CustomEmojiView[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.customEmoji.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return rows.map((r) => this.view(r));
  }

  async create(
    userId: string,
    workspaceId: string,
    name: string,
    file: Express.Multer.File,
  ): Promise<CustomEmojiView> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const clean = name.trim().toLowerCase().replace(/:/g, '');
    if (!NAME_RE.test(clean)) {
      throw new BadRequestException(
        'Name must be 2–32 chars: lowercase letters, numbers, hyphen or underscore.',
      );
    }
    if (!file) throw new BadRequestException('No image provided');
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('Emoji must be an image');
    if (file.size > MAX_EMOJI_BYTES) throw new BadRequestException('Image must be under 256 KB');

    const existing = await this.prisma.customEmoji.findUnique({
      where: { workspaceId_name: { workspaceId, name: clean } },
    });
    if (existing) throw new ConflictException(`:${clean}: already exists`);

    const count = await this.prisma.customEmoji.count({ where: { workspaceId } });
    if (count >= MAX_PER_WORKSPACE) {
      throw new BadRequestException('This workspace has reached its custom-emoji limit');
    }

    const storageKey = `emoji/${randomUUID()}`;
    await this.storage.save(storageKey, file.buffer);
    const created = await this.prisma.customEmoji.create({
      data: { workspaceId, name: clean, storageKey, mimeType: file.mimetype, createdById: userId },
      select: { id: true, name: true },
    });
    return this.view(created);
  }

  async remove(userId: string, workspaceId: string, name: string): Promise<void> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    const emoji = await this.prisma.customEmoji.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
    if (!emoji) throw new NotFoundException('Emoji not found');
    // Only the creator or a workspace admin/owner may delete.
    if (emoji.createdById !== userId && !this.policy.roleAtLeast(member.role, 'ADMIN')) {
      throw new BadRequestException('Only the creator or an admin can remove this emoji');
    }
    await this.storage.delete(emoji.storageKey);
    await this.prisma.customEmoji.delete({ where: { id: emoji.id } });
  }

  /** For the public image route — no auth (emoji are low-sensitivity, shown in <img>). */
  async getForServe(id: string) {
    const emoji = await this.prisma.customEmoji.findUnique({ where: { id } });
    if (!emoji) throw new NotFoundException('Emoji not found');
    return emoji;
  }

  stream(storageKey: string) {
    return this.storage.createReadStream(storageKey);
  }
}
