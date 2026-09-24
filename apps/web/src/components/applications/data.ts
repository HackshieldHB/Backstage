/**
 * MOCK / DEMO data for the Application Hub. Values are realistic but fabricated —
 * they are shaped exactly like eventual API responses so a real `*Service` can
 * drop in later (see service.ts). Do not treat any number here as real.
 */
import type {
  Application,
  AtlassianData,
  DatadogData,
  LaunchDarklyData,
  MiroData,
  SalesforceData,
} from './types';

const agoMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const agoSec = (s: number) => new Date(Date.now() - s * 1000).toISOString();

/** Base identities + card metrics. Exactly one app needs attention (Salesforce). */
export const MOCK_APPLICATIONS: Application[] = [
  {
    id: 'miro',
    name: 'Miro',
    description: 'Collaborative visual workspace',
    tagline: 'Boards • Workspaces • Whiteboarding',
    category: 'Collaboration',
    experience: 'miro',
    status: 'healthy',
    statusReason: 'All workspaces reachable; collaboration activity nominal.',
    url: 'https://miro.com/app/',
    lastChecked: agoSec(42),
    metrics: [
      { label: 'Active users', value: '148' },
      { label: 'Boards', value: '37' },
      { label: 'Activities', value: '429' },
    ],
  },
  {
    id: 'launchdarkly',
    name: 'LaunchDarkly',
    description: 'Feature management & controlled releases',
    tagline: 'Flags • Environments • Rollouts',
    category: 'Feature Management',
    experience: 'launchdarkly',
    status: 'healthy',
    statusReason: 'Flag delivery healthy across all environments.',
    url: 'https://app.launchdarkly.com/',
    lastChecked: agoSec(28),
    metrics: [
      { label: 'Feature flags', value: '87' },
      { label: 'Rollouts', value: '12' },
      { label: 'Environments', value: '3' },
    ],
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Jira • Confluence • Jira Service Management',
    tagline: 'Product suite',
    category: 'Productivity',
    experience: 'atlassian',
    status: 'healthy',
    statusReason: 'All three products operational.',
    url: 'https://www.atlassian.com/',
    lastChecked: agoSec(65),
    metrics: [
      { label: 'Projects', value: '24' },
      { label: 'Users', value: '182' },
      { label: 'Products', value: '3' },
    ],
  },
  {
    id: 'datadog',
    name: 'Datadog',
    description: 'Observability & infrastructure monitoring',
    tagline: 'Services • Monitors • Incidents',
    category: 'Observability',
    experience: 'datadog',
    status: 'healthy',
    statusReason: 'Core services healthy; one service degraded, no active SEV.',
    url: 'https://app.datadoghq.com/',
    lastChecked: agoSec(18),
    metrics: [
      { label: 'Services', value: '124' },
      { label: 'Monitors', value: '87' },
      { label: 'Incidents', value: '2' },
    ],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'CRM & business platform',
    tagline: 'Sales • Service • Platform',
    category: 'CRM',
    experience: 'salesforce',
    status: 'warning',
    statusReason: 'SAP integration failing and API usage above 75%.',
    url: 'https://login.salesforce.com/',
    lastChecked: agoSec(90),
    metrics: [
      { label: 'Active users', value: '342' },
      { label: 'API usage', value: '78%' },
      { label: 'Integrations', value: '18' },
    ],
  },
];

export const MOCK_MIRO: MiroData = {
  activeUsers: 148,
  activeBoards: 37,
  activityToday: 429,
  workspaces: [
    { id: 'w1', name: 'Product Discovery', members: 24, boards: 12 },
    { id: 'w2', name: 'UX Research', members: 18, boards: 7 },
    { id: 'w3', name: 'Engineering Sync', members: 31, boards: 9 },
    { id: 'w4', name: 'Marketing Campaigns', members: 14, boards: 6 },
  ],
  recentBoards: [
    { id: 'b1', name: 'Q3 Roadmap Canvas', workspace: 'Product Discovery', updatedAt: agoMin(12) },
    { id: 'b2', name: 'Onboarding Flow v2', workspace: 'UX Research', updatedAt: agoMin(48) },
    { id: 'b3', name: 'Sprint Retro — Wk 34', workspace: 'Engineering Sync', updatedAt: agoMin(95) },
    { id: 'b4', name: 'Launch Brainstorm', workspace: 'Marketing Campaigns', updatedAt: agoMin(150) },
  ],
  activity: [
    { id: 'a1', at: agoMin(8), text: 'New board created in Product Discovery', tone: 'positive' },
    { id: 'a2', at: agoMin(21), text: 'Board “Onboarding Flow v2” shared with 4 people' },
    { id: 'a3', at: agoMin(37), text: 'User joined UX Research workspace' },
    { id: 'a4', at: agoMin(64), text: '18 comments added across boards' },
  ],
};

