import { Global, Module } from '@nestjs/common';
import { AtlassianApiService } from './atlassian-api.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianSyncService } from './sync.service';
import { AtlassianSyncQueue } from './sync.queue';
import { JiraEventsService } from './jira-events.service';
import { JiraActionsService } from './jira-actions.service';
import { StandupService } from './standup.service';
import { IncidentService } from './incident.service';
import { BitbucketEventsService } from './bitbucket-events.service';
import { ChannelsModule } from '../channels/channels.module';
import { StandupQueue } from './standup.queue';
import { ConfluenceApiService } from './confluence-api.service';
import { ConfluenceService } from './confluence.service';
import { AtlassianController } from './atlassian.controller';
import { ConfluenceController } from './confluence.controller';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JiraWidgetsService } from './jira-widgets.service';
import { JiraDashboardsService } from './jira-dashboards.service';
import { JiraAlertsController } from './jira-alerts.controller';
import { JiraAlertsService } from './jira-alerts.service';
import { JiraAlertsQueue } from './jira-alerts.queue';
import { MessagesModule } from '../messages/messages.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [MessagesModule, AuthModule, ChannelsModule],
  controllers: [AtlassianController, ConfluenceController, DashboardController, JiraAlertsController],
  providers: [
    AtlassianApiService,
    AtlassianService,
    DashboardService,
    JiraWidgetsService,
    JiraDashboardsService,
    JiraAlertsService,
    JiraAlertsQueue,
    AtlassianSyncService,
    AtlassianSyncQueue,
    JiraEventsService,
    // Registers itself as the 'jira' app with the AppRegistry on init.
    JiraActionsService,
    StandupService,
    StandupQueue,
    IncidentService,
    BitbucketEventsService,
    ConfluenceApiService,
    ConfluenceService,
  ],
  exports: [AtlassianService, AtlassianSyncService, AtlassianApiService],
})
export class AtlassianModule {}
