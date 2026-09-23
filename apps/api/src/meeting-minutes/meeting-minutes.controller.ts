import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { MeetingMinutesService } from './meeting-minutes.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class MeetingMinutesController {
  constructor(private readonly minutes: MeetingMinutesService) {}

  @Get('channels/:id/meeting-records')
  listChannel(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.minutes.listForChannel(user.id, channelId);
  }

  @Get('conversations/:id/meeting-records')
  listConversation(@CurrentUser() user: AuthUser, @Param('id') conversationId: string) {
    return this.minutes.listForConversation(user.id, conversationId);
  }

  @Get('meeting-records/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.minutes.get(user.id, id);
  }

  @Post('meeting-records/:id/minutes')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.minutes.generate(user.id, id);
  }

  @Post('meeting-records/:id/action-items/:index/decision')
  toDecision(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('index') index: string) {
    return this.minutes.actionItemToDecision(user.id, id, Number(index));
  }

  @Delete('meeting-records/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.minutes.remove(user.id, id);
  }
}
