'use client';

import { CloudOff, RefreshCw } from 'lucide-react';
import type { ApplicationData, ApplicationExperienceType } from '../types';
import { relativeTime } from '../primitives';
import { atlassianTabs, AtlassianExperience } from './atlassian';
import { datadogTabs, DatadogExperience } from './datadog';
import { launchDarklyTabs, LaunchDarklyExperience } from './launchdarkly';
import { miroTabs, MiroExperience } from './miro';
import { salesforceTabs, SalesforceExperience } from './salesforce';

export interface Tab {
  id: string;
  label: string;
}

/** Every application experience receives the same shape; only the DATA type and
 *  the rendered information architecture differ. */
export interface ExperienceProps<T> {
  data: T;
  variant: 'modal' | 'detail';
  activeTab: string;
}

/** Per-application domain navigation — generated from the experience, never a
 *  single universal tab set. */
export const EXPERIENCE_TABS: Record<ApplicationExperienceType, Tab[]> = {
  miro: miroTabs,
  launchdarkly: launchDarklyTabs,
  atlassian: atlassianTabs,
  datadog: datadogTabs,
  salesforce: salesforceTabs,
};

export function getExperienceTabs(type: ApplicationExperienceType): Tab[] {
  return EXPERIENCE_TABS[type];
}

/** Resolves the correct domain experience for an application's data. */
export function ApplicationExperience({
  appData,
  variant,
  activeTab,
}: {
  appData: ApplicationData;
  variant: 'modal' | 'detail';
  activeTab: string;
}) {
  switch (appData.experience) {
    case 'miro':
      return <MiroExperience data={appData.data} variant={variant} activeTab={activeTab} />;
    case 'launchdarkly':
      return <LaunchDarklyExperience data={appData.data} variant={variant} activeTab={activeTab} />;
    case 'atlassian':
      return <AtlassianExperience data={appData.data} variant={variant} activeTab={activeTab} />;
    case 'datadog':
      return <DatadogExperience data={appData.data} variant={variant} activeTab={activeTab} />;
    case 'salesforce':
      return <SalesforceExperience data={appData.data} variant={variant} activeTab={activeTab} />;
    default:
      return null;
  }
}

/**
 * Shown when monitoring data can't be fetched. Crucially, this is NOT the same as
 * the application being "critical" — the app may be perfectly fine; we just can't
 * read its telemetry right now.
 */
export function MonitoringUnavailable({
  reason,
  lastSuccessfulSync,
  onRetry,
}: {
  reason: string;
  lastSuccessfulSync: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-elevated px-6 py-10 text-center">
      <CloudOff size={26} className="text-ink-3" />
      <div>
        <p className="text-[14px] font-semibold text-ink">{reason}</p>
        <p className="mt-1 text-[12px] text-ink-3">
          The application is registered, but its latest information couldn’t be retrieved.
          <br />
          Last successful sync {relativeTime(lastSuccessfulSync)}.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hovered"
      >
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  );
}
