import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelSharesController } from './channel-shares.controller';
import { ChannelSharesService } from './channel-shares.service';

@Module({
  controllers: [ChannelsController, ChannelSharesController],
  providers: [ChannelsService, ChannelSharesService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
