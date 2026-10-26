import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AppCatalogEntry,
  ApplicationDetailDto,
  ApplicationsOverviewDto,
  ApplicationSummaryDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';
import { decryptToken, encryptToken } from '../atlassian/crypto';
import { PROVIDERS, ProviderError, type Http, type ProviderResult } from './providers';

const CACHE_MS = 60_000;

type Cached = { at: number; result: ProviderResult } | { at: number; error: string };

/**
 * The Applications hub's connections: admins connect a tool with its own API
 * credentials (stored encrypted), everyone in the workspace sees its live
 * status. Reads are cached briefly so opening the hub doesn't hammer the
 * third-party APIs.
 */
@Injectable()
export class ApplicationsService {
  /** Overridable in tests. */
  http: Http = fetch;
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  catalog(): AppCatalogEntry[] {
    return Object.values(PROVIDERS).map((p) => p.catalog);
  }

  async overview(userId: string, workspaceId: string): Promise<ApplicationsOverviewDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connections = await this.prisma.appConnection.findMany({ where: { workspaceId } });
    const apps = await Promise.all(
      this.catalog().map(async (entry): Promise<ApplicationSummaryDto> => {
        const conn = connections.find((c) => c.appId === entry.id);
        if (!conn) {
          return {
            id: entry.id,
            connected: false,
            status: 'unknown',
            statusReason: 'Not connected yet.',
            metrics: [],
            lastChecked: null,
            url: entry.homeUrl,
            settings: {},
            secretsSet: [],
          };
        }
        const settings = toSettings(conn.config);
        const secretsSet = Object.keys(this.secretsOf(conn.secretEnc));
        const read = await this.read(workspaceId, entry.id, settings, conn.secretEnc);
        if ('error' in read) {
          return {
            id: entry.id,
            connected: true,
            status: 'unknown',
            statusReason: read.error,
            metrics: [],
            lastChecked: null,
            url: entry.homeUrl,
            settings,
            secretsSet,
          };
        }
        return {
          id: entry.id,
          connected: true,
          status: read.result.status,
          statusReason: read.result.statusReason,
          metrics: read.result.metrics,
          lastChecked: new Date(read.at).toISOString(),
          url: read.result.url,
          settings,
          secretsSet,
        };
      }),
    );
    return { catalog: this.catalog(), apps };
  }

  async detail(userId: string, workspaceId: string, appId: string): Promise<ApplicationDetailDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const conn = await this.prisma.appConnection.findUnique({
      where: { workspaceId_appId: { workspaceId, appId } },
    });
    if (!conn || !PROVIDERS[appId])
      throw new NotFoundException('That application isn’t connected.');
    const read = await this.read(workspaceId, appId, toSettings(conn.config), conn.secretEnc);
    if ('error' in read) {
      return {
        id: appId,
        status: 'unknown',
        statusReason: read.error,
        fetchedAt: new Date(read.at).toISOString(),
        url: PROVIDERS[appId].catalog.homeUrl,
        stats: [],
        lists: [],
      };
    }
    return {
      id: appId,
      status: read.result.status,
      statusReason: read.result.statusReason,
      fetchedAt: new Date(read.at).toISOString(),
      url: read.result.url,
      stats: read.result.stats,
      lists: read.result.lists,
    };
  }

  /**
   * Connect or update an application. Blank secret fields keep what's stored, so
   * an admin can change e.g. the Datadog site without re-entering keys. The
   * credentials are tried against the real API before anything is saved.
   */
  async connect(
    userId: string,
    workspaceId: string,
    appId: string,
    fields: Record<string, string>,
  ): Promise<ApplicationSummaryDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const provider = PROVIDERS[appId];
    if (!provider) throw new NotFoundException('Unknown application');
    const existing = await this.prisma.appConnection.findUnique({
      where: { workspaceId_appId: { workspaceId, appId } },
    });
    const storedSecrets = existing ? this.secretsOf(existing.secretEnc) : {};

    const settings: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const f of provider.catalog.fields) {
      const given = (fields[f.key] ?? '').trim();
      if (f.secret) {
        const value = given || storedSecrets[f.key] || '';
        if (!value && !f.optional) throw new BadRequestException(`${f.label} is required.`);
        if (value) secrets[f.key] = value;
      } else {
        const value = given || f.defaultValue || '';
        if (!value && !f.optional) throw new BadRequestException(`${f.label} is required.`);
        settings[f.key] = value;
      }
    }
    const settingsProblem = provider.checkSettings?.(settings);
    if (settingsProblem) throw new BadRequestException(settingsProblem);

    let result: ProviderResult;
    try {
      result = await provider.fetch(settings, secrets, this.http);
    } catch (err) {
      throw new BadRequestException(
        err instanceof ProviderError
          ? err.message
          : `Couldn’t connect to ${provider.catalog.name}.`,
      );
    }

    const secretEnc = encryptToken(JSON.stringify(secrets));
    await this.prisma.appConnection.upsert({
      where: { workspaceId_appId: { workspaceId, appId } },
      create: { workspaceId, appId, config: settings, secretEnc, createdById: userId },
      update: { config: settings, secretEnc },
    });
    const at = Date.now();
    this.cache.set(cacheKey(workspaceId, appId), { at, result });
    this.audit.record(
      workspaceId,
      userId,
      existing ? 'application.update' : 'application.connect',
      {
        targetType: 'application',
        targetId: appId,
      },
    );
    return {
      id: appId,
      connected: true,
      status: result.status,
      statusReason: result.statusReason,
      metrics: result.metrics,
      lastChecked: new Date(at).toISOString(),
      url: result.url,
      settings,
      secretsSet: Object.keys(secrets),
    };
  }

  async disconnect(userId: string, workspaceId: string, appId: string): Promise<{ ok: true }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const { count } = await this.prisma.appConnection.deleteMany({ where: { workspaceId, appId } });
    this.cache.delete(cacheKey(workspaceId, appId));
    if (count > 0) {
      this.audit.record(workspaceId, userId, 'application.disconnect', {
        targetType: 'application',
        targetId: appId,
      });
    }
    return { ok: true };
  }

  private async read(
    workspaceId: string,
    appId: string,
    settings: Record<string, string>,
    secretEnc: string,
  ): Promise<Cached> {
    const key = cacheKey(workspaceId, appId);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;
    const provider = PROVIDERS[appId];
    let entry: Cached;
    try {
      entry = {
        at: Date.now(),
        result: await provider.fetch(settings, this.secretsOf(secretEnc), this.http),
      };
    } catch (err) {
      entry = {
        at: Date.now(),
        error:
          err instanceof ProviderError
            ? err.message
            : `Couldn’t read ${provider.catalog.name} right now.`,
      };
    }
    this.cache.set(key, entry);
    return entry;
  }

  private secretsOf(secretEnc: string): Record<string, string> {
    try {
      const parsed = JSON.parse(decryptToken(secretEnc)) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}

function cacheKey(workspaceId: string, appId: string) {
  return `${workspaceId}:${appId}`;
}

function toSettings(config: unknown): Record<string, string> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return Object.fromEntries(
    Object.entries(config as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
}
