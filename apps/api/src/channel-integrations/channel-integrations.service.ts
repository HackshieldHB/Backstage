import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import type { CommandResultDto } from '@backstages/shared';
import type {
  ChannelEmailDto,
  CreateCustomCommandInput,
  CreateWebhookInput,
  CustomCommandDto,
  IncomingWebhookDto,
  InboundEmailInput,
  WebhookPayload,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { MessagesService, channelContainer } from '../messages/messages.service';
import { parseCommand, type CommandContext } from '../integrations/app-registry';

function textDoc(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })),
  };
}

function apiBase() {
  return process.env.PUBLIC_API_URL ?? 'http://localhost:3001';
}

// ---------- incoming webhooks ----------

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<IncomingWebhookDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const rows = await this.prisma.incomingWebhook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(this.toDto);
  }

  async create(
    userId: string,
    workspaceId: string,
    input: CreateWebhookInput,
  ): Promise<IncomingWebhookDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
    if (channel.workspaceId !== workspaceId) throw new ForbiddenException('Channel not in workspace');
    const row = await this.prisma.incomingWebhook.create({
      data: {
        workspaceId,
        channelId: input.channelId,
        name: input.name.trim(),
        token: randomBytes(24).toString('hex'),
        createdById: userId,
      },
    });
    return this.toDto(row);
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    const hook = await this.prisma.incomingWebhook.findUnique({ where: { id } });
    if (!hook) throw new NotFoundException('Webhook not found');
    await this.policy.requireWorkspaceMember(userId, hook.workspaceId, 'ADMIN');
    await this.prisma.incomingWebhook.delete({ where: { id } });
    return { ok: true };
  }

  /** Public: an external tool posts a message via its webhook token. */
  async ingest(token: string, payload: WebhookPayload): Promise<{ ok: boolean }> {
    const hook = await this.prisma.incomingWebhook.findUnique({ where: { token } });
    if (!hook || !hook.active) throw new NotFoundException('Unknown webhook');
    const text = (payload.username ? `**${payload.username}**\n` : '') + payload.text;
    await this.messages.send(hook.createdById, channelContainer(hook.channelId), {
      clientMsgId: randomUUID(),
      contentJson: textDoc(text),
      contentText: text,
      attachmentIds: [],
    });
    return { ok: true };
  }

  private toDto = (row: {
    id: string;
    channelId: string;
    name: string;
    token: string;
    active: boolean;
    createdAt: Date;
  }): IncomingWebhookDto => ({
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    url: `${apiBase()}/hooks/${row.token}`,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  });
}

// ---------- custom slash commands ----------

@Injectable()
export class CustomCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<CustomCommandDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.customCommand.findMany({
      where: { workspaceId },
      orderBy: { trigger: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      trigger: c.trigger,
      description: c.description,
      responseText: c.responseText,
    }));
  }

  async create(
    userId: string,
    workspaceId: string,
    input: CreateCustomCommandInput,
  ): Promise<CustomCommandDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const trigger = input.trigger.trim().toLowerCase().replace(/^\//, '');
    const row = await this.prisma.customCommand.create({
      data: {
        workspaceId,
        trigger,
        description: input.description,
        responseText: input.responseText,
        createdById: userId,
      },
    });
    return { id: row.id, trigger: row.trigger, description: row.description, responseText: row.responseText };
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    const cmd = await this.prisma.customCommand.findUnique({ where: { id } });
    if (!cmd) throw new NotFoundException('Command not found');
    await this.policy.requireWorkspaceMember(userId, cmd.workspaceId, 'ADMIN');
    await this.prisma.customCommand.delete({ where: { id } });
    return { ok: true };
  }

  /** For the command catalogue (help/autocomplete). */
  async catalogue(workspaceId: string): Promise<CustomCommandDto[]> {
    const rows = await this.prisma.customCommand.findMany({ where: { workspaceId } });
    return rows.map((c) => ({
      id: c.id,
      trigger: c.trigger,
      description: c.description,
      responseText: c.responseText,
    }));
  }

  /**
   * Try to run a workspace custom command. Posts its canned response to the
   * channel and returns a result; returns null when the text isn't one of ours
   * so the caller can fall back to the built-in registry.
   */
  async tryRun(ctx: CommandContext, text: string): Promise<CommandResultDto | null> {
    const parsed = parseCommand(text);
    if (!parsed || !ctx.channelId) return null;
    const cmd = await this.prisma.customCommand.findUnique({
      where: { workspaceId_trigger: { workspaceId: ctx.workspaceId, trigger: parsed.name } },
    });
    if (!cmd) return null;
    await this.messages.send(ctx.userId, channelContainer(ctx.channelId), {
      clientMsgId: randomUUID(),
      contentJson: textDoc(cmd.responseText),
      contentText: cmd.responseText,
      attachmentIds: [],
    });
    return { handled: true };
  }
}

// ---------- email-to-channel ----------

@Injectable()
export class ChannelEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
  ) {}

  private address(token: string): string {
    const domain = process.env.INBOUND_EMAIL_DOMAIN ?? 'inbound.localhost';
    return `${token}@${domain}`;
  }

  /** Get (creating on first request) the channel's inbound email address. */
  async ensure(userId: string, channelId: string): Promise<ChannelEmailDto> {
    const { channel } = await this.policy.requireChannelMember(userId, channelId);
    const existing = await this.prisma.channelEmail.findUnique({ where: { channelId } });
    if (existing) return { channelId, address: this.address(existing.token) };
    const row = await this.prisma.channelEmail.create({
      data: { channelId, workspaceId: channel.workspaceId, token: randomBytes(12).toString('hex') },
    });
    return { channelId, address: this.address(row.token) };
  }

  /** Public: a mail provider forwards an inbound email to post it. */
  async ingest(token: string, input: InboundEmailInput): Promise<{ ok: boolean }> {
    const rec = await this.prisma.channelEmail.findUnique({ where: { token } });
    if (!rec) throw new NotFoundException('Unknown address');
    const from = input.from ? `**${input.from}**` : '**Email**';
    const subject = input.subject ? `✉️ ${input.subject}` : '✉️ (no subject)';
    const text = `${from}\n${subject}\n\n${input.text ?? ''}`.trim();
    const owner = await this.prisma.channelMember.findFirst({ where: { channelId: rec.channelId } });
    if (!owner) throw new NotFoundException('Channel has no members');
    await this.messages.send(owner.userId, channelContainer(rec.channelId), {
      clientMsgId: randomUUID(),
      contentJson: textDoc(text),
      contentText: text,
      attachmentIds: [],
    });
    return { ok: true };
  }
}
