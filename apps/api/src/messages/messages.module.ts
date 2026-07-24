import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { UnreadService } from './unread.service';
import { CatchUpService } from './catch-up.service';
import { SavedItemsController } from './saved-items.controller';
import { SavedItemsService } from './saved-items.service';
import { IntegrationMessagesService } from './integration-messages.service';

@Module({
  controllers: [MessagesController, SavedItemsController],
  providers: [MessagesService, UnreadService, CatchUpService, SavedItemsService, IntegrationMessagesService],
  exports: [MessagesService, UnreadService, IntegrationMessagesService],
})
export class MessagesModule {}
