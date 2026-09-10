import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarQueue } from './calendar.queue';

@Module({
  imports: [UsersModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarQueue],
})
export class CalendarModule {}
