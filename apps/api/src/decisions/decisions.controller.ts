import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  AssignDecisionSchema,
  CreateDecisionSchema,
  DecideSchema,
  type AssignDecisionInput,
  type CreateDecisionInput,
  type DecideInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DecisionsService } from './decisions.service';

@Controller()
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Get('workspaces/:id/decisions')
  list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.decisions.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/decisions')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateDecisionSchema)) body: CreateDecisionInput,
  ) {
    return this.decisions.create(user.id, workspaceId, body);
  }

  @Post('decisions/:id/decide')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecideSchema)) body: DecideInput,
  ) {
    return this.decisions.decide(user.id, id, body);
  }

  @Patch('decisions/:id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AssignDecisionSchema)) body: AssignDecisionInput,
  ) {
    return this.decisions.assign(user.id, id, body);
  }

  @Delete('decisions/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.decisions.remove(user.id, id);
  }
}