export const MOCK_LAUNCHDARKLY: LaunchDarklyData = {
  featureFlags: 87,
  enabled: 64,
  disabled: 23,
  flags: [
    { key: 'checkout-v2', state: 'on', environment: 'Production' },
    { key: 'payment-flow', state: 'rollout', rollout: 75, environment: 'Production' },
    { key: 'new-dashboard', state: 'off', environment: 'Production' },
    { key: 'search-reindex', state: 'rollout', rollout: 20, environment: 'Staging' },
    { key: 'referral-program', state: 'on', environment: 'Production' },
    { key: 'legacy-billing', state: 'off', environment: 'Production' },
  ],
  environments: [
    { name: 'Production', status: 'healthy', flagsEnabled: 41 },
    { name: 'Staging', status: 'healthy', flagsEnabled: 58 },
    { name: 'Development', status: 'healthy', flagsEnabled: 72 },
  ],
  changes: [
    { id: 'c1', at: agoMin(14), text: 'checkout-v2 enabled in Production', by: 'a.rivera' },
    { id: 'c2', at: agoMin(52), text: 'payment-flow rollout changed 50% → 75%', by: 'j.chen' },
    { id: 'c3', at: agoMin(140), text: 'search-reindex targeting updated', by: 'm.okafor' },
  ],
};

export const MOCK_ATLASSIAN: AtlassianData = {
  products: [
    { key: 'jira', name: 'Jira', metricLabel: 'Projects', metricValue: 24, status: 'healthy' },
    { key: 'confluence', name: 'Confluence', metricLabel: 'Spaces', metricValue: 18, status: 'healthy' },
    { key: 'jsm', name: 'Jira Service Management', metricLabel: 'Service projects', metricValue: 6, status: 'healthy' },
  ],
  users: 182,
  projects: 24,
  openIssues: 1248,
  activity: [
    { id: 'a1', at: agoMin(16), text: 'Jira project “PLATFORM” created', tone: 'positive' },
    { id: 'a2', at: agoMin(44), text: 'Confluence page “Release Notes 4.2” updated' },
    { id: 'a3', at: agoMin(70), text: 'JSM request INC-902 resolved', tone: 'positive' },
    { id: 'a4', at: agoMin(120), text: '37 issues transitioned across boards' },
  ],
};

export const MOCK_DATADOG: DatadogData = {
  services: [
    { name: 'API Gateway', status: 'healthy', latencyMs: 84, errorRate: 0.2 },
    { name: 'Authentication', status: 'healthy', latencyMs: 61, errorRate: 0.1 },
    { name: 'Payment Service', status: 'warning', latencyMs: 512, errorRate: 2.4 },
    { name: 'Database', status: 'healthy', latencyMs: 12, errorRate: 0.0 },
    { name: 'Notification Worker', status: 'healthy', latencyMs: 140, errorRate: 0.4 },
  ],
  monitors: 87,
  activeIncidents: 2,
  hosts: 214,
  incidents: [
    { id: 'i1', at: agoMin(9), title: 'Payment latency exceeded threshold', severity: 'sev2', resolved: false },
    { id: 'i2', at: agoMin(96), title: 'Database connection pool recovered', severity: 'sev3', resolved: true },
  ],
};

export const MOCK_SALESFORCE: SalesforceData = {
  activeUsers: 342,
  apiUsagePct: 78,
  apiLimit: '78% of 1,000,000 daily calls',
  integrations: [
    { name: 'SAP Integration', health: 'failed', lastSync: agoMin(38) },
    { name: 'Marketing Sync', health: 'delayed', lastSync: agoMin(12) },
    { name: 'Customer Data Platform', health: 'healthy', lastSync: agoMin(3) },
    { name: 'Billing Connector', health: 'healthy', lastSync: agoMin(6) },
  ],
  activity: [
    { id: 'a1', at: agoMin(5), text: 'SAP integration sync failed (auth error)', tone: 'critical' },
    { id: 'a2', at: agoMin(33), text: 'API usage crossed 75% threshold', tone: 'warning' },
    { id: 'a3', at: agoMin(58), text: 'User access changed for 3 accounts' },
    { id: 'a4', at: agoMin(110), text: '1,204 records updated via CDP' },
  ],
};

/** Cross-application feed shown on the hub (UI-shared, content is domain-specific). */
export const MOCK_GLOBAL_ACTIVITY = [
  { id: 'g1', appId: 'atlassian', at: agoMin(3), text: 'Jira project “PLATFORM” created', tone: 'positive' as const },
  { id: 'g2', appId: 'salesforce', at: agoMin(5), text: 'SAP integration sync failed', tone: 'critical' as const },
  { id: 'g3', appId: 'datadog', at: agoMin(9), text: 'Payment latency exceeded threshold', tone: 'warning' as const },
  { id: 'g4', appId: 'miro', at: agoMin(12), text: 'New board created in Product Discovery', tone: 'default' as const },
  { id: 'g5', appId: 'launchdarkly', at: agoMin(14), text: 'checkout-v2 enabled in Production', tone: 'default' as const },
];
