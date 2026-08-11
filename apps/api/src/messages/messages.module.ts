import { Module, forwardRef } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { UnreadService } from './unread.service';
import { CatchUpService } from './catch-up.service';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { ScheduledMessagesQueue } from './scheduled-messages.queue';
import { SavedItemsController } from './saved-items.controller';
import { SavedItemsService } from './saved-items.service';
import { IntegrationMessagesService } from './integration-messages.service';

@Module({
  imports: [forwardRef(() => WorkflowsModule)],
  controllers: [MessagesController, SavedItemsController],
  providers: [
    MessagesService,
    UnreadService,
    CatchUpService,
    ScheduledMessagesService,
    ScheduledMessagesQueue,
    SavedItemsService,
    IntegrationMessagesService,
  ],
  exports: [MessagesService, UnreadService, IntegrationMessagesService],
})
export class MessagesModule {}
