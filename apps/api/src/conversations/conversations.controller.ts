import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CreateConversationInput, CreateConversationSchema } from '@backstages/shared';
import { ConversationsService } from './conversations.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @HttpCode(200)
  @Post('workspaces/:workspaceId/conversations')
  open(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body(new ZodValidationPipe(CreateConversationSchema)) body: CreateConversationInput,
  ) {
    return this.conversations.open(user.id, workspaceId, body);
  }

  @Get('workspaces/:workspaceId/conversations')
  listMine(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.conversations.listMine(user.id, workspaceId);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.get(user.id, id);
  }
}
