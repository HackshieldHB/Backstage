'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageTemplateDto, MessageTemplateInput } from '@backstages/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useWorkspaces } from '@/hooks/queries';

const templatesKey = (ws: string) => ['message-templates', ws] as const;

/** Fill the template variables at insert time. Pure, so it can be tested. */
export function fillTemplate(
  content: string,
  ctx: { me: string; now?: Date; locale?: string },
): string {
  const now = ctx.now ?? new Date();
  const date = now.toLocaleDateString(ctx.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit' });
  return content
    .replace(/\{\{\s*date\s*\}\}/gi, date)
    .replace(/\{\{\s*time\s*\}\}/gi, time)
    .replace(/\{\{\s*me\s*\}\}/gi, ctx.me);
}

/**
 * The composer's Templates button: pick a saved message to insert, or save
 * a new one (from what you've typed so far). Yours are private; shared ones
 * are for the whole workspace.
 */
export function TemplatesButton({
  workspaceId,
  getDraft,
  onInsert,
}: {
  workspaceId: string;
  getDraft: () => string;
  onInsert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Templates"
        aria-label="Templates"
        aria-expanded={open}
        data-testid="templates-button"
        className="rounded-md p-1.5 text-ink-3 hover:bg-hovered hover:text-ink"
      >
        <FileText size={15} />
      </button>
      {open && (
        <TemplatesPopover
          workspaceId={workspaceId}
          getDraft={getDraft}
          onInsert={(text) => {
            onInsert(text);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function TemplatesPopover({
  workspaceId,
  getDraft,
  onInsert,
  onClose,
}: {
  workspaceId: string;
  getDraft: () => string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const lang = useUiStore((s) => s.lang);
  const pushToast = useUiStore((s) => s.pushToast);
  const workspaces = useWorkspaces();
  const isGuest = workspaces.data?.find((w) => w.id === workspaceId)?.myRole === 'GUEST';
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: templatesKey(workspaceId),
    queryFn: () => api<MessageTemplateDto[]>('GET', `/workspaces/${workspaceId}/templates`),
    staleTime: 30_000,
  });
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: MessageTemplateInput } | null>(
    null,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setTimeout(() => searchRef.current?.focus(), 0);
  }, [editing]);

  const save = useMutation({
    mutationFn: (v: { id: string | null; draft: MessageTemplateInput }) =>
      v.id
        ? api<MessageTemplateDto>('PATCH', `/templates/${v.id}`, v.draft)
        : api<MessageTemplateDto>('POST', `/workspaces/${workspaceId}/templates`, v.draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: templatesKey(workspaceId) });
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey(workspaceId) }),
    onError: (err) =>
      pushToast(err instanceof Error ? err.message : 'Couldn’t delete the template.', 'error'),
  });

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (templates.data ?? []).filter(
      (t) =>
        !needle ||
        t.name.toLowerCase().includes(needle) ||
        t.content.toLowerCase().includes(needle),
    );
  }, [templates.data, query]);
  const mine = list.filter((t) => t.owner.id === me?.id && !t.shared);
  const shared = list.filter((t) => t.shared);

  const insert = (t: MessageTemplateDto) =>
    onInsert(
      fillTemplate(t.content, {
        me: me?.displayName ?? '',
        locale: lang === 'id' ? 'id-ID' : undefined,
      }),
    );

  return (
    <div
      className="absolute bottom-full left-0 z-40 mb-2 w-[min(340px,calc(100vw-48px))] rounded-xl border border-line bg-overlay shadow-pop"
      data-testid="templates-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (editing) setEditing(null);
          else onClose();
        }
      }}
    >
      {editing ? (
        <form
          className="space-y-2.5 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(editing);
          }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">
              {editing.id ? 'Edit template' : 'New template'}
            </p>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="icon-btn p-1"
              aria-label="Back"
            >
              <X size={14} />
            </button>
          </div>
          <input
            autoFocus
            value={editing.draft.name}
            onChange={(e) =>
              setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })
            }
            placeholder="Name, e.g. Daily standup"
            maxLength={80}
            required
            className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none focus:border-accent"
            data-testid="template-name"
          />
          <textarea
            value={editing.draft.content}
            onChange={(e) =>
              setEditing({ ...editing, draft: { ...editing.draft, content: e.target.value } })
            }
            placeholder={'Yesterday:\nToday:\nBlockers:'}
            maxLength={4000}
            required
            rows={6}
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            data-testid="template-content"
          />
          <p className="text-[11.5px] text-ink-3">
            Use <code className="rounded bg-hovered px-1">{'{{date}}'}</code>,{' '}
            <code className="rounded bg-hovered px-1">{'{{time}}'}</code> and{' '}
            <code className="rounded bg-hovered px-1">{'{{me}}'}</code> — they’re filled in when you
            insert it.
          </p>
          {!isGuest && (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={editing.draft.shared ?? false}
                onChange={(e) =>
                  setEditing({ ...editing, draft: { ...editing.draft, shared: e.target.checked } })
                }
                data-testid="template-shared"
              />
              Share with the whole workspace
            </label>
          )}
          {save.error && (
            <p className="text-[12.5px] text-red-600 dark:text-red-400">
              {save.error instanceof Error ? save.error.message : 'Couldn’t save.'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="btn-secondary px-3 py-1.5 text-[12.5px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="btn-primary px-3 py-1.5 text-[12.5px]"
              data-testid="template-save"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={14} className="shrink-0 text-ink-3" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates"
              className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          <div className="thin-scrollbar max-h-72 overflow-y-auto p-1.5">
            {templates.isLoading ? (
              <p className="px-2 py-3 text-[12.5px] text-ink-3">Loading…</p>
            ) : list.length === 0 ? (
              <p className="px-2 py-4 text-center text-[12.5px] text-ink-3">
                {query ? 'No templates match.' : 'No templates yet — save one you send often.'}
              </p>
            ) : (
              <>
                <Group
                  title="Yours"
                  items={mine}
                  onInsert={insert}
                  onEdit={startEdit}
                  onDelete={(t) => remove.mutate(t.id)}
                />
                <Group
                  title="Shared with the workspace"
                  icon
                  items={shared}
                  onInsert={insert}
                  onEdit={startEdit}
                  onDelete={(t) => remove.mutate(t.id)}
                />
              </>
            )}
          </div>
          <div className="border-t border-line p-1.5">
            <button
              onClick={() =>
                setEditing({
                  id: null,
                  draft: { name: '', content: getDraft().trim(), shared: false },
                })
              }
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-accent hover:bg-hovered"
              data-testid="template-new"
            >
              <Plus size={14} />{' '}
              {getDraft().trim() ? 'Save your draft as a template' : 'New template'}
            </button>
          </div>
        </>
      )}
    </div>
  );

  function startEdit(t: MessageTemplateDto) {
    setEditing({ id: t.id, draft: { name: t.name, content: t.content, shared: t.shared } });
  }
}

function Group({
  title,
  icon,
  items,
  onInsert,
  onEdit,
  onDelete,
}: {
  title: string;
  icon?: boolean;
  items: MessageTemplateDto[];
  onInsert: (t: MessageTemplateDto) => void;
  onEdit: (t: MessageTemplateDto) => void;
  onDelete: (t: MessageTemplateDto) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1">
      <p className="flex items-center gap-1 px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
        {icon && <Users size={11} />} {title}
      </p>
      <ul>
        {items.map((t) => (
          <li key={t.id} className="group relative">
            <button
              onClick={() => onInsert(t)}
              className="block w-full rounded-lg px-2 py-1.5 pr-14 text-left hover:bg-hovered"
              data-testid={`template-${t.name}`}
            >
              <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
              <span className="block truncate text-[11.5px] text-ink-3">
                {t.content.replace(/\s+/g, ' ')}
              </span>
            </button>
            {t.canManage && (
              <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 gap-0.5 group-hover:flex">
                <button
                  onClick={() => onEdit(t)}
                  className="icon-btn p-1"
                  aria-label={`Edit ${t.name}`}
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => onDelete(t)}
                  className="icon-btn p-1 hover:text-red-500"
                  aria-label={`Delete ${t.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
