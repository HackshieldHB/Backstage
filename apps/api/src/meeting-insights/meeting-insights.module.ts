import { Module } from '@nestjs/common';
import { MeetingInsightsController } from './meeting-insights.controller';
import { MeetingInsightsService } from './meeting-insights.service';

@Module({
  controllers: [MeetingInsightsController],
  providers: [MeetingInsightsService],
  exports: [MeetingInsightsService],
})
export class MeetingInsightsModule {}
