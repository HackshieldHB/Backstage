import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { GithubSubscription } from '@prisma/client';
import type {
  CreateGithubIssueInput,
  CreateGithubSubscriptionInput,
  CreatedGithubSubscriptionDto,
  GithubConnectionDto,
  GithubEvent,
  GithubIssueCreatedDto,
  GithubSubscriptionDto,
  JiraUnfurl,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AppRegistry, type IntegrationApp } from '../integrations/app-registry';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';
import { decryptToken } from '../atlassian/crypto';
import { SocialLoginService } from '../auth/social-login.service';
import { providerCredentials } from '../auth/oauth-providers';
import { createIssue, fetchItem, findGithubLinks, GithubApiError } from './github-api';

const apiBase = () => (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/+$/, '');
const webBase = () => (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
const UNFURL_TTL_MS = 5 * 60_000;

function doc(text: string, href?: string) {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) }] },
    ],
  };
}

/**
 * The 'github' integration app.
 *  - Channels follow repos through repo webhooks (see GithubEventsService).
 *  - github.com PR/issue links get a live preview: public repos, or private repos
 *    this workspace subscribed to (fetched with GITHUB_API_TOKEN, if set). A
 *    server token never previews a private repo nobody here connected.
 *  - People connect their own GitHub account to create issues as themselves.
 */
@Injectable()
export class GithubService implements IntegrationApp, OnModuleInit {
  readonly id = 'github';
  private readonly logger = new Logger(GithubService.name);
  private readonly unfurlCache = new Map<string, { at: number; card: JiraUnfurl | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly registry: AppRegistry,
    private readonly integrationMessages: IntegrationMessagesService,
    private readonly social: SocialLoginService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  // ---------- subscriptions ----------

  async list(userId: string, workspaceId: string): Promise<GithubSubscriptionDto[]> {
    const { channelIds } = await this.policy.accessibleContainers(userId, workspaceId);
    const rows = await this.prisma.githubSubscription.findMany({
      where: { workspaceId, channelId: { in: channelIds } },
      include: { channel: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDto(r, r.channel.name));
  }

  async create(userId: string, input: CreateGithubSubscriptionInput): Promise<CreatedGithubSubscriptionDto> {
    const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
    if (channel.isArchived) throw new BadRequestException('This channel is archived');
    const repoFullName = input.repo.trim().toLowerCase();
    const existing = await this.prisma.githubSubscription.findUnique({
      where: { channelId_repoFullName: { channelId: channel.id, repoFullName } },
    });
    if (existing) throw new BadRequestException(`#${channel.name} already follows ${repoFullName}`);
    const row = await this.prisma.githubSubscription.create({
      data: {
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        repoFullName,
        webhookSecret: randomBytes(24).toString('hex'),
        events: [...new Set(input.events)],
        createdById: userId,
      },
    });
    return { ...this.toDto(row, channel.name), webhookSecret: row.webhookSecret };
  }

  async updateEvents(userId: string, id: string, events: GithubEvent[]): Promise<GithubSubscriptionDto> {
    const row = await this.requireSub(userId, id);
    const saved = await this.prisma.githubSubscription.update({ where: { id: row.id }, data: { events: [...new Set(events)] } });
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: row.channelId }, select: { name: true } });
    return this.toDto(saved, channel.name);
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const row = await this.requireSub(userId, id);
    await this.prisma.githubSubscription.delete({ where: { id: row.id } });
    return { ok: true };
  }

  private async requireSub(userId: string, id: string): Promise<GithubSubscription> {
    const row = await this.prisma.githubSubscription.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Subscription not found');
    await this.policy.requireChannelMember(userId, row.channelId);
    return row;
  }

  private toDto(r: GithubSubscription, channelName: string): GithubSubscriptionDto {
    return {
      id: r.id,
      channelId: r.channelId,
      channelName,
      repo: r.repoFullName,
      events: r.events as GithubEvent[],
      webhookUrl: `${apiBase()}/webhooks/github/${r.id}`,
      createdAt: r.createdAt.toISOString(),
    };
  }

  // ---------- link previews (IntegrationApp) ----------

  async unfurl(workspaceId: string, contentText: string): Promise<unknown[] | null> {
    const links = findGithubLinks(contentText);
    if (!links.length) return null;
    const subscribed = new Set(
      (
        await this.prisma.githubSubscription.findMany({
          where: { workspaceId, repoFullName: { in: links.map((l) => l.repo) } },
          select: { repoFullName: true },
        })
      ).map((s) => s.repoFullName),
    );
    const cards = await Promise.all(
      links.map(async (l) => {
        const key = `${workspaceId}|${l.repo}|${l.kind}|${l.number}`;
        const hit = this.unfurlCache.get(key);
        if (hit && Date.now() - hit.at < UNFURL_TTL_MS) return hit.card;
        const card = await this.lookup(l.repo, l.kind, l.number, subscribed.has(l.repo));
        this.unfurlCache.set(key, { at: Date.now(), card });
        if (this.unfurlCache.size > 1000) this.unfurlCache.delete(this.unfurlCache.keys().next().value!);
        return card;
      }),
    );
    const found = cards.filter((c): c is JiraUnfurl => !!c);
    return found.length ? found : null;
  }

