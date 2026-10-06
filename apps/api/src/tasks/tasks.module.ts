import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TasksQueue } from './tasks.queue';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksQueue],
  exports: [TasksService],
})
export class TasksModule {}
