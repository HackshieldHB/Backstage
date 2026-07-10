import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES } from '@backstages/shared';
import { AttachmentsService } from './attachments.service';
import { verifyAttachmentSignature } from './attachment-url';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard';

@Controller()
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly jwtService: JwtService,
  ) {}

  @Post('workspaces/:workspaceId/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.attachments.upload(user.id, workspaceId, file);
  }

  /**
   * Download. Public route, but access requires EITHER a valid HMAC signature
   * (for <img>/browser loads) OR a Bearer token + container membership.
   */
  @Public()
  @Get('attachments/:id')
  async download(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    let attachment;
    if (exp && sig && verifyAttachmentSignature(id, exp, sig)) {
      attachment = await this.attachments.getForSignedDownload(id);
    } else {
      const header = res.req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token) throw new UnauthorizedException('Missing signature or access token');
      let payload: AccessTokenPayload;
      try {
        payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      } catch {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      attachment = await this.attachments.authorize(payload.sub, id);
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', attachment.sizeBytes);
    const disposition = download === '1' ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    );
    this.attachments.stream(attachment).pipe(res);
  }
}
