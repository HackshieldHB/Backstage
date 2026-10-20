import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  EmailPreferencesInput,
  EmailPreferencesSchema,
  EmailUnsubscribeInput,
  EmailUnsubscribeSchema,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MissedActivityService } from './missed-activity.service';

@Controller()
export class EmailPreferencesController {
  constructor(private readonly missed: MissedActivityService) {}

  @Get('me/email-preferences')
  get(@CurrentUser() user: AuthUser) {
    return this.missed.get(user.id);
  }

  @Put('me/email-preferences')
  set(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(EmailPreferencesSchema)) body: EmailPreferencesInput) {
    return this.missed.set(user.id, body.missedActivity);
  }

  /** The "turn these off" link in every missed-activity email. */
  @Public()
  @RateLimit({ limit: 20, windowSeconds: 60, bucket: 'email-unsub' })
  @HttpCode(200)
  @Post('email/unsubscribe')
  unsubscribe(@Body(new ZodValidationPipe(EmailUnsubscribeSchema)) body: EmailUnsubscribeInput) {
    return this.missed.unsubscribe(body.token);
  }
}
