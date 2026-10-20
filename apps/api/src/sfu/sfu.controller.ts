import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { SfuService } from './sfu.service';
import { SfuRecordingService, parseEgressInfo } from './sfu-recording.service';
import { livekitConfig, verifyLivekitWebhook } from './livekit-api';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';

@Controller()
export class SfuController {
  constructor(
    private readonly sfu: SfuService,
    private readonly recording: SfuRecordingService,
  ) {}

  /** Clients check this to decide between the SFU and the peer-to-peer mesh. */
  @Get('huddles/sfu/status')
  status() {
    return this.sfu.status();
  }

  @Post('huddles/sfu/token')
  token(@CurrentUser() user: AuthUser, @Body() body: { channelId?: string; conversationId?: string }) {
    return this.sfu.tokenFor(user.id, body);
  }

  /**
   * LiveKit server webhooks (configure `webhook.urls` in livekit.yaml). Signed
   * with our API secret; used to re-check every connection and to finish
   * server recordings.
   */
  @Public()
  @Post('webhooks/livekit')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('authorization') authorization: string | undefined) {
    const cfg = livekitConfig();
    if (!cfg) throw new ServiceUnavailableException('SFU is not configured');
    const raw = req.rawBody;
    if (!raw || !verifyLivekitWebhook(cfg, raw, authorization)) throw new ForbiddenException('Bad signature');
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    } catch {
      return { ok: true };
    }
    if (event.event === 'participant_joined') {
      const room = (event.room as { name?: string } | undefined)?.name;
      const identity = (event.participant as { identity?: string } | undefined)?.identity;
      if (room && identity) await this.sfu.checkJoin(room, identity);
    } else if (event.event === 'egress_ended') {
      const info = parseEgressInfo(event.egressInfo ?? event.egress_info);
      if (info) await this.recording.finish(info);
    }
    return { ok: true };
  }
}
