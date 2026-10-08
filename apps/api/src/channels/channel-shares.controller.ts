import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AcceptChannelShareSchema, type AcceptChannelShareInput } from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { HumanOnly } from '../common/human-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChannelSharesService } from './channel-shares.service';

/** Sharing a channel with another workspace. Opening the workspace boundary needs a person, not a token. */
@Controller()
export class ChannelSharesController {
  constructor(private readonly shares: ChannelSharesService) {}

  @HumanOnly()
  @Post('channels/:id/shares')
  createInvite(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.shares.createInvite(user.id, channelId);
  }

  @Get('channels/:id/shares')
  list(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.shares.listForChannel(user.id, channelId);
  }

  @HumanOnly()
  @HttpCode(200)
  @Post('workspaces/:id/shared-channels/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(AcceptChannelShareSchema)) body: AcceptChannelShareInput,
  ) {
    return this.shares.accept(user.id, workspaceId, body.token);
  }

  @Get('workspaces/:id/shared-channels')
  incoming(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.shares.listIncoming(user.id, workspaceId);
  }

  @HttpCode(200)
  @Post('shared-channels/:shareId/join')
  join(@CurrentUser() user: AuthUser, @Param('shareId') shareId: string) {
    return this.shares.join(user.id, shareId);
  }

  @HumanOnly()
  @Delete('channel-shares/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') shareId: string) {
    return this.shares.revoke(user.id, shareId);
  }
}
