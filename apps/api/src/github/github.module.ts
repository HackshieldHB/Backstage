import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { AuthModule } from '../auth/auth.module';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { GithubEventsService } from './github-events.service';

@Module({
  imports: [MessagesModule, AuthModule],
  controllers: [GithubController],
  providers: [GithubService, GithubEventsService],
})
export class GithubModule {}
