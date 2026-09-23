import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ScheduleHuddleInput, ScheduleHuddleSchema } from '@backstages/shared';
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

  @Get('workspaces/:id/scheduled-huddles')
  listWorkspace(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.scheduled.listForWorkspace(user.id, workspaceId);
  }

  @Delete('scheduled-huddles/:id')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduled.cancel(user.id, id);
  }
}
