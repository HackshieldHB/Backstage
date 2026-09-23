import { Global, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DecisionsModule } from '../decisions/decisions.module';
import { MeetingMinutesController } from './meeting-minutes.controller';
import { MeetingMinutesService } from './meeting-minutes.service';

/** Global so the realtime gateway can persist a meeting when the room empties,
 *  without a module import cycle (mirrors TimesheetModule). */
@Global()
@Module({
  imports: [AiModule, DecisionsModule],
  controllers: [MeetingMinutesController],
  providers: [MeetingMinutesService],
  exports: [MeetingMinutesService],
})
export class MeetingMinutesModule {}
