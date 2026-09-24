/**
 * Application Hub — shared platform types (Layer 1).
 *
 * The base `Application` model is deliberately GENERIC: identity, status, and the
 * few metrics shown on the card. Domain data (boards, flags, services, …) lives in
 * per-application `*Data` types (Layer 2) and never leaks into the base model.
 */

export type ApplicationStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export type ApplicationExperienceType =
  | 'miro'
  | 'launchdarkly'
  | 'atlassian'
  | 'datadog'
  | 'salesforce';

export type ApplicationCategory =
  | 'Collaboration'
  | 'Feature Management'
  | 'Productivity'
  | 'Observability'
  | 'CRM';

/** One headline metric shown on the application card (domain label + value). */
export interface CardMetric {
  label: string;
  value: string;
}

/** Shared, platform-level application identity + state. */
export interface Application {
  id: string;
  name: string;
  /** Short product tagline. */
  description: string;
  /** Longer sub-label (e.g. "Jira • Confluence • JSM"). */
  tagline: string;
  category: ApplicationCategory;
  experience: ApplicationExperienceType;
  status: ApplicationStatus;
  /** Human sentence explaining WHY the status is what it is (domain-specific). */
  statusReason: string;
  /** External product URL, opened in a new tab. */
  url: string;
  /** ISO timestamp of the last successful monitoring sync. */
  lastChecked: string;
  /** 2–3 domain-specific headline metrics for the card. */
  metrics: CardMetric[];
}

/** A monitoring fetch either succeeds with domain data, or reports that monitoring
 *  is unavailable — which is NOT the same as the application being critical. */
export type MonitoringResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; lastSuccessfulSync: string };

// ---------------------------------------------------------------------------
// Layer 2 — application-specific domain models
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  text: string;
  tone?: 'default' | 'positive' | 'warning' | 'critical';
}

export interface MiroWorkspace {
  id: string;
  name: string;
  members: number;
  boards: number;
}
export interface MiroBoard {
  id: string;
  name: string;
  workspace: string;
  updatedAt: string;
}
export interface MiroData {
  activeUsers: number;
  activeBoards: number;
  activityToday: number;
  workspaces: MiroWorkspace[];
  recentBoards: MiroBoard[];
  activity: ActivityEvent[];
}

export type FlagState = 'on' | 'off' | 'rollout';
export interface LaunchDarklyFlag {
  key: string;
  state: FlagState;
  /** Percentage when state === 'rollout'. */
  rollout?: number;
  environment: string;
}
export interface LaunchDarklyEnvironment {
  name: string;
  status: ApplicationStatus;
  flagsEnabled: number;
}
export interface LaunchDarklyChange {
  id: string;
  at: string;
  text: string;
  by: string;
}
export interface LaunchDarklyData {
  featureFlags: number;
  enabled: number;
  disabled: number;
  flags: LaunchDarklyFlag[];
  environments: LaunchDarklyEnvironment[];
  changes: LaunchDarklyChange[];
}

export interface AtlassianProduct {
  key: 'jira' | 'confluence' | 'jsm';
  name: string;
  metricLabel: string;
  metricValue: number;
  status: ApplicationStatus;
}
export interface AtlassianData {
  products: AtlassianProduct[];
  users: number;
  projects: number;
  openIssues: number;
  activity: ActivityEvent[];
}

export interface DatadogService {
  name: string;
  status: ApplicationStatus;
  latencyMs: number;
  errorRate: number;
}
export interface DatadogIncident {
  id: string;
  at: string;
  title: string;
  severity: 'sev1' | 'sev2' | 'sev3';
  resolved: boolean;
}
export interface DatadogData {
  services: DatadogService[];
  monitors: number;
  activeIncidents: number;
  hosts: number;
  incidents: DatadogIncident[];
}

export type IntegrationHealth = 'healthy' | 'delayed' | 'failed';
export interface SalesforceIntegration {
  name: string;
  health: IntegrationHealth;
  lastSync: string;
}
export interface SalesforceData {
  activeUsers: number;
  apiUsagePct: number;
  apiLimit: string;
  integrations: SalesforceIntegration[];
  activity: ActivityEvent[];
}

/** Discriminated union tying an experience type to its domain data shape. */
export type ApplicationData =
  | { experience: 'miro'; data: MiroData }
  | { experience: 'launchdarkly'; data: LaunchDarklyData }
  | { experience: 'atlassian'; data: AtlassianData }
  | { experience: 'datadog'; data: DatadogData }
  | { experience: 'salesforce'; data: SalesforceData };
