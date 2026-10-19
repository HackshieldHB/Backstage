import { Controller, Get, Header } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { IceService } from './ice.service';

@Controller('huddles')
export class IceController {
  constructor(private readonly ice: IceService) {}

  /** STUN/TURN servers with short-lived credentials for the caller's huddle peers. */
  @Get('ice-servers')
  @Header('Cache-Control', 'no-store')
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'ice-servers' })
  iceServers(@CurrentUser() user: AuthUser) {
    return this.ice.forUser(user.id);
  }
}
