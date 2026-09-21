import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AskSchema, type AskInput, HuddleRecapSchema, type HuddleRecapInput } from '@backstages/shared';
import { AiService } from './ai.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status() {
    return { enabled: this.ai.enabled };
  }

  @Post('threads/:messageId/summarize')
  summarizeThread(@CurrentUser() user: AuthUser, @Param('messageId') messageId: string) {
    return this.ai.summarizeThread(user.id, messageId);
  }

  @Post('channels/:channelId/summarize')
  summarizeChannel(@CurrentUser() user: AuthUser, @Param('channelId') channelId: string) {
    return this.ai.summarizeChannel(user.id, channelId);
  }

  @Post('threads/:messageId/action-items')
  actionItems(@CurrentUser() user: AuthUser, @Param('messageId') messageId: string) {
    return this.ai.extractActionItems(user.id, messageId);
  }

  @Post('workspaces/:id/ask')
  ask(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(AskSchema)) body: AskInput,
  ) {
    return this.ai.ask(user.id, workspaceId, body.question);
  }

  @Post('workspaces/:id/huddle-recap')
  huddleRecap(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(HuddleRecapSchema)) body: HuddleRecapInput,
  ) {
    return this.ai.huddleRecap(user.id, workspaceId, body);
  }

  @Post('messages/:messageId/translate')
  translate(
    @CurrentUser() user: AuthUser,
    @Param('messageId') messageId: string,
    @Body() body: { targetLanguage: string },
  ) {
    return this.ai.translate(user.id, messageId, body.targetLanguage);
  }
}
