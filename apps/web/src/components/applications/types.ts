import type { AppCatalogEntry, AppStat, AppStatus } from '@backstages/shared';

/**
 * Application Hub types. Every number shown comes from a real connection
 * (see use-applications.ts) — an application that isn't connected shows no
 * figures at all, only how to connect it.
 */
export type ApplicationStatus = AppStatus;

export interface Application {
  id: string;
  name: string;
  description: string;
  category: string;
  connected: boolean;
  status: ApplicationStatus;
  statusReason: string;
  /** Deep link into the connected account (or the product's home when not connected). */
  url: string;
  /** When the figures were read; null when not connected or unreachable. */
  lastChecked: string | null;
  metrics: AppStat[];
  /** 'atlassian' connects via its own OAuth flow in Workspace settings; 'api' uses keys. */
  connectVia: 'atlassian' | 'api';
  /** For 'api' apps: the connect form spec. */
  catalog?: AppCatalogEntry;
  settings: Record<string, string>;
  secretsSet: string[];
}
