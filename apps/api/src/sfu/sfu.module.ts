import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { MessagesModule } from '../messages/messages.module';
import { SfuController } from './sfu.controller';
import { SfuService } from './sfu.service';
import { SfuRecordingService } from './sfu-recording.service';

@Module({
  imports: [AttachmentsModule, MessagesModule],
  controllers: [SfuController],
  providers: [SfuService, SfuRecordingService],
})
export class SfuModule {}
