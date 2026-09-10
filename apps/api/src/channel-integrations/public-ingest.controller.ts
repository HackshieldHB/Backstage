import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  InboundEmailSchema,
  WebhookPayloadSchema,
  type InboundEmailInput,
  type WebhookPayload,
} from '@backstages/shared';
import { Public } from '../common/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChannelEmailService, WebhooksService } from './channel-integrations.service';

/** Public ingestion endpoints for external tools and mail providers. */
@Controller()
export class PublicIngestController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly email: ChannelEmailService,
  ) {}

  @Public()
  @RateLimit({ limit: 60, windowSeconds: 60, bucket: 'webhook-ingest' })
  @Post('hooks/:token')
  @HttpCode(202)
  webhook(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(WebhookPayloadSchema)) body: WebhookPayload,
  ) {
    return this.webhooks.ingest(token, body);
  }

  @Public()
  @RateLimit({ limit: 60, windowSeconds: 60, bucket: 'email-ingest' })
  @Post('inbound-email/:token')
  @HttpCode(202)
  inboundEmail(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(InboundEmailSchema)) body: InboundEmailInput,
  ) {
    return this.email.ingest(token, body);
  }
}
