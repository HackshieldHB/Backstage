import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { MyDayService } from './my-day.service';

@Controller()
export class MyDayController {
  constructor(private readonly myDay: MyDayService) {}

  /** `tz` = the caller's UTC offset in minutes (east positive); defaults to their saved one. */
  @Get('workspaces/:id/my-day')
  get(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string, @Query('tz') tz?: string) {
    return this.myDay.get(user.id, workspaceId, tz);
  }

  /** AI-suggested order for today's work (falls back to the standard order). */
  @HttpCode(200)
  @Post('workspaces/:id/my-day/plan')
  plan(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string, @Query('tz') tz?: string) {
    return this.myDay.plan(user.id, workspaceId, tz);
  }
}
