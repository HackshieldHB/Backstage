import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ScheduledHuddlesService } from './scheduled-huddles.service';

const QUEUE_NAME = 'scheduled-huddles';

/** Fires "starting now" reminders for due scheduled huddles once a minute. */
@Injectable()
export class ScheduledHuddlesQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduledHuddlesQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly scheduled: ScheduledHuddlesService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests call fireDue directly
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('fire-due', { every: 60_000 });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const n = await this.scheduled.fireDue();
        if (n > 0) this.logger.log(`Fired ${n} scheduled-huddle reminder(s)`);
      },
      { connection },
    );
    this.logger.log('Scheduled-huddle reminders running (every 60s)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
