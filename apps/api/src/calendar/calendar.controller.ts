import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
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

  /** My own Google/ICS events in [from, to) (max 31 days) for the calendar view. */
  @Get('events')
  events(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const start = new Date(from ?? '');
    const end = new Date(to ?? '');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException('Invalid range');
    }
    if (end.getTime() - start.getTime() > 31 * 24 * 3600_000) throw new BadRequestException('Range too long (max 31 days)');
    return this.calendar.myEvents(user.id, start, end);
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
