'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Building2, Plug } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';
import { AtlassianSettings } from './atlassian-dialog';

type Section = 'general' | 'atlassian';

/**
 * Workspace settings, opened from the workspace name. Home for everything that
 * configures the workspace — currently General (rename) and the Atlassian /
 * Jira / Confluence integration, which used to be its own scattered dialog.
 */
export function WorkspaceSettingsDialog({
  workspaceId,
  workspaceName,
  isAdmin,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('general');
  const setMainView = useUiStore((s) => s.setMainView);

  const openConfluence = () => {
    onClose();
    setMainView('confluence');
  };

  return (
    <Dialog title="Workspace settings" onClose={onClose} wide>
      <div className="flex gap-4">
        <nav className="w-40 shrink-0 space-y-0.5">
          <SectionTab
            icon={<Building2 size={15} />}
            label="General"
            active={section === 'general'}
            onClick={() => setSection('general')}
          />
          <SectionTab
            icon={<Plug size={15} />}
            label="Atlassian"
            active={section === 'atlassian'}
            onClick={() => setSection('atlassian')}
          />
        </nav>
        <div className="min-w-0 flex-1">
          {section === 'general' ? (
            <GeneralSettings
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              isAdmin={isAdmin}
            />
          ) : (
            <AtlassianSettings
              workspaceId={workspaceId}
              isAdmin={isAdmin}
              onOpenConfluence={openConfluence}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

function GeneralSettings({
  workspaceId,
  workspaceName,
  isAdmin,
}: {
  workspaceId: string;
  workspaceName: string;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [name, setName] = useState(workspaceName);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = name.trim();
    if (!next || next === workspaceName) return;
    setSaving(true);
    try {
      await api('PATCH', `/workspaces/${workspaceId}`, { name: next });
      await qc.invalidateQueries({ queryKey: keys.workspaces });
      pushToast('Workspace renamed.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Rename failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-sm">
      <label className="mb-1 block text-xs font-medium text-gray-500">Workspace name</label>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isAdmin}
          className="flex-1 rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60 dark:border-line dark:bg-gray-800"
          data-testid="workspace-rename"
        />
        {isAdmin && (
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim() || name.trim() === workspaceName}
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {!isAdmin && (
        <p className="mt-2 text-xs text-gray-500">Only workspace admins can rename the workspace.</p>
      )}
    </div>
  );
}

function SectionTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]',
        active
          ? 'bg-accent/10 font-medium text-accent'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
