import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Prisma, User, WorkspaceMember } from '@prisma/client';
import type { ScimStatusDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';
import { hashToken } from './api-token-auth';
import { DomainsService } from './domains.service';

export const SCIM_TOKEN_PREFIX = 'bs_scim_';
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const MAX_PAGE = 200;

/** A SCIM protocol error (RFC 7644 §3.12) — rendered as SCIM JSON, not our envelope. */
export class ScimError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly scimType?: string,
  ) {
    super(detail);
  }

  body() {
    return {
      schemas: [ERROR_SCHEMA],
      status: String(this.status),
      detail: this.detail,
      ...(this.scimType ? { scimType: this.scimType } : {}),
    };
  }
}

type MemberWithUser = WorkspaceMember & { user: User };

export interface ScimUserInput {
  userName?: unknown;
  displayName?: unknown;
  name?: { givenName?: unknown; familyName?: unknown; formatted?: unknown };
  emails?: Array<{ value?: unknown; primary?: unknown }>;
  active?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SCIM 2.0 user provisioning (Okta, Entra ID, OneLogin, …), scoped to one
 * workspace by its bearer token.
 *
 *  - Users are workspace members; `id` is the Backstages user id.
 *  - Only emails on the workspace's DNS-verified domains can be provisioned,
 *    so a directory can never pull in someone else's account.
 *  - Create adds a membership (creating a provisional, password-less account
 *    when the email is new — the person activates it by signing up or SSO).
 *  - `active: false` / DELETE deactivate the membership; history is kept.
 *  - Profile fields (name, email) are only changed for accounts that have never
 *    been activated: an activated person may belong to other workspaces, and
 *    one workspace's directory must not rename them everywhere.
 *  - The workspace owner can't be deactivated through SCIM (no lock-out).
 */
@Injectable()
export class ScimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly domains: DomainsService,
  ) {}

  // ---------- token management (owner, via the normal API) ----------

  async status(userId: string, workspaceId: string): Promise<ScimStatusDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return { enabled: !!ws.scimTokenHash, tokenPrefix: ws.scimTokenPrefix, baseUrl: scimBaseUrl() };
  }

  async rotateToken(userId: string, workspaceId: string): Promise<ScimStatusDto & { token: string }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'OWNER');
    const token = SCIM_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const prefix = token.slice(0, SCIM_TOKEN_PREFIX.length + 4);
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { scimTokenHash: hashToken(token), scimTokenPrefix: prefix },
    });
    this.audit.record(workspaceId, userId, 'scim.token.rotate', { targetType: 'workspace', targetId: workspaceId });
    return { enabled: true, tokenPrefix: prefix, baseUrl: scimBaseUrl(), token };
  }

  async disable(userId: string, workspaceId: string): Promise<ScimStatusDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'OWNER');
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { scimTokenHash: null, scimTokenPrefix: null },
    });
    this.audit.record(workspaceId, userId, 'scim.disable', { targetType: 'workspace', targetId: workspaceId });
    return { enabled: false, tokenPrefix: null, baseUrl: scimBaseUrl() };
  }

  /** Resolve the workspace a SCIM bearer token belongs to. */
  async authenticate(authorization: string | undefined): Promise<string> {
    const raw = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!raw.startsWith(SCIM_TOKEN_PREFIX) || raw.length > 200) {
      throw new ScimError(401, 'Missing or invalid SCIM token');
    }
    const ws = await this.prisma.workspace.findUnique({
      where: { scimTokenHash: hashToken(raw) },
      select: { id: true },
    });
    if (!ws) throw new ScimError(401, 'Missing or invalid SCIM token');
    return ws.id;
  }

  // ---------- SCIM resources ----------

  async listUsers(workspaceId: string, filter: string | undefined, startIndexRaw?: string, countRaw?: string) {
    const startIndex = Math.max(1, Number.parseInt(startIndexRaw ?? '1', 10) || 1);
    const count = Math.min(MAX_PAGE, Math.max(0, Number.parseInt(countRaw ?? '100', 10) || 0));
    const where: Prisma.WorkspaceMemberWhereInput = { workspaceId, user: { isBot: false } };
    if (filter) {
      // The filters IdPs actually send: userName eq "x", emails[...] eq, externalId is not stored.
      const m = /^\s*(userName|emails(?:\[type eq "work"\])?(?:\.value)?)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
      if (!m) throw new ScimError(400, 'Unsupported filter — use userName eq "…"', 'invalidFilter');
      where.user = { isBot: false, email: m[2].trim().toLowerCase() };
    }
    const [total, rows] = await Promise.all([
      this.prisma.workspaceMember.count({ where }),
      count === 0
        ? Promise.resolve([] as MemberWithUser[])
        : this.prisma.workspaceMember.findMany({
            where,
            include: { user: true },
            orderBy: { createdAt: 'asc' },
            skip: startIndex - 1,
            take: count,
          }),
    ]);
    return {
      schemas: [LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map(toScimUser),
    };
  }

  async getUser(workspaceId: string, id: string) {
    return toScimUser(await this.requireMember(workspaceId, id));
  }

  async createUser(workspaceId: string, body: ScimUserInput) {
    const email = emailOf(body);
    if (!email) throw new ScimError(400, 'userName (an email address) is required', 'invalidValue');
    if (!(await this.domains.isVerifiedFor(workspaceId, email))) {
      throw new ScimError(403, `Verify the domain of ${email} in Backstages before provisioning it`);
    }
    const displayName = displayNameOf(body) ?? email.split('@')[0];
    const active = body.active !== false;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.isBot) throw new ScimError(409, 'That userName is taken', 'uniqueness');
    if (existing) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existing.id } },
      });
      if (member && !member.deactivatedAt) throw new ScimError(409, 'User already exists', 'uniqueness');
      const saved = member
        ? await this.prisma.workspaceMember.update({
            where: { id: member.id },
            data: { deactivatedAt: active ? null : new Date() },
            include: { user: true },
          })
        : await this.prisma.workspaceMember.create({
            data: { workspaceId, userId: existing.id, role: 'MEMBER', deactivatedAt: active ? null : new Date() },
            include: { user: true },
          });
      this.audit.record(workspaceId, null, 'scim.user.provision', { targetType: 'user', targetId: existing.id });
      return toScimUser(saved);
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash: null,
        isProvisional: true,
        workspaceMemberships: {
          create: { workspaceId, role: 'MEMBER', deactivatedAt: active ? null : new Date() },
        },
      },
    });
    this.audit.record(workspaceId, null, 'scim.user.provision', { targetType: 'user', targetId: user.id });
    return this.getUser(workspaceId, user.id);
  }

  async replaceUser(workspaceId: string, id: string, body: ScimUserInput) {
    const member = await this.requireMember(workspaceId, id);
    await this.applyChanges(member, {
      displayName: displayNameOf(body),
      email: emailOf(body),
      active: typeof body.active === 'boolean' ? body.active : undefined,
    });
    return this.getUser(workspaceId, id);
  }

  async patchUser(workspaceId: string, id: string, body: unknown) {
    const member = await this.requireMember(workspaceId, id);
    const ops = (body as { schemas?: unknown; Operations?: unknown })?.Operations;
    if (!Array.isArray(ops)) {
      throw new ScimError(400, `Expected a ${PATCH_SCHEMA} body with Operations`, 'invalidSyntax');
    }
    const changes: { displayName?: string; email?: string; active?: boolean } = {};
    for (const raw of ops) {
      const op = String((raw as { op?: unknown })?.op ?? '').toLowerCase();
      const path = (raw as { path?: unknown }).path;
      const value = (raw as { value?: unknown }).value;
      if (op !== 'replace' && op !== 'add') continue; // 'remove' of optional attrs: nothing we store
      const entries: Array<[string, unknown]> =
        typeof path === 'string' ? [[path, value]] : value && typeof value === 'object' ? Object.entries(value) : [];
      for (const [key, v] of entries) {
        const k = key.toLowerCase();
        if (k === 'active') changes.active = v === true || v === 'true' || v === 'True';
        else if (k === 'displayname' && typeof v === 'string') changes.displayName = v;
        else if (k === 'name.formatted' && typeof v === 'string') changes.displayName = v;
        else if (k === 'username' && typeof v === 'string') changes.email = v;
        else if (k === 'name' && v && typeof v === 'object') {
          changes.displayName = displayNameOf({ name: v as ScimUserInput['name'] }) ?? changes.displayName;
        }
      }
    }
    await this.applyChanges(member, changes);
    return this.getUser(workspaceId, id);
  }

  async deleteUser(workspaceId: string, id: string): Promise<void> {
    const member = await this.requireMember(workspaceId, id);
    await this.applyChanges(member, { active: false });
  }

  private async applyChanges(
    member: MemberWithUser,
    changes: { displayName?: string; email?: string; active?: boolean },
  ) {
    if (changes.active !== undefined) {
      if (!changes.active && member.role === 'OWNER') {
        throw new ScimError(400, 'The workspace owner cannot be deactivated through SCIM', 'mutability');
      }
      const isActive = !member.deactivatedAt;
      if (isActive !== changes.active) {
        await this.prisma.workspaceMember.update({
          where: { id: member.id },
          data: { deactivatedAt: changes.active ? null : new Date() },
        });
        this.audit.record(member.workspaceId, null, changes.active ? 'scim.user.activate' : 'scim.user.deactivate', {
          targetType: 'user',
          targetId: member.userId,
        });
      }
    }
    if (member.user.isProvisional) {
      const data: Prisma.UserUpdateInput = {};
      const name = changes.displayName?.trim().slice(0, 80);
      if (name) data.displayName = name;
      const email = changes.email?.trim().toLowerCase();
      if (email && EMAIL_RE.test(email) && email !== member.user.email) {
        if (!(await this.domains.isVerifiedFor(member.workspaceId, email))) {
          throw new ScimError(403, `Verify the domain of ${email} in Backstages first`);
        }
        const taken = await this.prisma.user.findUnique({ where: { email } });
        if (taken) throw new ScimError(409, 'That userName is taken', 'uniqueness');
        data.email = email;
      }
      if (Object.keys(data).length > 0) await this.prisma.user.update({ where: { id: member.userId }, data });
    }
  }

  private async requireMember(workspaceId: string, userId: string): Promise<MemberWithUser> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { user: true },
    });
    if (!member || member.user.isBot) throw new ScimError(404, 'User not found');
    return member;
  }
}

