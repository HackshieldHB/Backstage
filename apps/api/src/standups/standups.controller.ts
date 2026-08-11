import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateStandupSchema,
  SubmitCheckinSchema,
  UpdateStandupSchema,
  type CreateStandupInput,
  type SubmitCheckinInput,
  type UpdateStandupInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StandupsService } from './standups.service';

@Controller()
export class StandupsController {
  constructor(private readonly standups: StandupsService) {}

  @Get('workspaces/:id/standups')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.standups.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/standups')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateStandupSchema)) body: CreateStandupInput,
  ) {
    return this.standups.create(user.id, workspaceId, body);
  }

  @Patch('standups/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateStandupSchema)) body: UpdateStandupInput,
  ) {
    return this.standups.update(user.id, id, body);
  }

  @Delete('standups/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.standups.remove(user.id, id);
  }

  @Get('standups/:id/prefill')
  prefill(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.standups.prefill(user.id, id);
  }

  @Get('standups/:id/responses')
  responses(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('date') date?: string,
  ) {
    return this.standups.responses(user.id, id, date);
  }

  @Post('standups/:id/checkin')
  checkin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SubmitCheckinSchema)) body: SubmitCheckinInput,
  ) {
    return this.standups.submitCheckin(user.id, id, body);
  }

  @Post('standups/:id/digest')
  digest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.standups.postDigest(user.id, id);
  }
}
