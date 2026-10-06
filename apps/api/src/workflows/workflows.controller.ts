import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { WorkflowInputSchema, type WorkflowInput } from '@backstages/shared';
import { WorkflowsService } from './workflows.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const SetEnabledSchema = z.object({ enabled: z.boolean() });

@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

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
}
