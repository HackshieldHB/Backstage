import { Module } from '@nestjs/common';
import { ScheduledHuddlesController } from './scheduled-huddles.controller';
import { ScheduledHuddlesService } from './scheduled-huddles.service';
import { ScheduledHuddlesQueue } from './scheduled-huddles.queue';
import { MeetingHooks } from './meeting-hooks';

@Module({
  controllers: [ScheduledHuddlesController],
  providers: [ScheduledHuddlesService, ScheduledHuddlesQueue, MeetingHooks],
  exports: [ScheduledHuddlesService, MeetingHooks],
})
export class ScheduledHuddlesModule {}
