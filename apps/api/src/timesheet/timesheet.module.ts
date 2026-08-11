import { Global, Module } from '@nestjs/common';
import { TimesheetController } from './timesheet.controller';
import { TimesheetService } from './timesheet.service';
import { UtilizationService } from './utilization.service';
import { ActivityService } from './activity.service';
import { HuddleSessionService } from './huddle-session.service';
import { RollupQueue } from './rollup.queue';

/**
 * Timesheet + team-timeline feature. Global so the signal hooks scattered across
 * the app (realtime gateway, presence, Jira/Confluence events, messages) can
 * inject ActivityService / HuddleSessionService without import cycles.
 *
 * AtlassianService / AtlassianApiService are consumed directly (TimesheetService)
 * but NOT imported here: AtlassianModule is @Global, and importing it would form
 * a module cycle (Atlassian → Messages → ActivityService here).
 */
@Global()
@Module({
  controllers: [TimesheetController],
  providers: [
    TimesheetService,
    UtilizationService,
    ActivityService,
    HuddleSessionService,
    RollupQueue,
  ],
  exports: [ActivityService, HuddleSessionService],
})
export class TimesheetModule {}
