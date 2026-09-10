import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  CreateCustomCommandSchema,
  CreateWebhookSchema,
  type CreateCustomCommandInput,
  type CreateWebhookInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChannelEmailService, CustomCommandsService, WebhooksService } from './channel-integrations.service';

@Controller()
export class ChannelIntegrationsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly commands: CustomCommandsService,
    private readonly email: ChannelEmailService,
  ) {}

  // webhooks
  @Get('workspaces/:id/webhooks')
  listWebhooks(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.webhooks.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/webhooks')
  createWebhook(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateWebhookSchema)) body: CreateWebhookInput,
  ) {
    return this.webhooks.create(user.id, workspaceId, body);
  }

  @Delete('webhooks/:id')
  removeWebhook(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.remove(user.id, id);
  }

  // custom commands
  @Get('workspaces/:id/custom-commands')
  listCommands(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.commands.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/custom-commands')
  createCommand(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateCustomCommandSchema)) body: CreateCustomCommandInput,
  ) {
    return this.commands.create(user.id, workspaceId, body);
  }

  @Delete('custom-commands/:id')
  removeCommand(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.commands.remove(user.id, id);
  }

  // email-to-channel
  @Get('channels/:id/email')
  channelEmail(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.email.ensure(user.id, channelId);
  }
}
