import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { DiskStorageService, StorageService } from '../storage/storage.service';

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, { provide: StorageService, useClass: DiskStorageService }],
  exports: [AttachmentsService, StorageService],
})
export class AttachmentsModule {}
