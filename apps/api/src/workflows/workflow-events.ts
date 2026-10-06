import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Domain events that can trigger workflows (message_posted is wired directly). */
export type WorkflowEvent =
  | {
      type: 'reaction_added';
      workspaceId: string;
      channelId: string;
      messageId: string;
      /** Who reacted. */
      userId: string;
      emoji: string;
      messageText: string;
    }
  | { type: 'member_joined'; workspaceId: string; channelId: string; userId: string }
  | {
      type: 'incident_declared';
      workspaceId: string;
      incidentId: string;
      title: string;
      severity: 'SEV1' | 'SEV2' | 'SEV3';
      /** Who declared it. */
      userId: string;
    };

/**
 * A tiny in-process bus so producers (channels, reactions, incidents) can raise
 * workflow triggers without importing the workflow engine — which itself depends
 * on messaging — and creating module cycles. The engine registers one handler.
 * Emitting never throws: a failing workflow must not fail the user's action.
 */
@Injectable()
export class WorkflowEvents {
  private readonly logger = new Logger(WorkflowEvents.name);
  private handler: ((e: WorkflowEvent) => Promise<void>) | null = null;

  register(handler: (e: WorkflowEvent) => Promise<void>): void {
    this.handler = handler;
  }

  async emit(event: WorkflowEvent): Promise<void> {
    if (!this.handler) return;
    try {
      await this.handler(event);
    } catch (err) {
      this.logger.warn(
        `Workflow event ${event.type} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

@Global()
@Module({ providers: [WorkflowEvents], exports: [WorkflowEvents] })
export class WorkflowEventsModule {}
