import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as dns } from 'dns';
import { randomBytes } from 'crypto';
import type { WorkspaceDomain } from '@prisma/client';
import type { WorkspaceDomainDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';

export const CHALLENGE_LABEL = '_backstages-challenge';
const TXT_PREFIX = 'backstages-verification=';
const MAX_DOMAINS = 20;

/** TXT lookup, as a class so tests can swap it for a fake resolver. */
@Injectable()
export class TxtResolver {
  async resolve(name: string): Promise<string[]> {
    try {
      const records = await dns.resolveTxt(name);
      return records.map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  }
}

export const emailDomain = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/**
 * Domain verification. A workspace adds a domain, publishes
 * `_backstages-challenge.<domain> TXT "backstages-verification=<token>"`, then
 * verifies. A domain can be verified by one workspace only (DB partial unique
 * index). SSO sign-in and SCIM provisioning are limited to verified domains.
 */
@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly txt: TxtResolver,
  ) {}

  async list(userId: string, workspaceId: string): Promise<WorkspaceDomainDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const rows = await this.prisma.workspaceDomain.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async add(userId: string, workspaceId: string, domain: string): Promise<WorkspaceDomainDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'OWNER');
    const count = await this.prisma.workspaceDomain.count({ where: { workspaceId } });
    if (count >= MAX_DOMAINS) throw new BadRequestException(`At most ${MAX_DOMAINS} domains`);
    const existing = await this.prisma.workspaceDomain.findUnique({
      where: { workspaceId_domain: { workspaceId, domain } },
    });
    if (existing) return toDto(existing);
    const row = await this.prisma.workspaceDomain.create({
      data: { workspaceId, domain, token: randomBytes(16).toString('hex') },
    });
    return toDto(row);
  }

  async verify(userId: string, id: string): Promise<WorkspaceDomainDto> {
    const row = await this.requireDomain(userId, id);
    if (row.verifiedAt) return toDto(row);
    const records = await this.txt.resolve(`${CHALLENGE_LABEL}.${row.domain}`);
    if (!records.some((r) => r.trim() === TXT_PREFIX + row.token)) {
      throw new BadRequestException(
        `TXT record not found yet — add ${CHALLENGE_LABEL}.${row.domain} with value ${TXT_PREFIX}${row.token} (DNS can take a while to update)`,
      );
    }
    const taken = await this.prisma.workspaceDomain.findFirst({
      where: { domain: row.domain, verifiedAt: { not: null }, NOT: { id: row.id } },
    });
    if (taken) throw new ConflictException('Another workspace has already verified this domain');
    try {
      const saved = await this.prisma.workspaceDomain.update({
        where: { id: row.id },
        data: { verifiedAt: new Date() },
      });
      this.audit.record(row.workspaceId, userId, 'domain.verify', { targetType: 'domain', targetId: row.domain });
      return toDto(saved);
    } catch {
      // Lost a race with another workspace on the partial unique index.
      throw new ConflictException('Another workspace has already verified this domain');
    }
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    const row = await this.requireDomain(userId, id);
    await this.prisma.workspaceDomain.delete({ where: { id: row.id } });
    this.audit.record(row.workspaceId, userId, 'domain.remove', { targetType: 'domain', targetId: row.domain });
    return { ok: true };
  }

  /** The workspace that has verified this email's domain, if any. */
  async verifiedOwner(email: string): Promise<string | null> {
    const row = await this.prisma.workspaceDomain.findFirst({
      where: { domain: emailDomain(email), verifiedAt: { not: null } },
      select: { workspaceId: true },
    });
    return row?.workspaceId ?? null;
  }

  async isVerifiedFor(workspaceId: string, email: string): Promise<boolean> {
    return (await this.verifiedOwner(email)) === workspaceId;
  }

  private async requireDomain(userId: string, id: string): Promise<WorkspaceDomain> {
    const row = await this.prisma.workspaceDomain.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Domain not found');
    await this.policy.requireWorkspaceMember(userId, row.workspaceId, 'OWNER');
    return row;
  }
}

function toDto(d: WorkspaceDomain): WorkspaceDomainDto {
  return {
    id: d.id,
    domain: d.domain,
    verified: !!d.verifiedAt,
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
    txtRecordName: `${CHALLENGE_LABEL}.${d.domain}`,
    txtRecordValue: TXT_PREFIX + d.token,
  };
}
