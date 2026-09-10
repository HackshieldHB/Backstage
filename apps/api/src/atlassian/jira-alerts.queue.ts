import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JiraAlertsService } from './jira-alerts.service';

const QUEUE_NAME = 'jira-alerts';

/** Fires due Jira alert rules once a minute (mirrors the weekly-report queue). */
@Injectable()
export class JiraAlertsQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JiraAlertsQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly alerts: JiraAlertsService) {}

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
        const n = await this.alerts.runDue();
        if (n > 0) this.logger.log(`Posted ${n} Jira alert(s)`);
      },
      { connection },
    );
    this.logger.log('Jira-alerts scheduler running (every 60s)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
