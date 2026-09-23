import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MeetingRecord } from '@prisma/client';
import type {
  DecisionDto,
  MeetingRecordDto,
  MeetingRecordSummaryDto,
  MeetingTranscriptLine,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AiService } from '../ai/ai.service';
import { DecisionsService } from '../decisions/decisions.service';
import type { HuddleTranscriptLine } from '../realtime/huddle.service';

/**
 * Owns persisted meeting records: it stores the transcript captured by the huddle
 * gateway when a meeting ends, generates AI minutes on demand, and converts action
 * items into Decisions. Reads are gated by channel/DM membership.
 */
@Injectable()
export class MeetingMinutesService {
  private readonly logger = new Logger(MeetingMinutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly ai: AiService,
    private readonly decisions: DecisionsService,
  ) {}

  /** Persist a finished meeting's transcript. Best-effort — never throws upward. */
  async persistFromHuddle(roomKey: string, lines: HuddleTranscriptLine[], notes: string): Promise<void> {
    try {
      if (lines.length === 0 && !notes.trim()) return; // nothing worth keeping
      const [kind, id] = roomKey.split(':');
      if (!id) return;
      let workspaceId: string | null = null;
      let channelId: string | null = null;
      let conversationId: string | null = null;
      if (kind === 'channel') {
        const ch = await this.prisma.channel.findUnique({ where: { id }, select: { workspaceId: true } });
        workspaceId = ch?.workspaceId ?? null;
        channelId = id;
      } else if (kind === 'conversation') {
        const c = await this.prisma.conversation.findUnique({ where: { id }, select: { workspaceId: true } });
        workspaceId = c?.workspaceId ?? null;
        conversationId = id;
      }
      if (!workspaceId) return;

      const startedAt = lines.length ? new Date(Math.min(...lines.map((l) => l.at))) : new Date();
      const transcript: MeetingTranscriptLine[] = lines.map((l) => ({
        userId: l.userId,
        name: l.name,
        text: l.text,
        at: new Date(l.at).toISOString(),
        kind: l.kind,
      }));

      await this.prisma.meetingRecord.create({
        data: {
          workspaceId,
          channelId,
          conversationId,
          roomKey,
          startedAt,
          endedAt: new Date(),
          transcript: transcript as object,
          notes: notes.trim() || null,
        },
      });
    } catch (err) {
      this.logger.warn(`meeting record persist failed: ${(err as Error).message}`);
    }
  }

  // ---------- reads ----------

  async listForChannel(userId: string, channelId: string): Promise<MeetingRecordSummaryDto[]> {
    await this.policy.requireChannelMember(userId, channelId);
    return this.list({ channelId });
  }

  async listForConversation(userId: string, conversationId: string): Promise<MeetingRecordSummaryDto[]> {
    await this.policy.requireConversationMember(userId, conversationId);
    return this.list({ conversationId });
  }

  private async list(where: { channelId?: string; conversationId?: string }): Promise<MeetingRecordSummaryDto[]> {
    const rows = await this.prisma.meetingRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.toSummary(r));
  }

  async get(userId: string, id: string): Promise<MeetingRecordDto> {
    const record = await this.load(userId, id);
    return this.toDto(record);
  }

  // ---------- AI minutes ----------

  async generate(userId: string, id: string): Promise<MeetingRecordDto> {
    const record = await this.load(userId, id);
    const lines = (record.transcript as unknown as MeetingTranscriptLine[]) ?? [];
    const body = [
      ...lines.map((l) => `${l.name}${l.kind === 'chat' ? ' (chat)' : ''}: ${l.text}`),
      record.notes ? `\nShared notes:\n${record.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { summary, decisions, actionItems } = await this.ai.generateMinutes(body);
    const updated = await this.prisma.meetingRecord.update({
      where: { id: record.id },
      data: {
        summary: summary || null,
        decisions: decisions as object,
        actionItems: actionItems as object,
        minutesGeneratedAt: new Date(),
      },
    });
    return this.toDto(updated);
  }

  // ---------- action item → Decision ----------

  async actionItemToDecision(userId: string, id: string, index: number): Promise<DecisionDto> {
    const record = await this.load(userId, id);
    if (!record.channelId) {
      throw new BadRequestException('Decisions can only be created from a channel meeting.');
    }
    const items = (record.actionItems as unknown as string[]) ?? [];
    const item = items[index];
    if (!item) throw new NotFoundException('Action item not found');
    return this.decisions.create(userId, record.workspaceId, {
      channelId: record.channelId,
      title: item.slice(0, 200),
      detail: `Captured from the meeting on ${record.startedAt.toLocaleString()}.`,
    });
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.load(userId, id); // access check
    await this.prisma.meetingRecord.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  // ---------- helpers ----------

  private async load(userId: string, id: string): Promise<MeetingRecord> {
    const record = await this.prisma.meetingRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Meeting record not found');
    if (record.channelId) await this.policy.requireChannelMember(userId, record.channelId);
    else if (record.conversationId) await this.policy.requireConversationMember(userId, record.conversationId);
    else throw new NotFoundException('Meeting record not found');
    return record;
  }

  private toSummary(r: MeetingRecord): MeetingRecordSummaryDto {
    const lines = (r.transcript as unknown as MeetingTranscriptLine[]) ?? [];
    const actionItems = (r.actionItems as unknown as string[]) ?? [];
    return {
      id: r.id,
      channelId: r.channelId,
      conversationId: r.conversationId,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt.toISOString(),
      lineCount: lines.length,
      hasMinutes: r.minutesGeneratedAt !== null,
      summaryPreview: r.summary ? r.summary.split('\n')[0].replace(/^[-*\s]+/, '') : null,
      actionItemCount: actionItems.length,
    };
  }

  private toDto(r: MeetingRecord): MeetingRecordDto {
    return {
      ...this.toSummary(r),
      transcript: (r.transcript as unknown as MeetingTranscriptLine[]) ?? [],
      notes: r.notes,
      summary: r.summary,
      decisions: (r.decisions as unknown as string[]) ?? [],
      actionItems: (r.actionItems as unknown as string[]) ?? [],
    };
  }
}
