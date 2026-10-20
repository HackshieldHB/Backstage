import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarQueue } from './calendar.queue';

@Module({
  imports: [UsersModule, GoogleCalendarModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarQueue],
  exports: [CalendarService],
})
export class CalendarModule {}
