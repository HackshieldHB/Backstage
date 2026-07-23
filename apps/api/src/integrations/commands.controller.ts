import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RunCommandSchema, type RunCommandInput } from '@backstages/shared';
import { AppRegistry } from './app-registry';
import { PolicyService } from '../authz/policy.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/**
 * Slash commands. The catalogue is served so clients can offer help and
 * autocomplete instead of hardcoding what exists, and execution happens here
 * rather than in the composer.
 */
@Controller()
export class CommandsController {
  constructor(
    private readonly registry: AppRegistry,
    private readonly policy: PolicyService,
  ) {}

  @Get('workspaces/:id/commands')
  async list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    await this.policy.requireWorkspaceMember(user.id, workspaceId);
    return this.registry.describeCommands();
  }

  @HttpCode(200)
  @Post('channels/:id/commands')
  async run(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(RunCommandSchema)) body: RunCommandInput,
  ) {
    const { channel } = await this.policy.requireChannelMember(user.id, channelId);
    return this.registry.run(
      { userId: user.id, workspaceId: channel.workspaceId, channelId },
      body.text,
    );
  }
}
