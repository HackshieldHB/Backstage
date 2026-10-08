import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  RespondToWorkflowRequestSchema,
  WorkflowInputSchema,
  type RespondToWorkflowRequestInput,
  type WorkflowInput,
} from '@backstages/shared';
import { WorkflowsService } from './workflows.service';
import { WorkflowRunsService } from './workflow-runs.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const SetEnabledSchema = z.object({ enabled: z.boolean() });

@Controller()
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly runs: WorkflowRunsService,
  ) {}

  @Get('workspaces/:workspaceId/workflows')
  list(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.workflows.list(user.id, workspaceId);
  }

  @Post('workspaces/:workspaceId/workflows')
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body(new ZodValidationPipe(WorkflowInputSchema)) body: WorkflowInput,
  ) {
    return this.workflows.create(user.id, workspaceId, body);
  }

  @Put('workflows/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WorkflowInputSchema)) body: WorkflowInput,
  ) {
    return this.workflows.update(user.id, id, body);
  }

  @Patch('workflows/:id')
  setEnabled(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetEnabledSchema)) body: { enabled: boolean },
  ) {
    return this.workflows.setEnabled(user.id, id, body.enabled);
  }

  @Delete('workflows/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflows.remove(user.id, id);
  }

  /** Latest runs of a workflow with per-step outcomes (admins only). */
  @Get('workflows/:id/runs')
  runsOf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.runs.listRuns(user.id, id);
  }

  /** Approvals and forms waiting on the caller. */
  @Get('workspaces/:workspaceId/workflow-requests')
  requests(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.runs.listRequests(user.id, workspaceId);
  }

  @HttpCode(200)
  @Post('workflow-runs/:id/respond')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RespondToWorkflowRequestSchema))
    body: RespondToWorkflowRequestInput,
  ) {
    return this.runs.respond(user.id, id, body);
  }
}
