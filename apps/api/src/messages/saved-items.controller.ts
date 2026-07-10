import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SavedItemsService } from './saved-items.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class SavedItemsController {
  constructor(private readonly savedItems: SavedItemsService) {}

  @HttpCode(200)
  @Post('messages/:id/pin')
  pin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.savedItems.pin(user.id, id);
  }

  @Delete('messages/:id/pin')
  unpin(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.savedItems.unpin(user.id, id);
  }

  @Get('channels/:id/pins')
  channelPins(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.savedItems.channelPins(user.id, id);
  }

  @HttpCode(200)
  @Post('messages/:id/save')
  save(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.savedItems.save(user.id, id);
  }

  @Delete('messages/:id/save')
  unsave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.savedItems.unsave(user.id, id);
  }

  @Get('workspaces/:id/saved')
  listSaved(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.savedItems.listSaved(user.id, workspaceId);
  }
}
