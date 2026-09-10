import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RecommendationFeedbackSchema, type RecommendationFeedbackInput } from '@backstages/shared';
import { RecommendationsService } from './recommendations.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('workspaces/:id/recommendations')
export class RecommendationsController {
  constructor(private readonly recs: RecommendationsService) {}

  @Get('discover')
  discover(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.recs.discover(user.id, workspaceId);
  }

  @Get('people')
  people(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.recs.people(user.id, workspaceId);
  }

  @Get('channels')
  channels(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.recs.channels(user.id, workspaceId);
  }

  @Get('priority')
  priority(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.recs.priorityInbox(user.id, workspaceId);
  }

  @Get('focus')
  focus(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.recs.focus(user.id, workspaceId);
  }

  @Get('best-time/:targetId')
  bestTime(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.recs.bestTime(user.id, workspaceId, targetId);
  }

  @Get('experts')
  experts(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query('q') q: string,
  ) {
    return this.recs.experts(user.id, workspaceId, q ?? '');
  }

  @Get('catchup')
  catchup(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.recs.catchup(user.id, workspaceId);
  }

  @Get('followups')
  followups(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.recs.followups(user.id, workspaceId);
  }

  @Get('knowledge/:messageId')
  knowledge(@CurrentUser() user: AuthUser, @Param('messageId') messageId: string) {
    return this.recs.knowledge(user.id, messageId);
  }

  @Post('feedback')
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(RecommendationFeedbackSchema)) body: RecommendationFeedbackInput,
  ) {
    return this.recs.recordFeedback(user.id, workspaceId, body);
  }
}
