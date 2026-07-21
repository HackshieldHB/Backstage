import { Global, Module } from '@nestjs/common';
import { AtlassianApiService } from './atlassian-api.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianSyncService } from './sync.service';
import { AtlassianSyncQueue } from './sync.queue';
import { JiraEventsService } from './jira-events.service';
import { JiraActionsService } from './jira-actions.service';
import { StandupService } from './standup.service';
import { IncidentService } from './incident.service';
import { ChannelsModule } from '../channels/channels.module';
import { StandupQueue } from './standup.queue';
import { ConfluenceApiService } from './confluence-api.service';
import { ConfluenceService } from './confluence.service';
import { AtlassianController } from './atlassian.controller';
import { ConfluenceController } from './confluence.controller';
import { MessagesModule } from '../messages/messages.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [MessagesModule, AuthModule, ChannelsModule],
  controllers: [AtlassianController, ConfluenceController],
  providers: [
    AtlassianApiService,
    AtlassianService,
    AtlassianSyncService,
    AtlassianSyncQueue,
    JiraEventsService,
    // Registers itself as the 'jira' app with the AppRegistry on init.
    JiraActionsService,
    StandupService,
    StandupQueue,
    IncidentService,
    ConfluenceApiService,
    ConfluenceService,
  ],
  exports: [AtlassianService, AtlassianSyncService],
})
export class AtlassianModule {}
