import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateClientSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  type CreateClientInput,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('workspaces/:id/projects/overview')
  overview(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string, @Query('days') days?: string) {
    return this.projects.overview(user.id, workspaceId, Number(days) || 30);
  }

  @Post('workspaces/:id/clients')
  createClient(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateClientSchema)) body: CreateClientInput,
  ) {
    return this.projects.createClient(user.id, workspaceId, body);
  }

  @Delete('clients/:clientId')
  removeClient(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string) {
    return this.projects.removeClient(user.id, clientId);
  }

  @Post('workspaces/:id/projects')
  createProject(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateProjectSchema)) body: CreateProjectInput,
  ) {
    return this.projects.createProject(user.id, workspaceId, body);
  }

  @Patch('projects/:projectId')
  updateProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) body: UpdateProjectInput,
  ) {
    return this.projects.updateProject(user.id, projectId, body);
  }

  @Delete('projects/:projectId')
  removeProject(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.projects.removeProject(user.id, projectId);
  }
}
