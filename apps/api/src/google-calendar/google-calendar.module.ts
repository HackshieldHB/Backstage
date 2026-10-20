import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScheduledHuddlesModule } from '../scheduled-huddles/scheduled-huddles.module';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [AuthModule, ScheduledHuddlesModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
