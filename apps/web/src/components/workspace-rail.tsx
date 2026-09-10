'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, type WorkspaceWithRole } from '@/hooks/queries';
import { Dialog } from './dialog';

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
  const qc = useQueryClient();

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-2 bg-gradient-to-b from-[#2a1a5e] to-[#111027] py-3">
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          title={ws.name}
          onClick={() => onSelect(ws.id)}
          className={clsx(
            'flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold text-white transition-all hover:scale-105',
            ws.id === activeId
              ? 'brand-gradient scale-105 shadow-lg shadow-violet-500/30'
              : 'bg-white/10 hover:bg-white/20',
          )}
        >
          {ws.name.slice(0, 1).toUpperCase()}
        </button>
      ))}
      <button
        title="Create workspace"
        onClick={() => setCreating(true)}
        className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
      >
        <Plus size={18} />
      </button>

      {creating && (
        <Dialog title="Create workspace" onClose={() => setCreating(false)}>
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
        </Dialog>
      )}
    </nav>
  );
}
