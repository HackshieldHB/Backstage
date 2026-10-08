import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { DataGovernanceService } from './data-governance.service';

const QUEUE_NAME = 'retention';

/** Applies message-retention policies once an hour. */
@Injectable()
export class RetentionQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly governance: DataGovernanceService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests call sweep directly
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('sweep', { every: 3_600_000 });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const n = await this.governance.sweep();
        if (n > 0) this.logger.log(`Retention deleted ${n} message(s)`);
      },
      { connection },
    );
    this.logger.log('Message retention running (hourly)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
