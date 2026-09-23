import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ChannelsModule } from './channels/channels.module';
import { ConversationsModule } from './conversations/conversations.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagesModule } from './messages/messages.module';
import { RedisModule } from './redis/redis.module';
import { PresenceModule } from './presence/presence.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { EmojiModule } from './emoji/emoji.module';
import { ShareModule } from './share/share.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { SfuModule } from './sfu/sfu.module';
import { AuditModule } from './admin/audit.service';
import { AdminModule } from './admin/admin.module';
import { UserGroupsModule } from './user-groups/user-groups.module';
import { PollsModule } from './polls/polls.module';
import { CanvasModule } from './canvas/canvas.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AiModule } from './ai/ai.module';
import { PushModule } from './push/push.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { AtlassianModule } from './atlassian/atlassian.module';
import { TimesheetModule } from './timesheet/timesheet.module';
import { StandupsModule } from './standups/standups.module';
import { ChannelIntegrationsModule } from './channel-integrations/channel-integrations.module';
import { DecisionsModule } from './decisions/decisions.module';
import { WeeklyReportModule } from './weekly-report/weekly-report.module';
import { WellbeingModule } from './wellbeing/wellbeing.module';
import { DigestModule } from './digest/digest.module';
import { ProjectsModule } from './projects/projects.module';
import { IncidentsModule } from './incidents/incidents.module';
import { CalendarModule } from './calendar/calendar.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { GlobalExceptionFilter } from './common/http-exception.filter';
import { ObservabilityModule } from './observability/observability.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { ScheduledHuddlesModule } from './scheduled-huddles/scheduled-huddles.module';
import { RateLimitGuard } from './common/rate-limit.guard';

@Module({
  imports: [
    // First so its middleware wraps every downstream handler in a context.
    ObservabilityModule,
    PrismaModule,
    IntegrationsModule,
    EmailModule,
    AuthModule,
    AuthzModule,
    WorkspacesModule,
    ChannelsModule,
    ConversationsModule,
    RealtimeModule,
    NotificationsModule,
    MessagesModule,
    RedisModule,
    PresenceModule,
    AttachmentsModule,
    EmojiModule,
    ShareModule,
    WorkflowsModule,
    SfuModule,
    AuditModule,
    AdminModule,
    UserGroupsModule,
    PollsModule,
    CanvasModule,
    AnalyticsModule,
    AiModule,
    PushModule,
    SearchModule,
    UsersModule,
    AtlassianModule,
    TimesheetModule,
    StandupsModule,
    ChannelIntegrationsModule,
    DecisionsModule,
    WeeklyReportModule,
    WellbeingModule,
    DigestModule,
    ProjectsModule,
    IncidentsModule,
    CalendarModule,
    RecommendationsModule,
    ScheduledHuddlesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Runs after the (earlier-registered) JwtAuthGuard, so request.user is set.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
