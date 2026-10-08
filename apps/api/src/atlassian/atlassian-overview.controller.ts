import { Controller, Get, Param } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { AtlassianOverviewService } from './atlassian-overview.service';

@Controller()
export class AtlassianOverviewController {
  constructor(private readonly overview: AtlassianOverviewService) {}

  /** Live Atlassian figures for the Applications Hub. */
  @Get('workspaces/:id/applications/atlassian')
  get(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.overview.overview(user.id, workspaceId);
  }
}
