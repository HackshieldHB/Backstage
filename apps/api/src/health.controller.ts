import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './common/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { RedisClient } from './redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClient,
  ) {}

  @Public()
  @Get()
  async health() {
    const checks: Record<string, 'ok' | 'down'> = { database: 'down', redis: 'down' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      /* stays down */
    }
    try {
      if ((await this.redis.ping()) === 'PONG') checks.redis = 'ok';
    } catch {
      /* stays down */
    }

    if (checks.database !== 'ok' || checks.redis !== 'ok') {
      throw new ServiceUnavailableException({ message: 'Degraded', details: checks });
    }
    return { status: 'ok', checks };
  }
}
