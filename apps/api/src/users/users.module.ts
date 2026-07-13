import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AttachmentsModule } from '../attachments/attachments.module';

@Module({
  imports: [AttachmentsModule], // provides StorageService for avatar uploads
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
