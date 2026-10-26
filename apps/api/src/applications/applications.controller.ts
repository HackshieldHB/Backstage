import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ConnectApplicationSchema, type ConnectApplicationInput } from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@Controller()
export class ApplicationsController {
  constructor(private readonly apps: ApplicationsService) {}

  /** The catalog plus every application's live status for this workspace. */
  @Get('workspaces/:id/applications')
  overview(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.apps.overview(user.id, workspaceId);
  }

  @Get('workspaces/:id/applications/:appId/detail')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('appId') appId: string,
  ) {
    return this.apps.detail(user.id, workspaceId, appId);
  }

  /** Admins: connect or update (credentials are verified against the service first). */
  @Put('workspaces/:id/applications/:appId/connection')
  connect(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('appId') appId: string,
    @Body(new ZodValidationPipe(ConnectApplicationSchema)) body: ConnectApplicationInput,
  ) {
    return this.apps.connect(user.id, workspaceId, appId, body.fields);
  }

  @Delete('workspaces/:id/applications/:appId/connection')
  disconnect(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('appId') appId: string,
  ) {
    return this.apps.disconnect(user.id, workspaceId, appId);
  }
}
