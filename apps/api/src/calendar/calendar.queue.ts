import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { CalendarService } from './calendar.service';

const QUEUE_NAME = 'calendar-sync';

/** Re-syncs every linked calendar every 5 minutes to keep meeting status fresh. */
@Injectable()
export class CalendarQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CalendarQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly calendar: CalendarService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return;
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('run-due', { every: 300_000 });
    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const n = await this.calendar.runDue();
        if (n > 0) this.logger.log(`Synced ${n} calendar(s)`);
      },
      { connection },
    );
    this.logger.log('Calendar-sync scheduler running (every 5m)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
