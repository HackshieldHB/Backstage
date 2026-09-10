import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  CreateJiraWidgetSchema,
  JIRA_BUCKETS,
  type CreateJiraWidgetInput,
  type JiraBucket,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DashboardService } from './dashboard.service';
import { JiraWidgetsService } from './jira-widgets.service';
import { JiraDashboardsService } from './jira-dashboards.service';

const scopeOf = (raw?: string): 'all' | 'me' => (raw === 'me' ? 'me' : 'all');

@Controller()
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly widgets: JiraWidgetsService,
    private readonly mirror: JiraDashboardsService,
  ) {}

  @Get('workspaces/:id/atlassian/jira-dashboards')
  jiraDashboards(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.mirror.list(user.id, workspaceId);
  }

  @Get('workspaces/:id/atlassian/jira-dashboards/:dashboardId')
  jiraDashboardView(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.mirror.view(user.id, workspaceId, dashboardId);
  }

  @Get('workspaces/:id/atlassian/dashboard')
  get(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string, @Query('scope') scope?: string) {
    return this.dashboard.get(user.id, workspaceId, scopeOf(scope));
  }

  @Get('workspaces/:id/atlassian/issues')
  issues(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query('bucket') bucket: string,
    @Query('scope') scope?: string,
  ) {
    if (!JIRA_BUCKETS.includes(bucket as JiraBucket)) throw new BadRequestException('Unknown bucket');
    return this.dashboard.bucketIssues(user.id, workspaceId, bucket as JiraBucket, scopeOf(scope));
  }

  @Get('workspaces/:id/atlassian/sprint')
  sprint(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.dashboard.sprint(user.id, workspaceId);
  }

  @Post('workspaces/:id/atlassian/widgets')
  createWidget(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateJiraWidgetSchema)) body: CreateJiraWidgetInput,
  ) {
    return this.widgets.create(user.id, workspaceId, body);
  }

  @Delete('atlassian/widgets/:widgetId')
  removeWidget(@CurrentUser() user: AuthUser, @Param('widgetId') widgetId: string) {
    return this.widgets.remove(user.id, widgetId);
  }
}
