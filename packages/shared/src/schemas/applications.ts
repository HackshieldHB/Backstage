import { z } from 'zod';

/**
 * Applications hub: external tools a workspace connects with its own
 * credentials (Datadog, LaunchDarkly, Miro, Salesforce). Atlassian is listed
 * too but connects through its own OAuth flow (see atlassian-overview).
 * Everything shown is read live from the connected service — no sample data.
 */
export type AppStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type AppTone = 'positive' | 'warning' | 'critical';

/** One credential/setting the connect form asks for. */
export interface AppFieldSpec {
  key: string;
  label: string;
  /** Stored encrypted and never sent back to the browser. */
  secret: boolean;
  optional?: boolean;
  placeholder?: string;
  help?: string;
  /** A fixed choice (e.g. a Datadog site); otherwise free text. */
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
}

export interface AppCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Product home, for "Open" when not connected. */
  homeUrl: string;
  /** Where an admin finds the credentials. */
  setupUrl: string;
  setupSteps: string[];
  fields: AppFieldSpec[];
}

export interface AppStat {
  label: string;
  value: string;
  tone?: AppTone;
}

export interface AppListItem {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  url?: string | null;
  tone?: AppTone;
}

export interface AppList {
  title: string;
  /** Shown when `items` is empty. */
  empty: string;
  items: AppListItem[];
}

export interface ApplicationSummaryDto {
  id: string;
  connected: boolean;
  status: AppStatus;
  statusReason: string;
  /** Up to three headline numbers for the card. */
  metrics: AppStat[];
  /** When these figures were read (null when not connected). */
  lastChecked: string | null;
  /** Deep link into the connected account (or the product home). */
  url: string;
  /** Non-secret settings, for editing the connection. */
  settings: Record<string, string>;
  /** Which secret fields are already stored. */
  secretsSet: string[];
}

export interface ApplicationDetailDto {
  id: string;
  status: AppStatus;
  statusReason: string;
  fetchedAt: string;
  url: string;
  stats: AppStat[];
  lists: AppList[];
}

export interface ApplicationsOverviewDto {
  catalog: AppCatalogEntry[];
  apps: ApplicationSummaryDto[];
}

/** Connect (or update) an application. Blank secret fields keep the stored value. */
export const ConnectApplicationSchema = z.object({
  fields: z.record(z.string().max(4000)),
});
export type ConnectApplicationInput = z.infer<typeof ConnectApplicationSchema>;
