'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarClock,
  LayoutGrid,
  Clock,
  FileText,
  Inbox,
  type LucideIcon,
  MessageCircleQuestion,
  MessagesSquare,
  Palette,
  Search,
  Siren,
  Sparkles,
  SquareKanban,
  Users,
  Webhook,
  Workflow,
} from 'lucide-react';
import { ACCENTS, ACCENT_LABEL, ACCENT_SWATCH, useUiStore } from '@/stores/ui-store';
import type { MainView } from '@/stores/ui-store';

interface Cmd {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  keywords?: string;
  swatch?: string;
  run: () => void;
}

/** Opens one of the Sidebar's dialogs by name (reuses its existing bs:open-dialog listener). */
function openTool(key: string) {
  window.dispatchEvent(new CustomEvent('bs:open-dialog', { detail: key }));
}

export function CommandPalette() {
  const { commandOpen, setCommandOpen, setMainView, setSearchOpen, setAccent } = useUiStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd/Ctrl-K to toggle. Capture phase + stopImmediatePropagation so the
  // browser's own Ctrl-K (focus address bar) never wins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === 'k' || e.key === 'K' || e.code === 'KeyK';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setCommandOpen(!useUiStore.getState().commandOpen);
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [setCommandOpen]);

  useEffect(() => {
    if (commandOpen) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [commandOpen]);

  const commands = useMemo<Cmd[]>(() => {
    const go = (view: MainView) => () => {
      setMainView(view);
      setCommandOpen(false);
    };
    const tool = (key: string) => () => {
      openTool(key);
      setCommandOpen(false);
    };
    const views: Cmd[] = [
      { id: 'v-inbox', label: 'Open Inbox', group: 'Navigate', icon: Inbox, keywords: 'assigned threads activity mentions todo', run: go('inbox') },
      { id: 'v-chat', label: 'Go to Chat', group: 'Navigate', icon: MessagesSquare, keywords: 'channels messages', run: go('chat') },
      { id: 'v-jira', label: 'Open Jira', group: 'Navigate', icon: SquareKanban, keywords: 'issues dashboard gadgets sprint alerts', run: go('jira') },
      { id: 'v-confluence', label: 'Open Confluence', group: 'Navigate', icon: FileText, keywords: 'pages wiki spaces', run: go('confluence') },
      { id: 'v-timeline', label: 'Open Team timeline', group: 'Navigate', icon: BarChart3, keywords: 'activity utilization', run: go('timeline') },
      { id: 'v-projects', label: 'Open Clients & Projects', group: 'Navigate', icon: Briefcase, keywords: 'billability margin revenue budget', run: go('projects') },
      { id: 'v-incidents', label: 'Open Incidents', group: 'Navigate', icon: Siren, keywords: 'oncall on-call sev outage postmortem', run: go('incidents') },
      { id: 'v-applications', label: 'Open Applications', group: 'Navigate', icon: LayoutGrid, keywords: 'apps hub tools miro launchdarkly atlassian datadog salesforce status monitoring', run: go('applications') },
      { id: 'search', label: 'Search messages, files & people…', group: 'Navigate', icon: Search, keywords: 'find', run: () => { setSearchOpen(true); setCommandOpen(false); } },
    ];
    const ask: Cmd = {
      id: 'ask',
      label: 'Ask Backstages…',
      group: 'Navigate',
      icon: MessageCircleQuestion,
      keywords: 'ai question knowledge search decisions answer',
      run: () => { window.dispatchEvent(new Event('bs:ask')); setCommandOpen(false); },
    };
    const tools: Cmd[] = [
      { id: 't-standups', label: 'Standups', group: 'Work', icon: CalendarClock, run: tool('standups') },
      { id: 't-weekly', label: 'Weekly reports', group: 'Work', icon: BarChart3, run: tool('weekly-reports') },
      { id: 't-workflows', label: 'Workflows', group: 'Work', icon: Workflow, run: tool('workflows') },
      { id: 't-scheduled', label: 'Scheduled messages', group: 'Work', icon: Clock, run: tool('scheduled') },
      { id: 't-catchup', label: 'Catch me up', group: 'Work', icon: Sparkles, run: tool('catch-up') },
      { id: 't-integrations', label: 'Integrations', group: 'Workspace', icon: Webhook, run: tool('integrations') },
      { id: 't-groups', label: 'User groups', group: 'Workspace', icon: Users, run: tool('user-groups') },
      { id: 't-analytics', label: 'Analytics', group: 'Workspace', icon: BarChart3, run: tool('analytics') },
      { id: 't-audit', label: 'Audit log', group: 'Workspace', icon: Bell, run: tool('audit') },
    ];
    const appearance: Cmd[] = ACCENTS.map((a) => ({
      id: `ac-${a}`,
      label: `Theme: ${ACCENT_LABEL[a]}`,
      group: 'Appearance',
      icon: Palette,
      keywords: 'color accent sidebar light dark mode',
      swatch: ACCENT_SWATCH[a],
      run: () => { setAccent(a); setCommandOpen(false); },
    }));
    return [ask, ...views, ...tools, ...appearance];
  }, [setMainView, setCommandOpen, setSearchOpen, setAccent]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + ' ' + (c.keywords ?? '') + ' ' + c.group).toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered, active]);

  if (!commandOpen) return null;

  const run = (i: number) => filtered[i]?.run();

  // Render grouped, but keep a flat index for keyboard nav.
  let flat = -1;
  const groups = [...new Set(filtered.map((c) => c.group))];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCommandOpen(false);
      }}
    >
      <div className="animate-fade-in w-full max-w-lg overflow-hidden rounded-xl border border-line bg-white shadow-2xl dark:border-line dark:bg-gray-900">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 dark:border-line">
          <Search size={16} className="text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(active); }
              else if (e.key === 'Escape') setCommandOpen(false);
            }}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            data-testid="command-input"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-gray-400 dark:border-line">Esc</kbd>
        </div>

        <div className="thin-scrollbar max-h-[52vh] overflow-y-auto p-1.5">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{g}</div>
              {filtered
                .filter((c) => c.group === g)
                .map((c) => {
                  flat += 1;
                  const idx = flat;
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(idx)}
                      className={clsx(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px]',
                        active === idx ? 'bg-accent/10 text-accent' : 'text-gray-700 dark:text-gray-200',
                      )}
                      data-testid="command-item"
                    >
                      {c.swatch ? (
                        <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: c.swatch }} />
                      ) : (
                        <Icon size={15} className="shrink-0 text-gray-400" />
                      )}
                      <span className="flex-1 truncate">{c.label}</span>
                    </button>
                  );
                })}
            </div>
          ))}
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-gray-400">No matching commands.</p>}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-gray-400 dark:border-line">
          <span><kbd className="font-sans">↑↓</kbd> navigate</span>
          <span><kbd className="font-sans">↵</kbd> select</span>
          <span className="ml-auto"><kbd className="font-sans">⌘/Ctrl K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
