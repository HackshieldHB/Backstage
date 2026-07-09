import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { UnreadService } from './unread.service';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService, UnreadService],
  exports: [MessagesService, UnreadService],
})
export class MessagesModule {}
