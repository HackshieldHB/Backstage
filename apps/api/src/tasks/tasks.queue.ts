import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { TasksService } from './tasks.service';

const QUEUE_NAME = 'task-due';

/** Sends "task is due" notifications once a minute. */
@Injectable()
export class TasksQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TasksQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly tasks: TasksService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests call notifyDue directly
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('notify-due', { every: 60_000 });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const n = await this.tasks.notifyDue();
        if (n > 0) this.logger.log(`Sent ${n} task-due notification(s)`);
      },
      { connection },
    );
    this.logger.log('Task due-date notifications running (every 60s)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
