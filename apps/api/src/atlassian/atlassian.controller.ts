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
import { JiraActionSchema } from '@backstages/shared';
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
  priority: z.enum(['Highest', 'High', 'Medium', 'Low', 'Lowest']).optional(),
});

const CreateChannelIssueSchema = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9]+$/),
  summary: z.string().min(1).max(200),
  priority: z.enum(['Highest', 'High', 'Medium', 'Low', 'Lowest']).optional(),
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

  @Get('workspaces/:id/atlassian/user-connect-url')
  userConnectUrl(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.atlassian.userConnectUrl(user.id, workspaceId);
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

  // ----- browse tree -----

  @Get('workspaces/:id/jira/my-issues')
  jiraMyIssues(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.jiraActions.myIssues(user.id, workspaceId);
  }

  @Get('workspaces/:id/jira/projects')
  jiraProjects(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.jiraActions.listProjects(user.id, workspaceId);
  }

  @Get('workspaces/:id/jira/projects/:projectKey/issues')
  jiraProjectIssues(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('projectKey') projectKey: string,
  ) {
    return this.jiraActions.listProjectIssues(user.id, workspaceId, projectKey.toUpperCase());
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
  @Post('channels/:id/jira/create-issue')
  createChannelIssue(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(CreateChannelIssueSchema)) body: z.infer<typeof CreateChannelIssueSchema>,
  ) {
    return this.jiraActions.createIssueInChannel(user.id, channelId, body);
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

  @Get('messages/:id/jira/transitions')
  transitions(
    @CurrentUser() user: AuthUser,
    @Param('id') messageId: string,
    @Query('issueKey') issueKey: string,
  ) {
    return this.jiraActions.listTransitions(user.id, messageId, (issueKey ?? '').toUpperCase());
  }

  @Get('messages/:id/jira/assignable')
  assignable(
    @CurrentUser() user: AuthUser,
    @Param('id') messageId: string,
    @Query('issueKey') issueKey: string,
  ) {
    return this.jiraActions.listAssignable(user.id, messageId, (issueKey ?? '').toUpperCase());
  }

  @HttpCode(200)
  @Post('messages/:id/jira/action')
  action(
    @CurrentUser() user: AuthUser,
    @Param('id') messageId: string,
    @Body(new ZodValidationPipe(JiraActionSchema)) body: z.infer<typeof JiraActionSchema>,
  ) {
    return this.jiraActions.performAction(user.id, messageId, {
      ...body,
      issueKey: body.issueKey.toUpperCase(),
    });
  }
}
