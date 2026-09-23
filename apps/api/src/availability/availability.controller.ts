import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { AvailabilityInput, AvailabilitySchema } from '@backstages/shared';
import { AvailabilityService } from './availability.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('workspaces/:id/availability')
  getMine(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.availability.getMine(user.id, workspaceId);
  }

  @Put('workspaces/:id/availability')
  setMine(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(AvailabilitySchema)) body: AvailabilityInput,
  ) {
    return this.availability.setMine(user.id, workspaceId, body);
  }
}
