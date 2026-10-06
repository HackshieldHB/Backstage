import { Module, forwardRef } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowsQueue } from './workflows.queue';
import { MessagesModule } from '../messages/messages.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  // forwardRef: MessagesModule triggers workflows, workflows post via
  // IntegrationMessagesService (exported by MessagesModule) — a deliberate cycle.
  // Other producers reach the engine through the global WorkflowEvents bus.
  imports: [forwardRef(() => MessagesModule), ConversationsModule, TasksModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowsQueue],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
