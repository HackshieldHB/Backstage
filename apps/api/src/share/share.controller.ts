import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ShareService, type CreateShareInput } from './share.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';

@Controller()
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post('workspaces/:workspaceId/share')
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateShareInput,
  ) {
    return this.share.create(user.id, workspaceId, body);
  }

  @Get('channels/:channelId/share')
  listForChannel(@CurrentUser() user: AuthUser, @Param('channelId') channelId: string) {
    return this.share.listForChannel(user.id, channelId);
  }

  @Delete('share/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.share.revoke(user.id, id);
  }

  /** Public read-only snapshot behind an unguessable token. */
  @Public()
  @Get('share/:token')
  resolve(@Param('token') token: string) {
    return this.share.resolve(token);
  }
}
