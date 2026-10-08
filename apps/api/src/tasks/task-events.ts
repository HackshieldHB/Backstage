import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { Task } from '@prisma/client';

/** A task's open/done state changed in Backstages (not via a Jira sync). */
export interface TaskStatusChanged {
  task: Task;
  /** Who made the change — their identity is used for any outward sync. */
  actorId: string;
}

/**
 * Lets integrations (Jira) react to task changes without the tasks module
 * importing them (which would create module cycles). One handler per kind;
 * emitting never throws — a failing sync must not fail the user's edit.
 */
@Injectable()
export class TaskEvents {
  private readonly logger = new Logger(TaskEvents.name);
  private statusHandler: ((e: TaskStatusChanged) => Promise<void>) | null = null;

  onStatusChanged(handler: (e: TaskStatusChanged) => Promise<void>): void {
    this.statusHandler = handler;
  }

  async statusChanged(event: TaskStatusChanged): Promise<void> {
    if (!this.statusHandler) return;
    try {
      await this.statusHandler(event);
    } catch (err) {
      this.logger.warn(`Task status sync failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

@Global()
@Module({ providers: [TaskEvents], exports: [TaskEvents] })
export class TaskEventsModule {}
