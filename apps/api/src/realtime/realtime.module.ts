import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { HuddleService } from './huddle.service';
import { HuddlePersistenceService } from './huddle-persistence.service';
import { HuddleMediaHooks } from './huddle-media-hooks';

@Global()
@Module({
  providers: [RealtimeGateway, RealtimeService, HuddleService, HuddlePersistenceService, HuddleMediaHooks],
  exports: [RealtimeService, HuddleService, HuddleMediaHooks],
})
export class RealtimeModule {}
