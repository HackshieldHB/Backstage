import { Module, forwardRef } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { MessagesModule } from '../messages/messages.module';

@Module({
  // forwardRef: MessagesModule triggers workflows, workflows post via
  // IntegrationMessagesService (exported by MessagesModule) — a deliberate cycle.
  imports: [forwardRef(() => MessagesModule)],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
