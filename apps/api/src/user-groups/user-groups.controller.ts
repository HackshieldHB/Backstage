import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { UserGroupsService } from './user-groups.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class UserGroupsController {
  constructor(private readonly groups: UserGroupsService) {}

  @Get('workspaces/:id/user-groups')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.groups.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/user-groups')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body() body: { name: string; handle: string; memberIds: string[] },
  ) {
    return this.groups.create(user.id, workspaceId, body);
  }

  @Put('user-groups/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { name?: string; memberIds?: string[] },
  ) {
    return this.groups.update(user.id, id, body);
  }

  @Delete('user-groups/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.remove(user.id, id);
  }
}
