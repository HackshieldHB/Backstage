import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { StandupsController } from './standups.controller';
import { StandupsService } from './standups.service';
import { StandupsQueue } from './standups.queue';

@Module({
  imports: [MessagesModule],
  controllers: [StandupsController],
  providers: [StandupsService, StandupsQueue],
  exports: [StandupsService],
})
export class StandupsModule {}
