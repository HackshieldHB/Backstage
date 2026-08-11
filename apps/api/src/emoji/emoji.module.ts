import { Module } from '@nestjs/common';
import { EmojiController } from './emoji.controller';
import { EmojiService } from './emoji.service';
import { StorageService } from '../storage/storage.service';
import { createStorageService } from '../attachments/attachments.module';

@Module({
  controllers: [EmojiController],
  providers: [EmojiService, { provide: StorageService, useFactory: createStorageService }],
})
export class EmojiModule {}
