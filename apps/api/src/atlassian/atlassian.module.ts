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
    // Registers itself as the 'jira' app with the AppRegistry on init.
    JiraActionsService,
  ],
  exports: [AtlassianService, AtlassianSyncService],
})
export class AtlassianModule {}
