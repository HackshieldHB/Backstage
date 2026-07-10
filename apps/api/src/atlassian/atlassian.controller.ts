import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AtlassianService } from './atlassian.service';
import { AtlassianSyncService } from './sync.service';
import { JiraEventsService, type JiraWebhookBody } from './jira-events.service';
import { JiraActionsService } from './jira-actions.service';
import { PolicyService } from '../authz/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const SubscriptionSchema = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]+$/),
  events: z
    .array(z.enum(['issue_created', 'issue_assigned', 'status_changed', 'comment_created']))
    .min(1),
});

const JiraCommandSchema = z.object({
  issueKey: z.string().min(3).max(30),
});

const CreateIssueSchema = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]+$/),
  summary: z.string().max(200).optional(),
});

@Controller()
export class AtlassianController {
  constructor(
    private readonly atlassian: AtlassianService,
    private readonly sync: AtlassianSyncService,
    private readonly jiraEvents: JiraEventsService,
    private readonly jiraActions: JiraActionsService,
    private readonly policy: PolicyService,
    private readonly prisma: PrismaService,
  ) {}

  // ----- connect / status / sync -----

  @Get('workspaces/:id/atlassian/connect-url')
  connectUrl(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.atlassian.connectUrl(user.id, workspaceId);
  }

  @Get('workspaces/:id/atlassian/status')
  status(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.atlassian.status(user.id, workspaceId);
  }

  @HttpCode(200)
  @Post('workspaces/:id/atlassian/sync')
  async syncNow(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    await this.policy.requireWorkspaceMember(user.id, workspaceId, 'ADMIN');
    return this.sync.syncWorkspace(workspaceId);
  }

  /** OAuth redirect target for connect AND SSO (state-dispatched). */
  @Public()
  @Get('atlassian/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const { redirect } = await this.atlassian.handleCallback(code, state);
    res.redirect(redirect);
  }

  /** "Log in with Atlassian" entry point. */
  @Public()
  @Get('auth/atlassian')
  async ssoStart(@Res() res: Response) {
    const { url } = await this.atlassian.ssoUrl();
    res.redirect(url);
  }

  // ----- webhook receiver -----

  @Public()
  @HttpCode(200)
  @Post('webhooks/jira/:connectionId')
  webhook(
    @Param('connectionId') connectionId: string,
    @Headers('x-backstages-secret') headerSecret: string | undefined,
    @Query('secret') querySecret: string | undefined,
    @Body() body: JiraWebhookBody,
  ) {
    return this.jiraEvents.handleWebhook(connectionId, headerSecret ?? querySecret, body);
  }

  // ----- per-channel project subscriptions -----

  @Get('channels/:id/jira/subscriptions')
  async listSubscriptions(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    const { channel } = await this.policy.requireChannelMember(user.id, channelId);
    const connection = await this.prisma.atlassianConnection.findUnique({
      where: { workspaceId: channel.workspaceId },
    });
    if (!connection) return [];
    return this.prisma.channelJiraSubscription.findMany({
      where: { channelId, connectionId: connection.id },
      select: { id: true, projectKey: true, events: true },
    });
  }

  @Post('channels/:id/jira/subscriptions')
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(SubscriptionSchema)) body: z.infer<typeof SubscriptionSchema>,
  ) {
    const { channel } = await this.policy.requireChannelMember(user.id, channelId);
    const connection = await this.atlassian.connectionForWorkspace(channel.workspaceId);
    return this.prisma.channelJiraSubscription.upsert({
      where: { channelId_projectKey: { channelId, projectKey: body.projectKey } },
      create: {
        channelId,
        connectionId: connection.id,
        projectKey: body.projectKey,
        events: body.events,
      },
      update: { events: body.events },
    });
  }

  @Delete('channels/:id/jira/subscriptions/:subscriptionId')
  async unsubscribe(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    await this.policy.requireChannelMember(user.id, channelId);
    await this.prisma.channelJiraSubscription.deleteMany({
      where: { id: subscriptionId, channelId },
    });
    return { ok: true };
  }

  // ----- actions -----

  @HttpCode(200)
  @Post('channels/:id/jira/command')
  jiraCommand(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(JiraCommandSchema)) body: z.infer<typeof JiraCommandSchema>,
  ) {
    return this.jiraActions.jiraCommand(user.id, channelId, body.issueKey.toUpperCase());
  }

  @HttpCode(200)
  @Post('messages/:id/create-jira-issue')
  createIssue(
    @CurrentUser() user: AuthUser,
    @Param('id') messageId: string,
    @Body(new ZodValidationPipe(CreateIssueSchema)) body: z.infer<typeof CreateIssueSchema>,
  ) {
    return this.jiraActions.createIssueFromMessage(user.id, messageId, body);
  }
}
