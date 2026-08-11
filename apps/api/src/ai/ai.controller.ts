import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

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

  @Post('messages/:messageId/translate')
  translate(
    @CurrentUser() user: AuthUser,
    @Param('messageId') messageId: string,
    @Body() body: { targetLanguage: string },
  ) {
    return this.ai.translate(user.id, messageId, body.targetLanguage);
  }
}
