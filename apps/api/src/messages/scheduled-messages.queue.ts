import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ScheduledMessagesService } from './scheduled-messages.service';

const QUEUE_NAME = 'scheduled-messages';

/** Delivers due scheduled messages and reminders once a minute. */
@Injectable()
export class ScheduledMessagesQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduledMessagesQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly scheduled: ScheduledMessagesService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests call deliverDue directly
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('deliver-due', { every: 60_000 });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const n = await this.scheduled.deliverDue();
        if (n > 0) this.logger.log(`Delivered ${n} scheduled message(s)`);
      },
      { connection },
    );
    this.logger.log('Scheduled-message delivery running (every 60s)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
