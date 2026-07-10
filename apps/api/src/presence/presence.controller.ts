import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UpdatePresenceInput, UpdatePresenceSchema } from '@backstages/shared';
import { PresenceService } from './presence.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get('workspaces/:workspaceId/presence')
  workspacePresence(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.presence.workspacePresence(user.id, workspaceId);
  }

  @Patch('me/presence')
  async setPresence(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdatePresenceSchema)) body: UpdatePresenceInput,
  ) {
    const state = await this.presence.setManualState(user.id, body.state);
    return { state };
  }
}
