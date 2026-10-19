import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  RespondScheduledHuddleInput,
  RespondScheduledHuddleSchema,
  ScheduleHuddleInput,
  ScheduleHuddleSchema,
  UpdateScheduledHuddleInput,
  UpdateScheduledHuddleSchema,
} from '@backstages/shared';
import { ScheduledHuddlesService } from './scheduled-huddles.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class ScheduledHuddlesController {
  constructor(private readonly scheduled: ScheduledHuddlesService) {}

  @Post('channels/:id/scheduled-huddles')
  scheduleChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(ScheduleHuddleSchema)) body: ScheduleHuddleInput,
  ) {
    return this.scheduled.scheduleForChannel(user.id, channelId, body);
  }

  @Post('conversations/:id/scheduled-huddles')
  scheduleConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(ScheduleHuddleSchema)) body: ScheduleHuddleInput,
  ) {
    return this.scheduled.scheduleForConversation(user.id, conversationId, body);
  }

  @Get('channels/:id/scheduled-huddles')
  listChannel(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.scheduled.listForChannel(user.id, channelId);
  }

  @Get('conversations/:id/scheduled-huddles')
  listConversation(@CurrentUser() user: AuthUser, @Param('id') conversationId: string) {
    return this.scheduled.listForConversation(user.id, conversationId);
  }

  /** Upcoming meetings; with `from`/`to` (ISO) every meeting in that window. */
  @Get('workspaces/:id/scheduled-huddles')
  listWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.scheduled.listForWorkspace(user.id, workspaceId, { from, to });
  }

  @Get('scheduled-huddles/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduled.detail(user.id, id);
  }

  @Patch('scheduled-huddles/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateScheduledHuddleSchema)) body: UpdateScheduledHuddleInput,
  ) {
    return this.scheduled.update(user.id, id, body);
  }

  @Post('scheduled-huddles/:id/respond')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RespondScheduledHuddleSchema)) body: RespondScheduledHuddleInput,
  ) {
    return this.scheduled.respond(user.id, id, body.response);
  }

  /** `?scope=occurrence` skips only the next occurrence of a recurring meeting. */
  @Delete('scheduled-huddles/:id')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('scope') scope?: string) {
    return this.scheduled.cancel(user.id, id, scope === 'occurrence' ? 'occurrence' : 'series');
  }
}
