import { Module } from '@nestjs/common';
import { ScheduledHuddlesController } from './scheduled-huddles.controller';
import { ScheduledHuddlesService } from './scheduled-huddles.service';
import { ScheduledHuddlesQueue } from './scheduled-huddles.queue';

@Module({
  controllers: [ScheduledHuddlesController],
  providers: [ScheduledHuddlesService, ScheduledHuddlesQueue],
  exports: [ScheduledHuddlesService],
})
export class ScheduledHuddlesModule {}
