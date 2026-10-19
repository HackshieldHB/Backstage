import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { HuddleService } from './huddle.service';
import { HuddlePersistenceService } from './huddle-persistence.service';

@Global()
@Module({
  providers: [RealtimeGateway, RealtimeService, HuddleService, HuddlePersistenceService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
