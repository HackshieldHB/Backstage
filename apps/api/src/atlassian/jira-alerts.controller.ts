import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateJiraAlertSchema, type CreateJiraAlertInput } from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JiraAlertsService } from './jira-alerts.service';

@Controller()
export class JiraAlertsController {
  constructor(private readonly alerts: JiraAlertsService) {}

  @Get('workspaces/:id/atlassian/alerts')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.alerts.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/atlassian/alerts')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateJiraAlertSchema)) body: CreateJiraAlertInput,
  ) {
    return this.alerts.create(user.id, workspaceId, body);
  }

  @Delete('atlassian/alerts/:alertId')
  remove(@CurrentUser() user: AuthUser, @Param('alertId') alertId: string) {
    return this.alerts.remove(user.id, alertId);
  }

  @Post('atlassian/alerts/:alertId/run')
  run(@CurrentUser() user: AuthUser, @Param('alertId') alertId: string) {
    return this.alerts.runNow(user.id, alertId);
  }
}
