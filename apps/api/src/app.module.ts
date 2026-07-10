import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ChannelsModule } from './channels/channels.module';
import { ConversationsModule } from './conversations/conversations.module';
import { RealtimeModule } from './realtime/realtime.module';
import { MessagesModule } from './messages/messages.module';
import { RedisModule } from './redis/redis.module';
import { PresenceModule } from './presence/presence.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { AtlassianModule } from './atlassian/atlassian.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { GlobalExceptionFilter } from './common/http-exception.filter';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    AuthModule,
    AuthzModule,
    WorkspacesModule,
    ChannelsModule,
    ConversationsModule,
    RealtimeModule,
    MessagesModule,
    RedisModule,
    PresenceModule,
    AttachmentsModule,
    SearchModule,
    UsersModule,
    AtlassianModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
