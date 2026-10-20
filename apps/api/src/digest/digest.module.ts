import { Module } from '@nestjs/common';
import { DigestController } from './digest.controller';
import { DigestService } from './digest.service';
import { DigestQueue } from './digest.queue';
import { MissedActivityService } from './missed-activity.service';
import { EmailPreferencesController } from './email-preferences.controller';

@Module({
  controllers: [DigestController, EmailPreferencesController],
  providers: [DigestService, DigestQueue, MissedActivityService],
})
export class DigestModule {}
