import { Global, Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { ChannelIntegrationsController } from './channel-integrations.controller';
import { PublicIngestController } from './public-ingest.controller';
import {
  ChannelEmailService,
  CustomCommandsService,
  WebhooksService,
} from './channel-integrations.service';

/**
 * Channel integration glue: incoming webhooks, workspace-defined slash commands,
 * and email-to-channel. Global so CommandsController can consult
 * CustomCommandsService without an import cycle.
 */
@Global()
@Module({
  imports: [MessagesModule],
  controllers: [ChannelIntegrationsController, PublicIngestController],
  providers: [WebhooksService, CustomCommandsService, ChannelEmailService],
  exports: [WebhooksService, CustomCommandsService, ChannelEmailService],
})
export class ChannelIntegrationsModule {}