  private async lookup(repo: string, kind: 'pr' | 'issue', number: number, subscribed: boolean): Promise<JiraUnfurl | null> {
    const toCard = (i: Awaited<ReturnType<typeof fetchItem>>): JiraUnfurl => ({
      type: 'github',
      url: i.url,
      key: `${repo}#${number}`,
      title: i.title,
      status: i.state,
    });
    try {
      // Public repos need no token.
      return toCard(await fetchItem(repo, kind, number));
    } catch (err) {
      const token = process.env.GITHUB_API_TOKEN;
      // Private: only for repos this workspace subscribed to.
      if (!subscribed || !token || !(err instanceof GithubApiError) || (err.status !== 404 && err.status !== 403)) return null;
      try {
        return toCard(await fetchItem(repo, kind, number, token));
      } catch {
        return null;
      }
    }
  }

  // ---------- personal connection (create issues as yourself) ----------

  async connection(userId: string): Promise<GithubConnectionDto> {
    const link = await this.prisma.githubUserLink.findUnique({ where: { userId } });
    return { available: !!providerCredentials('github'), connected: !!link, login: link?.login ?? null };
  }

  async startConnect(userId: string): Promise<{ url: string }> {
    if (!providerCredentials('github')) throw new BadRequestException('GitHub is not set up on this server');
    return this.social.startGithubConnect(userId);
  }

  async confirmConnect(userId: string, code: string): Promise<GithubConnectionDto> {
    const c = await this.social.takeGithubConnect(userId, code);
    await this.prisma.githubUserLink.upsert({
      where: { userId },
      create: { userId, githubUserId: c.githubUserId, login: c.login, accessTokenEnc: c.accessTokenEnc, scopes: c.scopes },
      update: { githubUserId: c.githubUserId, login: c.login, accessTokenEnc: c.accessTokenEnc, scopes: c.scopes },
    });
    return this.connection(userId);
  }

  async disconnect(userId: string): Promise<GithubConnectionDto> {
    await this.prisma.githubUserLink.deleteMany({ where: { userId } });
    return this.connection(userId);
  }

  /** Create an issue as the caller, optionally from a message (reply goes in its thread). */
  async createIssue(userId: string, input: CreateGithubIssueInput): Promise<GithubIssueCreatedDto> {
    const link = await this.prisma.githubUserLink.findUnique({ where: { userId } });
    if (!link) throw new BadRequestException('Connect your GitHub account first');
    const repo = input.repo.trim().toLowerCase();

    let source: { channelId: string; workspaceId: string; messageId: string; parentId: string | null } | null = null;
    let body = input.body?.trim() ?? '';
    if (input.messageId) {
      const message = await this.prisma.message.findUnique({ where: { id: input.messageId } });
      if (!message || message.deletedAt || !message.channelId) throw new NotFoundException('Message not found');
      const { channel } = await this.policy.requireChannelMember(userId, message.channelId);
      source = { channelId: channel.id, workspaceId: channel.workspaceId, messageId: message.id, parentId: message.parentId };
      const backLink = `${webBase()}/app?ws=${channel.workspaceId}&c=${channel.id}&t=ch`;
      body = `${body ? `${body}\n\n` : ''}---\nFrom Backstages #${channel.name}: ${backLink}`;
    }

    let created: { number: number; html_url: string };
    try {
      created = await createIssue(decryptToken(link.accessTokenEnc), repo, { title: input.title.trim(), body });
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 401) {
        // Token revoked at GitHub: forget it so the UI asks to reconnect.
        await this.prisma.githubUserLink.deleteMany({ where: { userId } });
        throw new BadRequestException('Your GitHub connection expired — connect GitHub again');
      }
      if (err instanceof GithubApiError && (err.status === 404 || err.status === 403 || err.status === 410)) {
        throw new ForbiddenException(`GitHub won't let @${link.login} create issues in ${repo} (no access, or issues are turned off)`);
      }
      if (err instanceof GithubApiError && err.status === 422) throw new BadRequestException(err.message);
      this.logger.warn(`GitHub issue creation failed: ${String(err)}`);
      throw new BadRequestException('GitHub did not accept the issue — try again in a moment');
    }

    if (source) {
      const text = `📌 Created ${repo}#${created.number} from this message: ${input.title.trim()}`;
      await this.integrationMessages.post(channelContainer(source.channelId), {
        workspaceId: source.workspaceId,
        appName: 'GitHub',
        contentText: text,
        contentJson: doc(text, created.html_url),
        parentId: source.parentId ?? source.messageId,
        unfurls: [{ type: 'github', url: created.html_url, key: `${repo}#${created.number}`, title: input.title.trim(), status: 'open' }],
      });
    }
    return { number: created.number, url: created.html_url, repo };
  }
}
