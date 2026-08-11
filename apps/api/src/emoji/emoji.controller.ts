import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { EmojiService } from './emoji.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';

@Controller()
export class EmojiController {
  constructor(private readonly emoji: EmojiService) {}

  @Get('workspaces/:workspaceId/emoji')
  list(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) {
    return this.emoji.list(user.id, workspaceId);
  }

  @Post('workspaces/:workspaceId/emoji')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 512 * 1024 } }))
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body('name') name: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!name) throw new BadRequestException('Emoji name is required');
    return this.emoji.create(user.id, workspaceId, name, file);
  }

  @Delete('workspaces/:workspaceId/emoji/:name')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('name') name: string,
  ) {
    return this.emoji.remove(user.id, workspaceId, name);
  }

  /** Public image route — the emoji is rendered directly in <img> tags. */
  @Public()
  @Get('emoji/:id')
  async serve(@Param('id') id: string, @Res() res: Response) {
    const emoji = await this.emoji.getForServe(id);
    res.setHeader('Content-Type', emoji.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    this.emoji.stream(emoji.storageKey).pipe(res);
  }
}
