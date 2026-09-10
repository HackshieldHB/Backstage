import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreateWeeklyReportSchema,
  UpdateWeeklyReportSchema,
  type CreateWeeklyReportInput,
  type UpdateWeeklyReportInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WeeklyReportService } from './weekly-report.service';

@Controller()
export class WeeklyReportController {
  constructor(private readonly reports: WeeklyReportService) {}

  @Get('workspaces/:id/weekly-reports')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.reports.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/weekly-reports')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateWeeklyReportSchema)) body: CreateWeeklyReportInput,
  ) {
    return this.reports.create(user.id, workspaceId, body);
  }

  @Patch('weekly-reports/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWeeklyReportSchema)) body: UpdateWeeklyReportInput,
  ) {
    return this.reports.update(user.id, id, body);
  }

  @Delete('weekly-reports/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.remove(user.id, id);
  }

  @Get('weekly-reports/:id/preview')
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.preview(user.id, id);
  }

  @Post('weekly-reports/:id/run')
  run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.runNow(user.id, id);
  }
}
