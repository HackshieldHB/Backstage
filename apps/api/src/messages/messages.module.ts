import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { UnreadService } from './unread.service';
import { SavedItemsController } from './saved-items.controller';
import { SavedItemsService } from './saved-items.service';

@Module({
  controllers: [MessagesController, SavedItemsController],
  providers: [MessagesService, UnreadService, SavedItemsService],
  exports: [MessagesService, UnreadService],
})
export class MessagesModule {}