export function scimBaseUrl(): string {
  const api = (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/+$/, '');
  return `${api}/scim/v2`;
}

function emailOf(body: ScimUserInput): string | undefined {
  const candidates = [
    body.userName,
    body.emails?.find((e) => e?.primary === true)?.value,
    body.emails?.[0]?.value,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && EMAIL_RE.test(c.trim())) return c.trim().toLowerCase();
  }
  return undefined;
}

function displayNameOf(body: ScimUserInput): string | undefined {
  if (typeof body.displayName === 'string' && body.displayName.trim()) return body.displayName.trim();
  if (typeof body.name?.formatted === 'string' && body.name.formatted.trim()) return body.name.formatted.trim();
  const parts = [body.name?.givenName, body.name?.familyName].filter(
    (p): p is string => typeof p === 'string' && !!p.trim(),
  );
  return parts.length ? parts.join(' ').trim() : undefined;
}

function toScimUser(m: MemberWithUser) {
  const [givenName, ...rest] = m.user.displayName.split(' ');
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: m.user.id,
    userName: m.user.email,
    displayName: m.user.displayName,
    name: { formatted: m.user.displayName, givenName, familyName: rest.join(' ') || undefined },
    emails: [{ value: m.user.email, type: 'work', primary: true }],
    active: !m.deactivatedAt,
    meta: {
      resourceType: 'User',
      created: m.createdAt.toISOString(),
      lastModified: m.user.updatedAt.toISOString(),
      location: `${scimBaseUrl()}/Users/${m.user.id}`,
    },
  };
}
