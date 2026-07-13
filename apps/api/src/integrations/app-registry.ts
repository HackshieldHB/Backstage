import { Global, Injectable, Module } from '@nestjs/common';

/**
 * A pluggable integration ("app") that extends chat. Apps implement the hooks
 * they support and register themselves with the {@link AppRegistry} on init.
 * This is the seam that turns "Jira baked into core" into "Jira is one app" —
 * adding a second app (GitHub, …) means implementing this interface, not
 * threading new `if` branches through the messaging core.
 */
export interface IntegrationApp {
  /** Stable identifier, e.g. 'jira'. */
  readonly id: string;
  /** Compute link unfurls for a message's text, or null when none apply. */
  unfurl?(workspaceId: string, contentText: string): Promise<unknown[] | null>;
}

/** In-process registry of integration apps, consulted by the messaging core. */
@Injectable()
export class AppRegistry {
  private readonly apps = new Map<string, IntegrationApp>();

  register(app: IntegrationApp): void {
    this.apps.set(app.id, app);
  }

  list(): IntegrationApp[] {
    return [...this.apps.values()];
  }

  /** Merges unfurls from every registered app; one app failing never throws. */
  async unfurl(workspaceId: string, contentText: string): Promise<unknown[] | null> {
    const merged: unknown[] = [];
    for (const app of this.apps.values()) {
      if (!app.unfurl) continue;
      try {
        const res = await app.unfurl(workspaceId, contentText);
        if (res) merged.push(...res);
      } catch {
        // An integration's failure must never break message delivery.
      }
    }
    return merged.length > 0 ? merged : null;
  }
}

@Global()
@Module({
  providers: [AppRegistry],
  exports: [AppRegistry],
})
export class IntegrationsModule {}
