import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RunCommandSchema, type RunCommandInput, type SlashCommandDto } from '@backstages/shared';
import { AppRegistry } from './app-registry';
import { PolicyService } from '../authz/policy.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CustomCommandsService } from '../channel-integrations/channel-integrations.service';

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
    private readonly customCommands: CustomCommandsService,
  ) {}

  @Get('workspaces/:id/commands')
  async list(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    await this.policy.requireWorkspaceMember(user.id, workspaceId);
    const custom = await this.customCommands.catalogue(workspaceId);
    const customDtos: SlashCommandDto[] = custom.map((c) => ({
      name: c.trigger,
      usage: `/${c.trigger}`,
      description: c.description || 'Custom command',
      channelOnly: true,
    }));
    return [...this.registry.describeCommands(), ...customDtos];
  }

  @HttpCode(200)
  @Post('channels/:id/commands')
  async run(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(RunCommandSchema)) body: RunCommandInput,
  ) {
    const { channel } = await this.policy.requireChannelMember(user.id, channelId);
    const ctx = { userId: user.id, workspaceId: channel.workspaceId, channelId };
    const custom = await this.customCommands.tryRun(ctx, body.text);
    if (custom) return custom;
    return this.registry.run(ctx, body.text);
  }
}
