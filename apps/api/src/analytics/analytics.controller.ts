import { Controller, Get, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('workspaces/:id/analytics')
  workspace(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.analytics.workspace(user.id, workspaceId);
  }
}
