/**
 * Application service abstraction. The UI depends ONLY on this interface, never on
 * external SaaS APIs directly — so a real MiroService / DatadogService / … can be
 * dropped in later without touching components. For now, a mock implementation.
 */
import type { Application, ApplicationData, MonitoringResult } from './types';
import {
  MOCK_APPLICATIONS,
  MOCK_ATLASSIAN,
  MOCK_DATADOG,
  MOCK_GLOBAL_ACTIVITY,
  MOCK_LAUNCHDARKLY,
  MOCK_MIRO,
  MOCK_SALESFORCE,
} from './data';

export type GlobalActivity = typeof MOCK_GLOBAL_ACTIVITY;

export interface ApplicationService {
  getApplications(): Promise<Application[]>;
  getApplication(id: string): Promise<Application | null>;
  /** Domain data for one application, or a "monitoring unavailable" result. */
  getApplicationData(id: string): Promise<MonitoringResult<ApplicationData>>;
  getGlobalActivity(): Promise<GlobalActivity>;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockApplicationService implements ApplicationService {
  async getApplications(): Promise<Application[]> {
    await delay(260);
    // Keep "last sync" recent in the demo by re-stamping on each fetch.
    return MOCK_APPLICATIONS.map((a, i) => ({
      ...a,
      lastChecked: new Date(Date.now() - (18 + i * 11) * 1000).toISOString(),
    }));
  }

  async getApplication(id: string): Promise<Application | null> {
    const apps = await this.getApplications();
    return apps.find((a) => a.id === id) ?? null;
  }

  async getApplicationData(id: string): Promise<MonitoringResult<ApplicationData>> {
    await delay(340);
    switch (id) {
      case 'miro':
        return { ok: true, data: { experience: 'miro', data: MOCK_MIRO } };
      case 'launchdarkly':
        return { ok: true, data: { experience: 'launchdarkly', data: MOCK_LAUNCHDARKLY } };
      case 'atlassian':
        return { ok: true, data: { experience: 'atlassian', data: MOCK_ATLASSIAN } };
      case 'datadog':
        return { ok: true, data: { experience: 'datadog', data: MOCK_DATADOG } };
      case 'salesforce':
        return { ok: true, data: { experience: 'salesforce', data: MOCK_SALESFORCE } };
      default:
        return {
          ok: false,
          reason: 'Monitoring unavailable',
          lastSuccessfulSync: new Date(Date.now() - 10 * 60_000).toISOString(),
        };
    }
  }

  async getGlobalActivity(): Promise<GlobalActivity> {
    await delay(180);
    return MOCK_GLOBAL_ACTIVITY;
  }
}

/** Swap this for a composed real service when APIs are available. */
export const applicationService: ApplicationService = new MockApplicationService();
