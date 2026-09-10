import { Module } from '@nestjs/common';
import { DigestController } from './digest.controller';
import { DigestService } from './digest.service';
import { DigestQueue } from './digest.queue';

@Module({
  controllers: [DigestController],
  providers: [DigestService, DigestQueue],
})
export class DigestModule {}
