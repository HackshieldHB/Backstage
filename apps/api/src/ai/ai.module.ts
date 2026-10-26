import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { WebSearchService } from './web-search';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [MessagesModule],
  controllers: [AiController],
  providers: [AiService, WebSearchService],
  exports: [AiService],
})
export class AiModule {}
