import { Injectable, Logger } from '@nestjs/common';
import type { DigestPrefDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { EmailService } from '../email/email.service';
import { localTime } from '../standups/due';

/** Earliest member-local hour the daily digest may be sent. */
const SEND_AFTER_HOUR = 8;

function webBase(): string {
  return process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';
}

interface DigestDueRow {
  optIn: boolean;
  tzOffsetMin: number;
  lastOn: string | null;
}

/**
 * Should this member's digest fire at `nowMs`? True only when they opted in, their
 * local clock has passed the morning send hour, and it has not already fired on
 * their local day. `onDate` is the member-local date to stamp once sent.
 */
export function digestDue(r: DigestDueRow, nowMs: number): { due: boolean; onDate: string } {
  const lt = localTime(nowMs, r.tzOffsetMin);
  const onDate = lt.date;
  if (!r.optIn) return { due: false, onDate };
  if (lt.minutes < SEND_AFTER_HOUR * 60) return { due: false, onDate };
  if (r.lastOn === onDate) return { due: false, onDate };
  return { due: true, onDate };
}

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly email: EmailService,
  ) {}

  async pref(userId: string, workspaceId: string): Promise<DigestPrefDto> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    return { optIn: member.dailyDigestOptIn };
  }

  async setOptIn(
    userId: string,
    workspaceId: string,
    value: boolean,
    tzOffsetMin?: number,
  ): Promise<DigestPrefDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: {
        dailyDigestOptIn: value,
        ...(tzOffsetMin !== undefined ? { digestTzOffsetMin: tzOffsetMin } : {}),
      },
    });
    return { optIn: value };
  }

  /**
   * Scheduler entrypoint: email every opted-in member their daily digest once per
   * member-local day, in their local morning, but only when they actually have
   * something to catch up on.
   */
  async runDue(now = new Date()): Promise<number> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { dailyDigestOptIn: true, deactivatedAt: null },
      select: {
        workspaceId: true,
        userId: true,
        digestTzOffsetMin: true,
        digestLastOn: true,
        workspace: { select: { name: true } },
        user: { select: { email: true, displayName: true } },
      },
    });

    let sent = 0;
    const nowMs = now.getTime();
    const dayAgo = new Date(nowMs - 86400_000);
    for (const m of members) {
      const { due, onDate } = digestDue(
        { optIn: true, tzOffsetMin: m.digestTzOffsetMin, lastOn: m.digestLastOn },
        nowMs,
      );
      if (!due) continue;
      try {
        const [unread, mentions] = await Promise.all([
          this.prisma.notification.count({ where: { userId: m.userId, readAt: null } }),
          this.prisma.mention.count({
            where: { userId: m.userId, createdAt: { gte: dayAgo } },
          }),
        ]);
        if (unread === 0 && mentions === 0) continue; // nothing to say — don't send

        await this.email.send({
          to: m.user.email,
          subject: `Your daily digest — ${m.workspace.name}`,
          body: [
            `Hi ${m.user.displayName},`,
            '',
            `Here's what's waiting in ${m.workspace.name}:`,
            `• ${unread} unread notification${unread === 1 ? '' : 's'}`,
            `• ${mentions} mention${mentions === 1 ? '' : 's'} in the last 24 hours`,
            '',
            `Catch up: ${webBase()}`,
          ].join('\n'),
        });
        await this.prisma.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId: m.workspaceId, userId: m.userId } },
          data: { digestLastOn: onDate },
        });
        sent++;
      } catch (err) {
        this.logger.warn(`Digest for ${m.userId} skipped: ${String(err)}`);
      }
    }
    return sent;
  }
}
