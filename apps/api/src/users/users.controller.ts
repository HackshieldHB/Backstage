import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MarkNotificationsReadInput,
  MarkNotificationsReadSchema,
  MAX_UPLOAD_BYTES,
  UpdateProfileInput,
  UpdateProfileSchema,
  UpdateStatusInput,
  UpdateStatusSchema,
} from '@backstages/shared';
import { UsersService } from './users.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateStatusSchema)) body: UpdateStatusInput,
  ) {
    return this.users.updateStatus(user.id, body);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.users.updateProfile(user.id, body);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  setAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.users.setAvatar(user.id, file);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser, @Query('cursor') cursor?: string) {
    return this.users.listNotifications(user.id, cursor);
  }

  @HttpCode(200)
  @Post('notifications/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MarkNotificationsReadSchema)) body: MarkNotificationsReadInput,
  ) {
    return this.users.markNotificationsRead(user.id, body);
  }
}
