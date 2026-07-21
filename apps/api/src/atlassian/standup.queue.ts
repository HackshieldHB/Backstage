import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { StandupService } from './standup.service';

const QUEUE_NAME = 'atlassian-standup';

/** Weekday standup digest for every channel subscribed to a Jira project. */
@Injectable()
export class StandupQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StandupQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly standup: StandupService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    // Weekdays only — a Monday digest covering the weekend is mostly noise.
    await this.queue.upsertJobScheduler('daily-standup-digest', { pattern: '0 9 * * 1-5' });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const { posted } = await this.standup.runAll();
        this.logger.log(`Standup digest posted to ${posted} channel(s)`);
      },
      { connection },
    );
    this.logger.log('Standup digest scheduled (0 9 * * 1-5)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
