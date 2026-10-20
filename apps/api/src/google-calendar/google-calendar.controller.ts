import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  GoogleCalendarConfirmInput,
  GoogleCalendarConfirmSchema,
  UpdateGoogleCalendarInput,
  UpdateGoogleCalendarSchema,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { HumanOnly } from '../common/human-only.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GoogleCalendarService } from './google-calendar.service';

@Controller('me/google-calendar')
export class GoogleCalendarController {
  constructor(private readonly google: GoogleCalendarService) {}

  @HumanOnly()
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.google.status(user.id);
  }

  @HumanOnly()
  @RateLimit({ limit: 10, windowSeconds: 60, bucket: 'gcal-connect' })
  @HttpCode(200)
  @Post('connect')
  connect(@CurrentUser() user: AuthUser) {
    return this.google.startConnect(user.id);
  }

  @HumanOnly()
  @HttpCode(200)
  @Post('connect/confirm')
  confirm(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(GoogleCalendarConfirmSchema)) body: GoogleCalendarConfirmInput) {
    return this.google.confirmConnect(user.id, body.code);
  }

  @HumanOnly()
  @Put()
  update(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(UpdateGoogleCalendarSchema)) body: UpdateGoogleCalendarInput) {
    return this.google.setPush(user.id, body.pushMeetings);
  }

  @HumanOnly()
  @Delete()
  disconnect(@CurrentUser() user: AuthUser) {
    return this.google.disconnect(user.id);
  }
}
