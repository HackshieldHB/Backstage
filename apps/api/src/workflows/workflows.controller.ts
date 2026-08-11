import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { WorkflowsService, type WorkflowInput } from './workflows.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

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
    @Body() body: WorkflowInput,
  ) {
    return this.workflows.create(user.id, workspaceId, body);
  }

  @Put('workflows/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: WorkflowInput) {
    return this.workflows.update(user.id, id, body);
  }

  @Delete('workflows/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflows.remove(user.id, id);
  }
}
