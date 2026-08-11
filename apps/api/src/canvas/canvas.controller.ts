import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class CanvasController {
  constructor(private readonly canvas: CanvasService) {}

  @Get('channels/:id/canvas')
  get(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.canvas.get(user.id, channelId);
  }

  @Put('channels/:id/canvas')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body() body: { contentJson: unknown; contentText: string },
  ) {
    return this.canvas.update(user.id, channelId, body);
  }
}
