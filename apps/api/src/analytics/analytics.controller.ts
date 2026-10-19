import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { SendFeedbackInput, SendFeedbackSchema, TrackUsageInput, TrackUsageSchema } from '@backstages/shared';
import { AnalyticsService } from './analytics.service';
import { FeedbackService } from './feedback.service';
import { UsageService } from './usage.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly feedback: FeedbackService,
    private readonly usage: UsageService,
  ) {}

  @Get('workspaces/:id/analytics')
  workspace(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.analytics.workspace(user.id, workspaceId);
  }

  @Post('workspaces/:id/feedback')
  @RateLimit({ limit: 10, windowSeconds: 600, bucket: 'feedback' })
  sendFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(SendFeedbackSchema)) body: SendFeedbackInput,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.feedback.send(user.id, workspaceId, body, userAgent);
  }

  @Get('workspaces/:id/feedback')
  listFeedback(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.feedback.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/usage')
  @HttpCode(202)
  @RateLimit({ limit: 60, windowSeconds: 60, bucket: 'usage' })
  track(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(TrackUsageSchema)) body: TrackUsageInput,
  ) {
    return this.usage.track(user.id, workspaceId, body);
  }
}
