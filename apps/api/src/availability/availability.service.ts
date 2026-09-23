import { Injectable } from '@nestjs/common';
import type { Prisma, WorkspaceMember } from '@prisma/client';
import type { AvailabilityDto, AvailabilityInput } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { UsersService } from '../users/users.service';

const OOO_EMOJI = '🌴';

/**
 * Personal focus/working-hours + out-of-office prefs. Working hours are stored on
 * the member and used client-side to mute the member's own alerts. Setting OOO
 * also reflects into the user's status + DND so teammates see it and pushes pause.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly users: UsersService,
  ) {}

  async getMine(userId: string, workspaceId: string): Promise<AvailabilityDto> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    return this.toDto(member);
  }

  async setMine(userId: string, workspaceId: string, input: AvailabilityInput): Promise<AvailabilityDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const data: Prisma.WorkspaceMemberUpdateInput = {};
    if ('workStartMin' in input) data.workStartMin = input.workStartMin ?? null;
    if ('workEndMin' in input) data.workEndMin = input.workEndMin ?? null;
    if ('workDays' in input) data.workDays = input.workDays?.length ? input.workDays.join(',') : null;
    if ('oooMessage' in input) data.oooMessage = input.oooMessage ?? null;

    let oooChanged = false;
    let oooOn = false;
    if ('oooUntil' in input) {
      data.oooUntil = input.oooUntil ? new Date(input.oooUntil) : null;
      oooChanged = true;
      oooOn = !!input.oooUntil;
    }

    const member = await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data,
    });

    // Reflect OOO into the user's visible status + DND (so teammates see it live).
    if (oooChanged) {
      if (oooOn) {
        await this.users.updateStatus(userId, {
          statusEmoji: OOO_EMOJI,
          statusText: (input.oooMessage || 'Out of office').slice(0, 100),
          statusExpiresAt: input.oooUntil ?? null,
        });
        await this.users.setDnd(userId, input.oooUntil ?? null);
      } else {
        const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { statusEmoji: true } });
        if (u?.statusEmoji === OOO_EMOJI) {
          await this.users.updateStatus(userId, { statusEmoji: null, statusText: null, statusExpiresAt: null });
        }
        await this.users.setDnd(userId, null);
      }
    }
    return this.toDto(member);
  }

  private toDto(m: WorkspaceMember): AvailabilityDto {
    return {
      workStartMin: m.workStartMin,
      workEndMin: m.workEndMin,
      workDays: m.workDays ? m.workDays.split(',').map(Number).filter((n) => !Number.isNaN(n)) : null,
      tzOffsetMin: m.digestTzOffsetMin,
      oooUntil: m.oooUntil ? m.oooUntil.toISOString() : null,
      oooMessage: m.oooMessage,
    };
  }
}
