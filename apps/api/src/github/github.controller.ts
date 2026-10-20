import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateGithubIssueInput,
  CreateGithubIssueSchema,
  CreateGithubSubscriptionInput,
  CreateGithubSubscriptionSchema,
  GithubConnectConfirmInput,
  GithubConnectConfirmSchema,
  UpdateGithubSubscriptionInput,
  UpdateGithubSubscriptionSchema,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { HumanOnly } from '../common/human-only.decorator';
import { Public } from '../common/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GithubService } from './github.service';
import { GithubEventsService, type GithubWebhookBody } from './github-events.service';

@Controller()
export class GithubController {
  constructor(
    private readonly github: GithubService,
    private readonly events: GithubEventsService,
  ) {}

  // ---------- webhook receiver (GitHub → us) ----------

  @Public()
  @RateLimit({ limit: 600, windowSeconds: 60, bucket: 'github-webhook' })
  @HttpCode(200)
  @Post('webhooks/github/:subscriptionId')
  webhook(
    @Param('subscriptionId') subscriptionId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') delivery: string | undefined,
    @Body() body: GithubWebhookBody,
  ) {
    return this.events.handleWebhook(subscriptionId, { rawBody: req.rawBody, signature, event, delivery }, body ?? {});
  }

  // ---------- channel subscriptions ----------

  @Get('workspaces/:id/github/subscriptions')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.github.list(user.id, workspaceId);
  }

  @Post('github/subscriptions')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateGithubSubscriptionSchema)) body: CreateGithubSubscriptionInput,
  ) {
    return this.github.create(user.id, body);
  }

  @Patch('github/subscriptions/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateGithubSubscriptionSchema)) body: UpdateGithubSubscriptionInput,
  ) {
    return this.github.updateEvents(user.id, id, body.events);
  }

  @Delete('github/subscriptions/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.github.remove(user.id, id);
  }

  // ---------- my GitHub account (create issues as me) ----------

  @HumanOnly()
  @Get('me/github')
  connection(@CurrentUser() user: AuthUser) {
    return this.github.connection(user.id);
  }

  @HumanOnly()
  @RateLimit({ limit: 10, windowSeconds: 60, bucket: 'github-connect' })
  @HttpCode(200)
  @Post('me/github/connect')
  connect(@CurrentUser() user: AuthUser) {
    return this.github.startConnect(user.id);
  }

  @HumanOnly()
  @HttpCode(200)
  @Post('me/github/connect/confirm')
  confirm(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(GithubConnectConfirmSchema)) body: GithubConnectConfirmInput) {
    return this.github.confirmConnect(user.id, body.code);
  }

  @HumanOnly()
  @Delete('me/github')
  disconnect(@CurrentUser() user: AuthUser) {
    return this.github.disconnect(user.id);
  }

  @RateLimit({ limit: 20, windowSeconds: 60, bucket: 'github-issue' })
  @Post('github/issues')
  createIssue(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CreateGithubIssueSchema)) body: CreateGithubIssueInput) {
    return this.github.createIssue(user.id, body);
  }
}
