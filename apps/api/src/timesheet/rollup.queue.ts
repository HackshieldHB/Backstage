import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { UtilizationService } from './utilization.service';

const QUEUE_NAME = 'timesheet-rollup';

/** Nightly rollup of the previous day's activity into UtilizationDaily. */
@Injectable()
export class RollupQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RollupQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly utilization: UtilizationService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    // 01:15 daily — roll up the day that just ended.
    await this.queue.upsertJobScheduler('daily-utilization-rollup', { pattern: '15 1 * * *' });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
        const { rows } = await this.utilization.computeDaily(yesterday);
        this.logger.log(`Utilization rollup wrote ${rows} member-day row(s)`);
      },
      { connection },
    );
    this.logger.log('Utilization rollup scheduled (15 1 * * *)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
