import { Global, Module } from '@nestjs/common';
import { AtlassianApiService } from './atlassian-api.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianSyncService } from './sync.service';
import { AtlassianSyncQueue } from './sync.queue';
import { JiraEventsService } from './jira-events.service';
import { JiraActionsService } from './jira-actions.service';
import { AtlassianController } from './atlassian.controller';
import { MessagesModule } from '../messages/messages.module';
import { AuthModule } from '../auth/auth.module';
import { UNFURL_SERVICE } from '../messages/integration-messages.service';

@Global()
@Module({
  imports: [MessagesModule, AuthModule],
  controllers: [AtlassianController],
  providers: [
    AtlassianApiService,
    AtlassianService,
    AtlassianSyncService,
    AtlassianSyncQueue,
    JiraEventsService,
    JiraActionsService,
    // Message sends unfurl Jira/Confluence links through this hook.
    { provide: UNFURL_SERVICE, useExisting: JiraActionsService },
  ],
  exports: [AtlassianService, AtlassianSyncService, UNFURL_SERVICE],
})
export class AtlassianModule {}
