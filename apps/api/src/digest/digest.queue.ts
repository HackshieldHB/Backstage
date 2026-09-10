import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { DigestService } from './digest.service';

const QUEUE_NAME = 'daily-digest';

/** Fires the daily-digest sweep once a minute (mirrors the weekly-report queue). */
@Injectable()
export class DigestQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DigestQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly digest: DigestService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return;
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
        const n = await this.digest.runDue();
        if (n > 0) this.logger.log(`Sent ${n} daily digest(s)`);
      },
      { connection },
    );
    this.logger.log('Daily-digest scheduler running (every 60s)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
