import { BadRequestException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { ScheduledMessage } from '@prisma/client';
import type { CommandResultDto, ScheduleMessageInput, ScheduledMessageDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppRegistry, type IntegrationApp, type SlashCommand } from '../integrations/app-registry';
import { MessagesService, channelContainer, conversationContainer } from './messages.service';

/** Wraps reminder text in a minimal TipTap doc so it renders like any message. */
function textDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/**
 * Parses the time expression at the start of a /remind argument.
 * Supports "in <n><unit>", "at HH:MM" (today or tomorrow), and "tomorrow
 * [at HH:MM]". Returns the fire time and the remaining reminder text.
 */
export function parseRemind(raw: string, now = new Date()): { at: Date; text: string } | null {
  let s = raw.trim().replace(/^me\s+/i, '');

  const rel = /^in\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b\s*/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit.startsWith('d') ? 86400000 : unit.startsWith('h') ? 3600000 : 60000;
    const text = s.slice(rel[0].length).replace(/^to\s+/i, '').trim();
    if (!text) return null;
    return { at: new Date(now.getTime() + n * ms), text };
  }

  const tomorrow = /^tomorrow\b\s*/i.exec(s);
  if (tomorrow) s = s.slice(tomorrow[0].length);

  const at = /^at\s+(\d{1,2}):(\d{2})\s*/i.exec(s);
  if (at || tomorrow) {
    const target = new Date(now);
    if (tomorrow) target.setDate(target.getDate() + 1);
    if (at) {
      const h = Number(at[1]);
      const m = Number(at[2]);
      if (h > 23 || m > 59) return null;
      target.setHours(h, m, 0, 0);
      s = s.slice(at[0].length);
    } else {
      target.setHours(9, 0, 0, 0); // "tomorrow" with no time → 9am
    }
    // A bare "at HH:MM" already past today rolls to tomorrow.
    if (!tomorrow && target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    const text = s.replace(/^to\s+/i, '').trim();
    if (!text) return null;
    return { at: target, text };
  }

  return null;
}

@Injectable()
export class ScheduledMessagesService implements IntegrationApp, OnModuleInit {
  readonly id = 'remind';
  private readonly logger = new Logger(ScheduledMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly registry: AppRegistry,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  // ---------- /remind command (IntegrationApp) ----------

  commands(): SlashCommand[] {
    return [
      {
        name: 'remind',
        usage: '/remind [me] in 30m <text>',
        description: 'Remind yourself later (e.g. "in 2h", "at 15:00", "tomorrow")',
        run: async (ctx, args) => {
          const parsed = parseRemind(args);
          if (!parsed) {
            throw new BadRequestException(
              'Try "/remind me in 30m <text>", "/remind at 15:00 <text>" or "/remind tomorrow <text>".',
            );
          }
          await this.scheduleReminder(ctx.userId, ctx.workspaceId, parsed.text, parsed.at);
          return { handled: true, message: `Reminder set for ${parsed.at.toLocaleString()}` } as CommandResultDto;
        },
      },
    ];
  }

  // ---------- scheduling ----------

  async scheduleForChannel(
    userId: string,
    channelId: string,
    input: ScheduleMessageInput,
  ): Promise<ScheduledMessageDto> {
    const { channel } = await this.policy.requireChannelMember(userId, channelId);
    return this.create(userId, channel.workspaceId, { channelId }, input);
  }

  async scheduleForConversation(
    userId: string,
    conversationId: string,
    input: ScheduleMessageInput,
  ): Promise<ScheduledMessageDto> {
    const { conversation } = await this.policy.requireConversationMember(userId, conversationId);
    return this.create(userId, conversation.workspaceId, { conversationId }, input);
  }

  async scheduleReminder(userId: string, workspaceId: string, text: string, at: Date) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    return this.create(
      userId,
      workspaceId,
      {},
      { contentText: text, contentJson: textDoc(text), scheduledFor: at.toISOString() },
    );
  }

  private async create(
    userId: string,
    workspaceId: string,
    target: { channelId?: string; conversationId?: string },
    input: ScheduleMessageInput,
  ): Promise<ScheduledMessageDto> {
    const when = new Date(input.scheduledFor);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Invalid scheduledFor');
    if (when.getTime() <= Date.now()) throw new BadRequestException('scheduledFor must be in the future');
    const row = await this.prisma.scheduledMessage.create({
      data: {
        workspaceId,
        userId,
        channelId: target.channelId ?? null,
        conversationId: target.conversationId ?? null,
        contentJson: (input.contentJson ?? {}) as object,
        contentText: input.contentText,
        scheduledFor: when,
      },
    });
    return this.toDto(row);
  }

  async listMine(userId: string, workspaceId: string): Promise<ScheduledMessageDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.scheduledMessage.findMany({
      where: { userId, workspaceId },
      orderBy: { scheduledFor: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async cancel(userId: string, id: string) {
    // deleteMany scoped to the owner: a non-owner or unknown id is a no-op, not an error leak.
    const { count } = await this.prisma.scheduledMessage.deleteMany({ where: { id, userId } });
    return { ok: count > 0 };
  }

  // ---------- delivery (called by the worker) ----------

  /** Delivers everything due at `now`, returning how many were delivered. */
  async deliverDue(now = new Date()): Promise<number> {
    const due = await this.prisma.scheduledMessage.findMany({
      where: { scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    });
    let delivered = 0;
    for (const s of due) {
      try {
        if (s.channelId || s.conversationId) {
          const container = s.channelId
            ? channelContainer(s.channelId)
            : conversationContainer(s.conversationId!);
          await this.messages.send(s.userId, container, {
            clientMsgId: randomUUID(),
            contentJson: s.contentJson,
            contentText: s.contentText,
            attachmentIds: [],
          });
        } else {
          // A reminder: private notification back to the person who set it.
          await this.notifications.notify({
            userId: s.userId,
            type: 'SYSTEM',
            payload: { source: 'reminder', text: s.contentText },
          });
        }
        delivered++;
      } catch (err) {
        // e.g. the target channel was archived/deleted since scheduling. Log and
        // drop it rather than retrying the same failure every minute.
        this.logger.warn(`Dropping scheduled message ${s.id}: ${String(err)}`);
      }
      await this.prisma.scheduledMessage.delete({ where: { id: s.id } }).catch(() => undefined);
    }
    return delivered;
  }

  private toDto(row: ScheduledMessage): ScheduledMessageDto {
    return {
      id: row.id,
      channelId: row.channelId,
      conversationId: row.conversationId,
      contentText: row.contentText,
      scheduledFor: row.scheduledFor.toISOString(),
      isReminder: !row.channelId && !row.conversationId,
    };
  }
}
