import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreatePageFromThreadSchema,
  CreatePageSchema,
  UpdatePageSchema,
  type CreatePageFromThreadInput,
  type CreatePageInput,
  type UpdatePageInput,
} from '@backstages/shared';
import { ConfluenceService } from './confluence.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller()
export class ConfluenceController {
  constructor(private readonly confluence: ConfluenceService) {}

  @Get('workspaces/:id/confluence/spaces')
  spaces(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.confluence.listSpaces(user.id, workspaceId);
  }

  @Get('workspaces/:id/confluence/spaces/:spaceKey/pages')
  pages(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('spaceKey') spaceKey: string,
  ) {
    return this.confluence.listPages(user.id, workspaceId, spaceKey);
  }

  @Get('workspaces/:id/confluence/pages/:pageId')
  page(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.confluence.getPage(user.id, workspaceId, pageId);
  }

  @Post('workspaces/:id/confluence/pages')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreatePageSchema)) body: CreatePageInput,
  ) {
    return this.confluence.createPage(user.id, workspaceId, body);
  }

  @HttpCode(200)
  @Post('messages/:id/confluence-page')
  createFromThread(
    @CurrentUser() user: AuthUser,
    @Param('id') messageId: string,
    @Body(new ZodValidationPipe(CreatePageFromThreadSchema)) body: CreatePageFromThreadInput,
  ) {
    return this.confluence.createPageFromThread(user.id, messageId, body);
  }

  @Patch('workspaces/:id/confluence/pages/:pageId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('pageId') pageId: string,
    @Body(new ZodValidationPipe(UpdatePageSchema)) body: UpdatePageInput,
  ) {
    return this.confluence.updatePage(user.id, workspaceId, pageId, body);
  }

  @Delete('workspaces/:id/confluence/pages/:pageId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.confluence.deletePage(user.id, workspaceId, pageId);
  }
}
