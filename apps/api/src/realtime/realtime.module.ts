import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { HuddleService } from './huddle.service';

@Global()
@Module({
  providers: [RealtimeGateway, RealtimeService, HuddleService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
