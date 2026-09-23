import { Controller, Get, Param, Query } from '@nestjs/common';
import { MeetingInsightsService } from './meeting-insights.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class MeetingInsightsController {
  constructor(private readonly insights: MeetingInsightsService) {}

  @Get('workspaces/:id/meeting-insights')
  forWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query('days') days?: string,
  ) {
    return this.insights.forWorkspace(user.id, workspaceId, days ? Number(days) : 7);
  }
}
