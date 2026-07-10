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
}

export function useAtlassianStatus(workspaceId: string) {
  return useQuery({
    queryKey: ['atlassian-status', workspaceId],
    queryFn: () => api<AtlassianStatus>('GET', `/workspaces/${workspaceId}/atlassian/status`),
    enabled: !!workspaceId,
    staleTime: 60000,
  });
}

export function AtlassianDialog({
  workspaceId,
  isAdmin,
  onClose,
}: {
  workspaceId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const status = useAtlassianStatus(workspaceId);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const connect = async () => {
    const { url } = await api<{ url: string }>('GET', `/workspaces/${workspaceId}/atlassian/connect-url`);
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
    <Dialog title="Atlassian integration" onClose={onClose}>
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
          <p className="text-xs text-gray-400">
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
            <p className="text-gray-400">Ask a workspace admin to connect Atlassian.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
