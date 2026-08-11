import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { StandupsService } from './standups.service';

const QUEUE_NAME = 'standups';

/** Fires due standup prompts once a minute (mirrors the scheduled-messages queue). */
@Injectable()
export class StandupsQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StandupsQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly standups: StandupsService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests call runDue directly
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('run-due', { every: 60_000 });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const n = await this.standups.runDue();
        if (n > 0) this.logger.log(`Posted ${n} standup prompt(s)`);
      },
      { connection },
    );
    this.logger.log('Standup scheduler running (every 60s)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
