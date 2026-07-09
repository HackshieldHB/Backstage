import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  AcceptInviteInput,
  AcceptInviteSchema,
  CreateInviteInput,
  CreateInviteSchema,
  CreateWorkspaceInput,
  CreateWorkspaceSchema,
  UpdateMemberRoleInput,
  UpdateMemberRoleSchema,
  UpdateWorkspaceInput,
  UpdateWorkspaceSchema,
} from '@backstages/shared';
import { WorkspacesService } from './workspaces.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post('workspaces')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateWorkspaceSchema)) body: CreateWorkspaceInput,
  ) {
    return this.workspaces.create(user.id, body);
  }

  @Get('workspaces')
  listMine(@CurrentUser() user: AuthUser) {
    return this.workspaces.listMine(user.id);
  }

  @Get('workspaces/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.getById(user.id, id);
  }

  @Patch('workspaces/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkspaceSchema)) body: UpdateWorkspaceInput,
  ) {
    return this.workspaces.update(user.id, id, body);
  }

  @Get('workspaces/:id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.listMembers(user.id, id);
  }

  @Patch('workspaces/:id/members/:userId')
  updateMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body(new ZodValidationPipe(UpdateMemberRoleSchema)) body: UpdateMemberRoleInput,
  ) {
    return this.workspaces.updateMemberRole(user.id, id, targetUserId, body);
  }

  @Delete('workspaces/:id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.workspaces.removeMember(user.id, id, targetUserId);
  }

  @Post('workspaces/:id/invites')
  createInvite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateInviteSchema)) body: CreateInviteInput,
  ) {
    return this.workspaces.createInvite(user.id, id, body);
  }

  @Get('workspaces/:id/invites')
  listInvites(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.listInvites(user.id, id);
  }

  @Delete('workspaces/:id/invites/:inviteId')
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.workspaces.revokeInvite(user.id, id, inviteId);
  }

  @HttpCode(200)
  @Post('invites/accept')
  acceptInvite(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AcceptInviteSchema)) body: AcceptInviteInput,
  ) {
    return this.workspaces.acceptInvite(user.id, body.token);
  }
}
