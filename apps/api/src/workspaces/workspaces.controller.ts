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
import { JoinService } from './join.service';
import { RateLimit } from '../common/rate-limit.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { HumanOnly } from '../common/human-only.decorator';

@Controller()
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly joins: JoinService,
  ) {}

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

  /** Workspaces open to my verified email domain ("anyone @acme.com can join"). */
  @HumanOnly()
  @Get('me/joinable-workspaces')
  joinable(@CurrentUser() user: AuthUser) {
    return this.joins.joinable(user.id);
  }

  @HumanOnly()
  @RateLimit({ limit: 20, windowSeconds: 60, bucket: 'workspace-join' })
  @HttpCode(200)
  @Post('workspaces/:id/join')
  join(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.joins.join(user.id, workspaceId);
  }

  @Get('workspaces/:id/join-requests')
  joinRequests(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.joins.requests(user.id, workspaceId);
  }

  @HttpCode(200)
  @Post('workspaces/:id/join-requests/:requestId/approve')
  approveJoin(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string, @Param('requestId') requestId: string) {
    return this.joins.decide(user.id, workspaceId, requestId, true);
  }

  @HttpCode(200)
  @Post('workspaces/:id/join-requests/:requestId/deny')
  denyJoin(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string, @Param('requestId') requestId: string) {
    return this.joins.decide(user.id, workspaceId, requestId, false);
  }

  /** Invitations addressed to my (verified) email — "Join an existing workspace". */
  @HumanOnly()
  @Get('me/invitations')
  myInvitations(@CurrentUser() user: AuthUser) {
    return this.workspaces.myInvitations(user.id);
  }

  @HumanOnly()
  @HttpCode(200)
  @Post('me/invitations/:inviteId/accept')
  acceptMyInvitation(@CurrentUser() user: AuthUser, @Param('inviteId') inviteId: string) {
    return this.workspaces.acceptMyInvitation(user.id, inviteId);
  }
}
