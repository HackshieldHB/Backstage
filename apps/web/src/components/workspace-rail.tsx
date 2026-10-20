'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, type WorkspaceWithRole } from '@/hooks/queries';
import { Dialog } from './dialog';
import { JoinWorkspaceSection } from './join-workspace-section';
import { BrandMark } from './brand-mark';

export function WorkspaceRail({
  workspaces,
  activeId,
  onSelect,
}: {
  workspaces: WorkspaceWithRole[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const qc = useQueryClient();

  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-nav py-3" aria-label="Workspaces">
      <BrandMark size={26} className="mb-2" />
      {workspaces.map((ws) => (
        <div key={ws.id} className="relative flex w-full justify-center">
          {ws.id === activeId && (
            <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
          )}
          <button
            title={ws.name}
            aria-label={ws.name}
            aria-current={ws.id === activeId ? 'true' : undefined}
            onClick={() => onSelect(ws.id)}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-semibold transition-colors',
              ws.id === activeId
                ? 'bg-accent text-white shadow-sm'
                : 'border border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {ws.name.slice(0, 1).toUpperCase()}
          </button>
        </div>
      ))}
      <button
        title="Add a workspace"
        aria-label="Add a workspace"
        onClick={() => setCreating(true)}
        className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-3 hover:border-accent hover:text-accent"
      >
        <Plus size={16} />
      </button>

      {creating && (
        <Dialog title="Add a workspace" onClose={() => setCreating(false)}>
          <h3 className="mb-2 text-sm font-semibold text-ink">Create a new workspace</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ws = await api<{ id: string }>('POST', '/workspaces', { name });
              await qc.invalidateQueries({ queryKey: keys.workspaces });
              setCreating(false);
              setName('');
              onSelect(ws.id);
            }}
          >
            <input
              className="mb-3 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800"
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            <button
              type="submit"
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Create
            </button>
          </form>
          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs text-ink-3">or join one</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          {joinError && <p className="mb-2 text-sm text-red-600">{joinError}</p>}
          <JoinWorkspaceSection
            onJoined={(id) => {
              setCreating(false);
              onSelect(id);
            }}
            onError={setJoinError}
          />
        </Dialog>
      )}
    </nav>
  );
}
