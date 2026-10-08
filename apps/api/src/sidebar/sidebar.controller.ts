import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  CreateChannelBookmarkSchema,
  CreateSidebarSectionSchema,
  SetSidebarSectionSchema,
  UpdateSidebarSectionSchema,
  type CreateChannelBookmarkInput,
  type CreateSidebarSectionInput,
  type SetSidebarSectionInput,
  type UpdateSidebarSectionInput,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SidebarService } from './sidebar.service';

@Controller()
export class SidebarController {
  constructor(private readonly sidebar: SidebarService) {}

  @Get('workspaces/:id/sidebar-sections')
  listSections(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.sidebar.listSections(user.id, workspaceId);
  }

  @Post('workspaces/:id/sidebar-sections')
  createSection(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateSidebarSectionSchema)) body: CreateSidebarSectionInput,
  ) {
    return this.sidebar.createSection(user.id, workspaceId, body.name);
  }

  @Patch('sidebar-sections/:id')
  updateSection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSidebarSectionSchema)) body: UpdateSidebarSectionInput,
  ) {
    return this.sidebar.updateSection(user.id, id, body);
  }

  @Delete('sidebar-sections/:id')
  deleteSection(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sidebar.deleteSection(user.id, id);
  }

  @Put('channels/:id/section')
  setChannelSection(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(SetSidebarSectionSchema)) body: SetSidebarSectionInput,
  ) {
    return this.sidebar.setChannelSection(user.id, channelId, body.sectionId);
  }

  @Put('conversations/:id/section')
  setConversationSection(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(SetSidebarSectionSchema)) body: SetSidebarSectionInput,
  ) {
    return this.sidebar.setConversationSection(user.id, conversationId, body.sectionId);
  }

  @Get('channels/:id/bookmarks')
  listBookmarks(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.sidebar.listBookmarks(user.id, channelId);
  }

  @Post('channels/:id/bookmarks')
  addBookmark(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(CreateChannelBookmarkSchema)) body: CreateChannelBookmarkInput,
  ) {
    return this.sidebar.addBookmark(user.id, channelId, body);
  }

  @Delete('bookmarks/:id')
  removeBookmark(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sidebar.removeBookmark(user.id, id);
  }
}
