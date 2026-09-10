'use client';

import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';

/**
 * Chrome for a full-pane section (Jira, Confluence, Team timeline) that replaces
 * the chat pane. Matches MainPane's banner + scroll-body layout so the app feels
 * consistent whichever view is active.
 */
export function PaneShell({
  icon,
  title,
  subtitle,
  actions,
  children,
  bodyClassName,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-5">
        <button
          onClick={() => toggleSidebar(true)}
          className="rounded-lg p-1.5 text-ink-3 hover:bg-hovered hover:text-ink md:hidden"
          aria-label="Open sidebar"
        >
          <Menu size={18} />
        </button>
        {icon}
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="truncate text-[12px] text-ink-3">{subtitle}</p>}
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      <div className={bodyClassName ?? 'thin-scrollbar flex-1 overflow-y-auto p-6'}>{children}</div>
    </div>
  );
}
