import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ScheduledHuddlesModule } from '../scheduled-huddles/scheduled-huddles.module';
import { CalendarModule } from '../calendar/calendar.module';
import { AvailabilityModule } from '../availability/availability.module';
import { AiModule } from '../ai/ai.module';
import { MyDayController } from './my-day.controller';
import { MyDayService } from './my-day.service';

@Module({
  imports: [
    TasksModule,
    WorkflowsModule,
    ScheduledHuddlesModule,
    CalendarModule,
    AvailabilityModule,
    AiModule,
  ],
  controllers: [MyDayController],
  providers: [MyDayService],
})
export class MyDayModule {}
