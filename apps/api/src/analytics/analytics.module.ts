import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { FeedbackService } from './feedback.service';
import { UsageService } from './usage.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, FeedbackService, UsageService],
})
export class AnalyticsModule {}
