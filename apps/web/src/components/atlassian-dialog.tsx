'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { keys } from '@/hooks/queries';
import { Dialog } from './dialog';

interface AtlassianStatus {
  connected: boolean;
  connection: { id: string; siteUrl: string; siteName: string; lastSyncAt: string | null } | null;
  confluenceReady?: boolean;
  me?: { linked: boolean; canAct: boolean };
}

export function useAtlassianStatus(workspaceId: string) {
  return useQuery({
    queryKey: ['atlassian-status', workspaceId],
    queryFn: () => api<AtlassianStatus>('GET', `/workspaces/${workspaceId}/atlassian/status`),
    enabled: !!workspaceId,
    staleTime: 60000,
  });
}

/** Thin dialog wrapper kept for any caller that still wants the standalone
 *  modal; the workspace settings surface embeds {@link AtlassianSettings}. */
export function AtlassianDialog({
  workspaceId,
  isAdmin,
  onClose,
  onOpenConfluence,
}: {
  workspaceId: string;
  isAdmin: boolean;
  onClose: () => void;
  onOpenConfluence?: () => void;
}) {
  return (
    <Dialog title="Atlassian integration" onClose={onClose}>
      <AtlassianSettings workspaceId={workspaceId} isAdmin={isAdmin} onOpenConfluence={onOpenConfluence} />
    </Dialog>
  );
}

/** The Atlassian integration settings body (no dialog chrome) — connect, sync,
 *  Jira project channels, Confluence access, and per-user account linking. */
export function AtlassianSettings({
  workspaceId,
  isAdmin,
  onOpenConfluence,
}: {
  workspaceId: string;
  isAdmin: boolean;
  onOpenConfluence?: () => void;
}) {
  const qc = useQueryClient();
  const status = useAtlassianStatus(workspaceId);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState<string | null>(null);

  const provisionProjectChannel = async () => {
    const key = projectKey.trim().toUpperCase();
    if (!key) return;
    setProvisioning(true);
    setProvisionMsg(null);
    try {
      const ch = await api<{ id: string; name: string }>('POST', `/workspaces/${workspaceId}/channels`, {
        name: key.toLowerCase(),
        groupKey: 'jira',
      });
      await api('POST', `/channels/${ch.id}/jira/subscriptions`, {
        projectKey: key,
        events: ['issue_created', 'issue_assigned', 'status_changed', 'comment_created'],
      });
      await qc.invalidateQueries({ queryKey: keys.channels(workspaceId) });
      setProvisionMsg(`Created #${ch.name} under Jira, subscribed to ${key}.`);
      setProjectKey('');
    } catch (err) {
      setProvisionMsg(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setProvisioning(false);
    }
  };

  const connect = async () => {
    const { url } = await api<{ url: string }>('GET', `/workspaces/${workspaceId}/atlassian/connect-url`);
    window.location.href = url;
  };

  const connectMyAccount = async () => {
    const { url } = await api<{ url: string }>(
      'GET',
      `/workspaces/${workspaceId}/atlassian/user-connect-url`,
    );
    window.location.href = url;
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const stats = await api<{
        scanned: number;
        provisionalCreated: number;
        linkedExisting: number;
        deactivated: number;
        reactivated: number;
      }>('POST', `/workspaces/${workspaceId}/atlassian/sync`);
      setSyncResult(
        `Scanned ${stats.scanned} directory members — ${stats.provisionalCreated} provisional created, ` +
          `${stats.linkedExisting} linked, ${stats.reactivated} reactivated, ${stats.deactivated} deactivated.`,
      );
      await qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
      await qc.invalidateQueries({ queryKey: ['atlassian-status', workspaceId] });
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      {status.data?.connected ? (
        <div className="space-y-3 text-sm">
          <p>
            Connected to <strong>{status.data.connection!.siteName}</strong>{' '}
            <span className="text-gray-500">({status.data.connection!.siteUrl})</span>
          </p>
          <p className="text-gray-500">
            Every member of the site is chattable here — unknown people appear as provisional
            members until they log in with Atlassian. Directory resyncs nightly.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Last sync:{' '}
            {status.data.connection!.lastSyncAt
              ? new Date(status.data.connection!.lastSyncAt).toLocaleString()
              : 'never'}
          </p>
          {isAdmin && (
            <button
              onClick={() => void syncNow()}
              disabled={syncing}
              className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              data-testid="sync-now"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          {syncResult && <p className="rounded-md bg-gray-50 p-2 text-xs dark:bg-gray-800">{syncResult}</p>}

          {isAdmin && (
            <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
              <p className="mb-1 text-xs font-medium">Jira project channels</p>
              <p className="mb-2 text-xs text-gray-500">
                Create a channel under the “Jira” group that follows a project’s events.
              </p>
              <div className="flex gap-2">
                <input
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                  placeholder="e.g. KAN"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
                  data-testid="jira-project-key"
                />
                <button
                  onClick={() => void provisionProjectChannel()}
                  disabled={provisioning || !projectKey.trim()}
                  className="rounded-md bg-[#2684FF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f6fd6] disabled:opacity-50"
                >
                  {provisioning ? 'Creating…' : 'Create'}
                </button>
              </div>
              {provisionMsg && <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{provisionMsg}</p>}
            </div>
          )}

          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            {status.data.confluenceReady === false ? (
              <div className="rounded-md bg-amber-50 p-2.5 dark:bg-amber-900/20">
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
                  This connection has no Confluence access.{' '}
                  {isAdmin
                    ? 'Reconnect Atlassian to grant Confluence permissions.'
                    : 'Ask a workspace admin to reconnect Atlassian.'}
                </p>
                {isAdmin && (
                  <button
                    onClick={() => void connect()}
                    className="rounded-md bg-[#2684FF] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1f6fd6]"
                    data-testid="reconnect-confluence"
                  >
                    Reconnect for Confluence
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => onOpenConfluence?.()}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                data-testid="open-confluence"
              >
                Manage Confluence pages
              </button>
            )}
          </div>

          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            {status.data.me?.canAct ? (
              <p className="text-xs text-green-600 dark:text-green-400">
                Your Jira account is connected — issue actions are attributed to you.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-gray-500">
                  Connect your own Jira account so assigns, transitions, and comments from cards are
                  attributed to you instead of the workspace connection.
                </p>
                <button
                  onClick={() => void connectMyAccount()}
                  className="rounded-md border border-[#2684FF] px-3 py-1.5 text-sm font-semibold text-[#2684FF] hover:bg-[#2684FF]/10"
                  data-testid="connect-my-jira"
                >
                  Connect my Jira account
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-gray-600 dark:text-gray-300">
            Connect a Jira/Confluence site so every member of that site can be found and chatted
            with in Backstages: Jira events flow into channels, issues unfurl into status cards,
            and <code className="text-xs">/jira KEY-123</code> works in the composer.
          </p>
          {isAdmin ? (
            <button
              onClick={() => void connect()}
              className="rounded-md bg-[#2684FF] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1f6fd6]"
              data-testid="connect-atlassian"
            >
              Connect Atlassian
            </button>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">Ask a workspace admin to connect Atlassian.</p>
          )}
        </div>
      )}
    </>
  );
}
