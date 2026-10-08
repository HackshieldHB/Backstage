'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronDown, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationDto, SidebarSectionDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, type ChannelWithMeta } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { PromptDialog } from './confirm-dialog';

export const sectionsKey = (ws: string) => ['sidebar-sections', ws] as const;

export function useSidebarSections(workspaceId: string) {
  return useQuery({
    queryKey: sectionsKey(workspaceId),
    queryFn: () => api<SidebarSectionDto[]>('GET', `/workspaces/${workspaceId}/sidebar-sections`),
    enabled: !!workspaceId,
  });
}

/** Mutations for sections + filing channels/DMs, refreshing the lists they affect. */
export function useSectionActions(workspaceId: string) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: sectionsKey(workspaceId) });
    void qc.invalidateQueries({ queryKey: keys.channels(workspaceId) });
    void qc.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
  };
  const onError = (err: unknown) =>
    pushToast(err instanceof Error ? err.message : 'Could not update the sidebar.', 'error');
  return {
    create: useMutation({
      mutationFn: (name: string) =>
        api<SidebarSectionDto>('POST', `/workspaces/${workspaceId}/sidebar-sections`, { name }),
      onSuccess: refresh,
      onError,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        api('PATCH', `/sidebar-sections/${id}`, { name }),
      onSuccess: refresh,
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api('DELETE', `/sidebar-sections/${id}`),
      onSuccess: refresh,
      onError,
    }),
    file: useMutation({
      mutationFn: ({ kind, id, sectionId }: { kind: 'channel' | 'conversation'; id: string; sectionId: string | null }) =>
        api('PUT', `/${kind === 'channel' ? 'channels' : 'conversations'}/${id}/section`, { sectionId }),
      onSuccess: refresh,
      onError,
    }),
  };
}

/** The "⋯" menu on a channel/DM row: move it into a section, or out again. */
export function MoveToSectionMenu({
  workspaceId,
  kind,
  id,
  currentSectionId,
  sections,
}: {
  workspaceId: string;
  kind: 'channel' | 'conversation';
  id: string;
  currentSectionId: string | null | undefined;
  sections: SidebarSectionDto[];
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const actions = useSectionActions(workspaceId);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const fileInto = (sectionId: string | null) => {
    setOpen(false);
    actions.file.mutate({ kind, id, sectionId });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Move to section"
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded bg-surface p-0.5 text-ink-3 opacity-0 hover:bg-hovered hover:text-ink focus:opacity-100 group-hover/row:opacity-100"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-6 z-40 min-w-[180px] rounded-lg border border-line bg-overlay p-1 text-[13px] shadow-pop"
        >
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Move to section</div>
          {sections.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              disabled={s.id === currentSectionId}
              onClick={() => fileInto(s.id)}
              className="block w-full truncate rounded px-2 py-1 text-left text-ink hover:bg-hovered disabled:text-ink-3"
            >
              {s.name}
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setNaming(true);
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-accent hover:bg-hovered"
          >
            <FolderPlus size={13} /> New section…
          </button>
          {currentSectionId && (
            <button
              role="menuitem"
              onClick={() => fileInto(null)}
              className="block w-full rounded px-2 py-1 text-left text-ink-2 hover:bg-hovered"
            >
              Remove from section
            </button>
          )}
        </div>
      )}
      {naming && (
        <PromptDialog
          title="New section"
          label="Section name"
          confirmLabel="Create"
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            // Failures already show a toast (mutation onError); don't rethrow.
            const created = await actions.create.mutateAsync(name.trim()).catch(() => null);
            if (created) actions.file.mutate({ kind, id, sectionId: created.id });
          }}
        />
      )}
    </div>
  );
}

/** The user's own sections, each listing the channels and DMs filed in it. */
export function CustomSections({
  workspaceId,
  sections,
  channels,
  conversations,
  renderChannel,
  renderDm,
}: {
  workspaceId: string;
  sections: SidebarSectionDto[];
  channels: ChannelWithMeta[];
  conversations: ConversationDto[];
  renderChannel: (ch: ChannelWithMeta) => ReactNode;
  renderDm: (dm: ConversationDto) => ReactNode;
}) {
  const actions = useSectionActions(workspaceId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<SidebarSectionDto | null>(null);

  return (
    <>
      {sections.map((s) => {
        const chans = channels.filter((c) => c.sectionId === s.id);
        const dms = conversations.filter((c) => c.sectionId === s.id);
        const isCollapsed = collapsed[s.id];
        return (
          <div key={s.id} data-testid={`sidebar-section-${s.name}`}>
            <div className="group/sec mt-4 flex items-center px-2 pb-1">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))}
                className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3 hover:text-ink"
                aria-expanded={!isCollapsed}
              >
                <ChevronDown size={12} className={clsx('shrink-0 transition-transform', isCollapsed && '-rotate-90')} />
                <span className="truncate">{s.name}</span>
              </button>
              <button
                onClick={() => setRenaming(s)}
                aria-label={`Rename section ${s.name}`}
                className="rounded p-0.5 text-ink-3 opacity-0 hover:text-ink group-hover/sec:opacity-100"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={() => actions.remove.mutate(s.id)}
                aria-label={`Delete section ${s.name}`}
                title="Delete section (its channels go back to the default lists)"
                className="rounded p-0.5 text-ink-3 opacity-0 hover:text-red-500 group-hover/sec:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            </div>
            {!isCollapsed && (
              <ul>
                {chans.map((ch) => renderChannel(ch))}
                {dms.map((dm) => renderDm(dm))}
                {chans.length + dms.length === 0 && (
                  <li className="px-2 py-1 text-[12px] text-ink-3">Use “⋯” on a channel to move it here.</li>
                )}
              </ul>
            )}
          </div>
        );
      })}
      {renaming && (
        <PromptDialog
          title="Rename section"
          label="Section name"
          confirmLabel="Save"
          initialValue={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await actions.rename.mutateAsync({ id: renaming.id, name: name.trim() }).catch(() => undefined);
          }}
        />
      )}
    </>
  );
}
