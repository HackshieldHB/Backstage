import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LogTimeSchema } from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { TimesheetService } from './timesheet.service';
import { UtilizationService } from './utilization.service';

/** Default window when the client omits from/to: the last 24 hours. */
const DEFAULT_WINDOW_MS = 24 * 3600 * 1000;

function parseRange(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - DEFAULT_WINDOW_MS);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new BadRequestException('Invalid from/to date');
  }
  if (fromDate >= toDate) throw new BadRequestException('`from` must be before `to`');
  // Cap the window to 31 days to keep the resolver bounded.
  if (toDate.getTime() - fromDate.getTime() > 31 * DEFAULT_WINDOW_MS) {
    throw new BadRequestException('Window too large (max 31 days)');
  }
  return { from: fromDate, to: toDate };
}

@Controller()
export class TimesheetController {
  constructor(
    private readonly timesheet: TimesheetService,
    private readonly utilization: UtilizationService,
  ) {}

  // ---------- timesheet (per-user Jira worklog) ----------

  @Post('workspaces/:workspaceId/timesheet/entries')
  logTime(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
  ) {
    const input = LogTimeSchema.parse(body);
    return this.timesheet.logTime(user.id, workspaceId, input);
  }

  @Get('workspaces/:workspaceId/timesheet/entries')
  listEntries(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = from || to ? parseRange(from, to) : {};
    return this.timesheet.listEntries(user.id, workspaceId, range);
  }

  @Post('timesheet/entries/:entryId/sync')
  sync(@CurrentUser() user: AuthUser, @Param('entryId') entryId: string) {
    return this.timesheet.sync(user.id, entryId);
  }

  // ---------- team timeline + utilization (transparent to all members) ----------

  @Get('workspaces/:workspaceId/timeline')
  timeline(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { from: f, to: t } = parseRange(from, to);
    return this.utilization.timeline(user.id, workspaceId, f, t);
  }

  @Get('workspaces/:workspaceId/utilization')
  getUtilization(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { from: f, to: t } = parseRange(from, to);
    return this.utilization.utilization(user.id, workspaceId, f, t);
  }
}
