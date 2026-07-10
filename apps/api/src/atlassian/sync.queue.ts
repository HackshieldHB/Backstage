import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AtlassianSyncService } from './sync.service';

const QUEUE_NAME = 'atlassian-sync';

/** Nightly directory resync for every connected workspace (03:00 server time). */
@Injectable()
export class AtlassianSyncQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AtlassianSyncQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: AtlassianSyncService,
  ) {}

  async onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    await this.queue.upsertJobScheduler('nightly-directory-sync', { pattern: '0 3 * * *' });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        const connections = await this.prisma.atlassianConnection.findMany({
          select: { workspaceId: true },
        });
        for (const c of connections) {
          try {
            await this.sync.syncWorkspace(c.workspaceId);
          } catch (err) {
            this.logger.error(`Nightly sync failed for workspace ${c.workspaceId}: ${String(err)}`);
          }
        }
      },
      { connection },
    );
    this.logger.log('Nightly Atlassian sync scheduled (0 3 * * *)');
  }

  async onApplicationShutdown() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
