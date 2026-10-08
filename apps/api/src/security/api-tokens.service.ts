import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { ApiToken } from '@prisma/client';
import type {
  ApiTokenDto,
  ApiTokenScope,
  BotDto,
  CreateApiTokenInput,
  CreatedApiTokenDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';
import { API_TOKEN_PREFIX, hashToken } from './api-token-auth';

const MAX_TOKENS_PER_USER = 20;
const MAX_BOTS_PER_WORKSPACE = 25;

/**
 * Personal access tokens and bot accounts.
 *  - Tokens look like `bs_pat_<43 random chars>`; only a SHA-256 hash is stored
 *    and the full token is returned once.
 *  - A 'read' token may only make GET/HEAD requests; 'write' may do anything the
 *    user could — except human-only actions (token/2FA/password/bot management),
 *    which the guard refuses for any token.
 *  - Bots are users that exist in exactly one workspace, have no password, and
 *    authenticate only with their tokens. Only workspace admins manage them.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  // ---------- personal tokens ----------

  async listMine(userId: string): Promise<ApiTokenDto[]> {
    const rows = await this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async createMine(userId: string, input: CreateApiTokenInput): Promise<CreatedApiTokenDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isBot) throw new ForbiddenException('Bots cannot create tokens');
    return this.issue(userId, userId, input);
  }

  async revokeMine(userId: string, id: string): Promise<{ ok: boolean }> {
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Token not found');
    return { ok: true };
  }

  // ---------- bots ----------

  async listBots(userId: string, workspaceId: string): Promise<BotDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const bots = await this.prisma.user.findMany({
      where: { isBot: true, botWorkspaceId: workspaceId, ...activeIn(workspaceId) },
      include: { apiTokens: { where: { revokedAt: null }, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return bots.map((b) => ({
      id: b.id,
      displayName: b.displayName,
      createdAt: b.createdAt.toISOString(),
      tokens: b.apiTokens.map(toDto),
    }));
  }

  /** Create a bot member of the workspace, plus its first token (returned once). */
  async createBot(
    adminId: string,
    workspaceId: string,
    name: string,
    scope: ApiTokenScope,
  ): Promise<{ bot: BotDto; token: CreatedApiTokenDto }> {
    await this.policy.requireWorkspaceMember(adminId, workspaceId, 'ADMIN');
    const count = await this.prisma.user.count({
      where: { isBot: true, botWorkspaceId: workspaceId, ...activeIn(workspaceId) },
    });
    if (count >= MAX_BOTS_PER_WORKSPACE) {
      throw new BadRequestException(`A workspace can have at most ${MAX_BOTS_PER_WORKSPACE} bots`);
    }
    const bot = await this.prisma.user.create({
      data: {
        // Unroutable, unique address: bots never receive email or log in.
        email: `bot-${randomBytes(8).toString('hex')}@bots.backstages.invalid`,
        displayName: name,
        isBot: true,
        botWorkspaceId: workspaceId,
        workspaceMemberships: { create: { workspaceId, role: 'MEMBER' } },
      },
    });
    const token = await this.issue(bot.id, adminId, { name: `${name} token`, scope });
    this.audit.record(workspaceId, adminId, 'bot.create', { targetType: 'user', targetId: bot.id, meta: { name, scope } });
    return {
      bot: { id: bot.id, displayName: bot.displayName, createdAt: bot.createdAt.toISOString(), tokens: [token] },
      token,
    };
  }

  async createBotToken(
    adminId: string,
    botId: string,
    input: CreateApiTokenInput,
  ): Promise<CreatedApiTokenDto> {
    const bot = await this.requireBot(adminId, botId);
    return this.issue(bot.id, adminId, input);
  }

  async revokeBotToken(adminId: string, botId: string, tokenId: string): Promise<{ ok: boolean }> {
    await this.requireBot(adminId, botId);
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id: tokenId, userId: botId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Token not found');
    return { ok: true };
  }

  /** Remove a bot: its membership and tokens go; its past messages stay. */
  async deleteBot(adminId: string, botId: string): Promise<{ ok: boolean }> {
    const bot = await this.requireBot(adminId, botId);
    await this.prisma.$transaction([
      this.prisma.apiToken.updateMany({
        where: { userId: bot.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.workspaceMember.updateMany({
        where: { userId: bot.id, workspaceId: bot.botWorkspaceId! },
        data: { deactivatedAt: new Date() },
      }),
    ]);
    this.audit.record(bot.botWorkspaceId!, adminId, 'bot.delete', { targetType: 'user', targetId: bot.id });
    return { ok: true };
  }

  private async requireBot(adminId: string, botId: string) {
    const bot = await this.prisma.user.findUnique({ where: { id: botId } });
    if (!bot?.isBot || !bot.botWorkspaceId) throw new NotFoundException('Bot not found');
    const active = await this.prisma.workspaceMember.findFirst({
      where: { userId: bot.id, workspaceId: bot.botWorkspaceId, deactivatedAt: null },
    });
    if (!active) throw new NotFoundException('Bot not found');
    await this.policy.requireWorkspaceMember(adminId, bot.botWorkspaceId, 'ADMIN');
    return bot;
  }

  private async issue(
    userId: string,
    createdById: string,
    input: { name: string; scope: ApiTokenScope; expiresInDays?: number },
  ): Promise<CreatedApiTokenDto> {
    const active = await this.prisma.apiToken.count({ where: { userId, revokedAt: null } });
    if (active >= MAX_TOKENS_PER_USER) {
      throw new BadRequestException(`At most ${MAX_TOKENS_PER_USER} active tokens — revoke one first`);
    }
    const raw = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const row = await this.prisma.apiToken.create({
      data: {
        userId,
        createdById,
        name: input.name,
        scope: input.scope,
        tokenHash: hashToken(raw),
        prefix: raw.slice(0, API_TOKEN_PREFIX.length + 4),
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      },
    });
    return { ...toDto(row), token: raw };
  }
}

/** Bots whose membership is still active (a deleted bot is deactivated, not erased). */
const activeIn = (workspaceId: string) => ({
  workspaceMemberships: { some: { workspaceId, deactivatedAt: null } },
});

function toDto(t: ApiToken): ApiTokenDto {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scope: t.scope === 'write' ? 'write' : 'read',
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}
