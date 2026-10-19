import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { CalendarSharingInput, CalendarSharingSchema } from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CalendarSharingService } from './calendar-sharing.service';

@Controller('workspaces/:id')
export class CalendarSharingController {
  constructor(private readonly sharing: CalendarSharingService) {}

  /** My calendar visibility in this workspace. */
  @Get('calendar-sharing')
  getMine(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.sharing.getMine(user.id, workspaceId);
  }

  @Put('calendar-sharing')
  setMine(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CalendarSharingSchema)) body: CalendarSharingInput,
  ) {
    return this.sharing.setMine(user.id, workspaceId, body.visibility);
  }

  /** Teammates who share their calendar. */
  @Get('shared-calendars')
  people(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.sharing.sharedPeople(user.id, workspaceId);
  }

  /** `?users=a,b&from=ISO&to=ISO` — up to 10 people, up to 31 days. */
  @Get('people-calendars')
  @RateLimit({ limit: 60, windowSeconds: 60, bucket: 'people-calendars' })
  calendars(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query('users') users: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    return this.sharing.calendars(user.id, workspaceId, String(users ?? '').split(','), { from, to });
  }
}
