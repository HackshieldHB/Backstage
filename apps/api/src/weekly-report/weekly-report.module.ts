import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { AiModule } from '../ai/ai.module';
import { WeeklyReportController } from './weekly-report.controller';
import { WeeklyReportService } from './weekly-report.service';
import { WeeklyReportQueue } from './weekly-report.queue';

@Module({
  imports: [MessagesModule, AiModule],
  controllers: [WeeklyReportController],
  providers: [WeeklyReportService, WeeklyReportQueue],
})
export class WeeklyReportModule {}
