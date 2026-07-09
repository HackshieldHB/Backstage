import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  AddChannelMemberInput,
  AddChannelMemberSchema,
  CreateChannelInput,
  CreateChannelSchema,
  UpdateChannelInput,
  UpdateChannelSchema,
} from '@backstages/shared';
import { ChannelsService } from './channels.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post('workspaces/:workspaceId/channels')
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body(new ZodValidationPipe(CreateChannelSchema)) body: CreateChannelInput,
  ) {
    return this.channels.create(user.id, workspaceId, body);
  }

  @Get('workspaces/:workspaceId/channels')
  listMine(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.channels.listMine(user.id, workspaceId);
  }

  @Get('workspaces/:workspaceId/channels/browse')
  browse(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.channels.browse(user.id, workspaceId);
  }

  @Get('channels/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.get(user.id, id);
  }

  @Patch('channels/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChannelSchema)) body: UpdateChannelInput,
  ) {
    return this.channels.update(user.id, id, body);
  }

  @HttpCode(200)
  @Post('channels/:id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.archive(user.id, id);
  }

  @HttpCode(200)
  @Post('channels/:id/unarchive')
  unarchive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.unarchive(user.id, id);
  }

  @Delete('channels/:id')
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.delete(user.id, id);
  }

  @HttpCode(200)
  @Post('channels/:id/join')
  join(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.join(user.id, id);
  }

  @HttpCode(200)
  @Post('channels/:id/leave')
  leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.leave(user.id, id);
  }

  @Get('channels/:id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.listMembers(user.id, id);
  }

  @Post('channels/:id/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddChannelMemberSchema)) body: AddChannelMemberInput,
  ) {
    return this.channels.addMember(user.id, id, body);
  }

  @Delete('channels/:id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.channels.removeMember(user.id, id, targetUserId);
  }
}
