import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { WorkflowsService } from './workflows.service';

const QUEUE_NAME = 'workflow-schedules';

/** Fires scheduled workflows; ticks every 30s so no minute slot is skipped. */
@Injectable()
export class WorkflowsQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkflowsQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly workflows: WorkflowsService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests call runDueSchedules directly
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('run-due', { every: 30_000 });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const n = await this.workflows.runDueSchedules();
        if (n > 0) this.logger.log(`Ran ${n} scheduled workflow(s)`);
      },
      { connection },
    );
    this.logger.log('Scheduled workflows running (every 30s)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
