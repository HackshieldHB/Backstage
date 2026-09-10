import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { DigestOptInSchema, type DigestOptInInput } from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DigestService } from './digest.service';

@Controller()
export class DigestController {
  constructor(private readonly digest: DigestService) {}

  @Get('workspaces/:id/digest')
  pref(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.digest.pref(user.id, workspaceId);
  }

  @Patch('workspaces/:id/digest/opt-in')
  optIn(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(DigestOptInSchema)) body: DigestOptInInput,
  ) {
    return this.digest.setOptIn(user.id, workspaceId, body.optIn, body.tzOffsetMin);
  }
}
