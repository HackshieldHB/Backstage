import { Logger, Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { DiskStorageService, StorageService } from '../storage/storage.service';
import { S3StorageService } from '../storage/s3-storage.service';

/**
 * Picks the storage adapter from the environment. Resolved in a factory (not at
 * import time) so the choice follows the environment the app actually boots
 * with, and stays testable.
 */
export function createStorageService(): StorageService {
  const logger = new Logger('AttachmentsModule');
  if (process.env.STORAGE_DRIVER === 's3') {
    // Construct first: the log must not claim a bucket that failed validation.
    const service = new S3StorageService();
    logger.log(`Attachments stored in S3 bucket ${process.env.S3_BUCKET}`);
    return service;
  }
  if (process.env.NODE_ENV === 'production') {
    // Local disk is per-instance and wiped by redeploys, while the Socket.IO
    // layer already runs multi-instance behind the Redis adapter.
    logger.warn(
      'STORAGE_DRIVER is not "s3" — attachments go to local disk and will be lost on redeploy ' +
        'and invisible to other instances.',
    );
  }
  return new DiskStorageService();
}

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, { provide: StorageService, useFactory: createStorageService }],
  exports: [AttachmentsService, StorageService],
})
export class AttachmentsModule {}
