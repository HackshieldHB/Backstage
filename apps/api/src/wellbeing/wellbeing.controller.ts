import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WellbeingService } from './wellbeing.service';

const OptInSchema = z.object({ optIn: z.boolean() });
type OptInInput = z.infer<typeof OptInSchema>;

@Controller()
export class WellbeingController {
  constructor(private readonly wellbeing: WellbeingService) {}

  @Get('workspaces/:id/wellbeing/me')
  me(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.wellbeing.me(user.id, workspaceId);
  }

  @Get('workspaces/:id/wellbeing/team')
  team(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.wellbeing.team(user.id, workspaceId);
  }

  @Patch('workspaces/:id/wellbeing/opt-in')
  optIn(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(OptInSchema)) body: OptInInput,
  ) {
    return this.wellbeing.setOptIn(user.id, workspaceId, body.optIn);
  }
}
