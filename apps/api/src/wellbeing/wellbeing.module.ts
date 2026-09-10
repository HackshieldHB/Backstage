import { Module } from '@nestjs/common';
import { WellbeingController } from './wellbeing.controller';
import { WellbeingService } from './wellbeing.service';

@Module({
  controllers: [WellbeingController],
  providers: [WellbeingService],
})
export class WellbeingModule {}
