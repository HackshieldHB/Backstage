import { Body, Controller, Param, Post } from '@nestjs/common';
import { PollsService } from './polls.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Post('channels/:id/polls')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body() body: { question: string; options: string[]; allowMultiple?: boolean },
  ) {
    return this.polls.create(user.id, channelId, body);
  }

  @Post('polls/:id/vote')
  vote(
    @CurrentUser() user: AuthUser,
    @Param('id') pollId: string,
    @Body() body: { optionIndex: number },
  ) {
    return this.polls.vote(user.id, pollId, body.optionIndex);
  }
}
