import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  CreateOncallShiftSchema,
  OpenIncidentSchema,
  IncidentUpdateSchema,
  type CreateOncallShiftInput,
  type OpenIncidentInput,
  type IncidentUpdateInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IncidentsService } from './incidents.service';

@Controller()
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get('workspaces/:id/incidents')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.incidents.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/incidents')
  declare(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(OpenIncidentSchema)) body: OpenIncidentInput,
  ) {
    return this.incidents.declare(user.id, workspaceId, body);
  }

  @Post('incidents/:incidentId/updates')
  addUpdate(
    @CurrentUser() user: AuthUser,
    @Param('incidentId') incidentId: string,
    @Body(new ZodValidationPipe(IncidentUpdateSchema)) body: IncidentUpdateInput,
  ) {
    return this.incidents.addUpdate(user.id, incidentId, body);
  }

  @Get('workspaces/:id/oncall')
  oncall(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.incidents.oncall(user.id, workspaceId);
  }

  @Post('workspaces/:id/oncall')
  createShift(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateOncallShiftSchema)) body: CreateOncallShiftInput,
  ) {
    return this.incidents.createShift(user.id, workspaceId, body);
  }

  @Delete('oncall/:shiftId')
  removeShift(@CurrentUser() user: AuthUser, @Param('shiftId') shiftId: string) {
    return this.incidents.removeShift(user.id, shiftId);
  }
}
