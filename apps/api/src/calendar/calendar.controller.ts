import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { CalendarLinkSchema, type CalendarLinkInput } from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CalendarService } from './calendar.service';

@Controller('me/calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.calendar.get(user.id);
  }

  @Put()
  set(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CalendarLinkSchema)) body: CalendarLinkInput) {
    return this.calendar.set(user.id, body.icsUrl);
  }

  @Delete()
  unlink(@CurrentUser() user: AuthUser) {
    return this.calendar.unlink(user.id);
  }

  @HttpCode(200)
  @Post('sync')
  async sync(@CurrentUser() user: AuthUser) {
    const link = await this.calendar.get(user.id);
    if (link.icsUrl) await this.calendar.syncUser(user.id, link.icsUrl);
    return this.calendar.get(user.id);
  }
}
