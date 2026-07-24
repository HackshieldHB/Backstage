import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  EditMessageInput,
  EditMessageSchema,
  ListMessagesQuery,
  ListMessagesQuerySchema,
  MarkReadInput,
  MarkReadSchema,
  ScheduleMessageInput,
  ScheduleMessageSchema,
  SendMessageInput,
  SendMessageSchema,
  ToggleReactionInput,
  ToggleReactionSchema,
} from '@backstages/shared';
import { channelContainer, conversationContainer, MessagesService } from './messages.service';
import { RateLimit } from '../common/rate-limit.guard';

/** Spec: at most 10 messages per 10 seconds per user. */
const SEND_RATE_LIMIT = { limit: 10, windowSeconds: 10, bucket: 'messages' };
import { UnreadService } from './unread.service';
import { CatchUpService } from './catch-up.service';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly unread: UnreadService,
    private readonly catchUpService: CatchUpService,
    private readonly scheduled: ScheduledMessagesService,
  ) {}

  // ----- channels -----

  @RateLimit(SEND_RATE_LIMIT)
  @Post('channels/:id/messages')
  sendToChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageInput,
  ) {
    return this.messages.send(user.id, channelContainer(channelId), body);
  }

  @Get('channels/:id/messages')
  listChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Query(new ZodValidationPipe(ListMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messages.list(user.id, channelContainer(channelId), query);
  }

  @HttpCode(200)
  @Post('channels/:id/read')
  markChannelRead(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(MarkReadSchema)) body: MarkReadInput,
  ) {
    return this.messages.markRead(user.id, channelContainer(channelId), body.messageId);
  }

  // ----- conversations -----

  @RateLimit(SEND_RATE_LIMIT)
  @Post('conversations/:id/messages')
  sendToConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageInput,
  ) {
    return this.messages.send(user.id, conversationContainer(conversationId), body);
  }

  @Get('conversations/:id/messages')
  listConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Query(new ZodValidationPipe(ListMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messages.list(user.id, conversationContainer(conversationId), query);
  }

  @HttpCode(200)
  @Post('conversations/:id/read')
  markConversationRead(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(MarkReadSchema)) body: MarkReadInput,
  ) {
    return this.messages.markRead(user.id, conversationContainer(conversationId), body.messageId);
  }

  // ----- messages -----

  @Get('messages/:id/thread')
  thread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.thread(user.id, id);
  }

  @Patch('messages/:id')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EditMessageSchema)) body: EditMessageInput,
  ) {
    return this.messages.edit(user.id, id, body);
  }

  @Delete('messages/:id')
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.delete(user.id, id);
  }

  @HttpCode(200)
  @Post('messages/:id/reactions')
  toggleReaction(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ToggleReactionSchema)) body: ToggleReactionInput,
  ) {
    return this.messages.toggleReaction(user.id, id, body);
  }

  // ----- unreads -----

  @Get('workspaces/:id/unreads')
  unreads(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.unread.workspaceUnreads(user.id, workspaceId);
  }

  @Get('workspaces/:id/catch-up')
  catchUp(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.catchUpService.catchUp(user.id, workspaceId);
  }

  // ----- scheduled messages / reminders -----

  @Post('channels/:id/scheduled')
  scheduleChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(ScheduleMessageSchema)) body: ScheduleMessageInput,
  ) {
    return this.scheduled.scheduleForChannel(user.id, channelId, body);
  }

  @Post('conversations/:id/scheduled')
  scheduleConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(ScheduleMessageSchema)) body: ScheduleMessageInput,
  ) {
    return this.scheduled.scheduleForConversation(user.id, conversationId, body);
  }

  @Get('workspaces/:id/scheduled')
  listScheduled(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.scheduled.listMine(user.id, workspaceId);
  }

  @Delete('scheduled/:id')
  cancelScheduled(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduled.cancel(user.id, id);
  }
}
