import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { ScheduledHuddlesModule } from '../scheduled-huddles/scheduled-huddles.module';
import { CalendarSharingController } from './calendar-sharing.controller';
import { CalendarSharingService } from './calendar-sharing.service';

@Module({
  imports: [CalendarModule, ScheduledHuddlesModule],
  controllers: [CalendarSharingController],
  providers: [CalendarSharingService],
})
export class CalendarSharingModule {}
