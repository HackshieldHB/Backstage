import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

/** Shared app-level Redis client (presence, queues use their own connections). */
@Injectable()
export class RedisClient extends Redis implements OnApplicationShutdown {
  constructor() {
    super(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  async onApplicationShutdown() {
    await this.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [RedisClient],
  exports: [RedisClient],
})
export class RedisModule {}
