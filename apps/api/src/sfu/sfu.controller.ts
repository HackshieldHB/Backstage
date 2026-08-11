import { Body, Controller, Get, Post } from '@nestjs/common';
import { SfuService } from './sfu.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller('huddles/sfu')
export class SfuController {
  constructor(private readonly sfu: SfuService) {}

  /** Clients check this to decide between the SFU and the peer-to-peer mesh. */
  @Get('status')
  status() {
    return { enabled: this.sfu.enabled };
  }

  @Post('token')
  token(
    @CurrentUser() user: AuthUser,
    @Body() body: { channelId?: string; conversationId?: string },
  ) {
    return this.sfu.tokenFor(user.id, body);
  }
}
