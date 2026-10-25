'use client';

import clsx from 'clsx';
import { useWorkspaces } from '@/hooks/queries';
import { useT } from '@/lib/i18n';
import { useUiStore, type MainView } from '@/stores/ui-store';
import { useAtlassianStatus } from './atlassian-dialog';

/**
 * Views that belong together share one sidebar entry and switch with tabs:
 * My day (Today · Tasks · Calendar), Reports, Automations and Atlassian. Each
 * tab is still its own MainView, so deep links, the command palette and every
 * existing `setMainView('tasks')` keep working unchanged.
 */
export type HubKey = 'planner' | 'reports' | 'automations' | 'atlassian';

interface HubTab {
  view: MainView;
  /** i18n key, or a literal label for product names. */
  labelKey?: string;
  label?: string;
  /** Kept from the sidebar buttons these tabs replaced. */
  testId: string;
  adminOnly?: boolean;
  needs?: 'jira' | 'confluence';
}

export const HUBS: Record<HubKey, { titleKey: string; tabs: HubTab[] }> = {
  planner: {
    titleKey: 'my_day',
    tabs: [
      { view: 'myday', labelKey: 'today', testId: 'my-day-tab' },
      { view: 'tasks', labelKey: 'tasks', testId: 'tasks-button' },
      { view: 'calendar', labelKey: 'calendar', testId: 'calendar-button' },
    ],
  },
  reports: {
    titleKey: 'reports',
    tabs: [
      { view: 'timeline', labelKey: 'team_timeline', testId: 'timeline-button' },
      { view: 'weekly-reports', labelKey: 'weekly_reports', testId: 'weekly-reports-button' },
      {
        view: 'projects',
        labelKey: 'clients_projects',
        testId: 'projects-button',
        adminOnly: true,
      },
      { view: 'analytics', labelKey: 'analytics', testId: 'analytics-button', adminOnly: true },
    ],
  },
  automations: {
    titleKey: 'automations',
    tabs: [
      { view: 'workflows', labelKey: 'workflows', testId: 'workflows-button' },
      { view: 'scheduled', labelKey: 'scheduled_messages', testId: 'scheduled-button' },
      { view: 'standups', labelKey: 'standups', testId: 'standups-button' },
    ],
  },
  atlassian: {
    titleKey: 'atlassian',
    tabs: [
      { view: 'jira', label: 'Jira', testId: 'jira-view-button', needs: 'jira' },
      {
        view: 'confluence',
        label: 'Confluence',
        testId: 'confluence-view-button',
        needs: 'confluence',
      },
    ],
  },
};

/** The hub a view belongs to, if any. */
export function hubOf(view: MainView): HubKey | null {
  for (const key of Object.keys(HUBS) as HubKey[]) {
    if (HUBS[key].tabs.some((t) => t.view === view)) return key;
  }
  return null;
}

/**
 * The tabs this person can see in a hub. A tab hidden by role or integration
 * state still shows while it is the open view (e.g. reached from the command
 * palette), so the strip never hides where you are.
 */
export function useHubTabs(workspaceId: string, hub: HubKey) {
  const workspaces = useWorkspaces();
  const atlassian = useAtlassianStatus(workspaceId);
  const mainView = useUiStore((s) => s.mainView);
  const role = workspaces.data?.find((w) => w.id === workspaceId)?.myRole;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const jira = !!atlassian.data?.connected;
  const confluence = jira && !!atlassian.data?.confluenceReady;
  return HUBS[hub].tabs.filter((t) => {
    if (t.view === mainView) return true;
    if (t.adminOnly && !isAdmin) return false;
    if (t.needs === 'jira' && !jira) return false;
    if (t.needs === 'confluence' && !confluence) return false;
    return true;
  });
}

/** The tab strip under a hub view's header. */
export function HubTabStrip({ workspaceId, view }: { workspaceId: string; view: MainView }) {
  const hub = hubOf(view);
  // Hooks run unconditionally; an unknown view just renders nothing.
  const tabs = useHubTabs(workspaceId, hub ?? 'planner');
  const setMainView = useUiStore((s) => s.setMainView);
  const t = useT();
  if (!hub || tabs.length < 2) return null;
  return (
    <ViewTabs
      label={t(HUBS[hub].titleKey)}
      tabs={tabs.map((tab) => ({
        key: tab.view,
        label: tab.label ?? t(tab.labelKey ?? tab.view),
        testId: tab.testId,
      }))}
      active={view}
      onSelect={(key) => setMainView(key as MainView)}
    />
  );
}

/** Generic tab strip (also used by the Inbox). */
export function ViewTabs({
  label,
  tabs,
  active,
  onSelect,
}: {
  label: string;
  tabs: { key: string; label: string; testId?: string; badge?: number }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-scrollbar -mb-px flex gap-5 overflow-x-auto"
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(tab.key)}
            data-testid={tab.testId}
            className={clsx(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-[13px] font-medium transition-colors',
              on ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="min-w-[18px] rounded-full bg-accent px-1.5 text-center text-[10.5px] font-semibold leading-[18px] text-white">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
