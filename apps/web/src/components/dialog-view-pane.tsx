'use client';

import { BarChart3, CalendarClock, Clock, LineChart, Zap } from 'lucide-react';
import type { ConversationDto } from '@backstages/shared';
import type { ChannelWithMeta } from '@/hooks/queries';
import { InlineDialogHost } from './dialog';
import { PaneShell } from './pane-shell';
import { WeeklyReportsDialog } from './weekly-reports-dialog';
import { WorkflowsDialog } from './workflows-dialog';
import { ScheduledDialog } from './scheduled-dialog';
import { StandupsDialog } from './standups-dialog';
import { AnalyticsDialog } from './workspace-admin';

export type DialogView = 'weekly-reports' | 'analytics' | 'workflows' | 'scheduled' | 'standups';

/** Titles match each dialog's own title, so the inline host doesn't repeat it. */
const META: Record<DialogView, { title: string; icon: React.ReactNode }> = {
  'weekly-reports': {
    title: 'Weekly reports',
    icon: <BarChart3 size={18} className="text-accent" />,
  },
  analytics: {
    title: 'Workspace analytics',
    icon: <LineChart size={18} className="text-accent" />,
  },
  workflows: { title: 'Workflows', icon: <Zap size={18} className="text-accent" /> },
  scheduled: { title: 'Scheduled messages', icon: <Clock size={18} className="text-accent" /> },
  standups: { title: 'Standups', icon: <CalendarClock size={18} className="text-accent" /> },
};

const noop = () => {};

/**
 * A Reports / Automations tab whose content is one of the workspace dialogs,
 * shown in place (the dialog renders inline inside InlineDialogHost) so the
 * feature itself is exactly the same as before.
 */
export function DialogViewPane({
  view,
  workspaceId,
  channels,
  conversations,
  isAdmin,
}: {
  view: DialogView;
  workspaceId: string;
  channels: ChannelWithMeta[];
  conversations: ConversationDto[];
  isAdmin: boolean;
}) {
  const meta = META[view];
  return (
    <PaneShell icon={meta.icon} title={meta.title}>
      <InlineDialogHost label={meta.title}>
        <div className="mx-auto max-w-3xl">
          {view === 'weekly-reports' && (
            <WeeklyReportsDialog workspaceId={workspaceId} channels={channels} onClose={noop} />
          )}
          {view === 'analytics' && <AnalyticsDialog workspaceId={workspaceId} onClose={noop} />}
          {view === 'workflows' && (
            <WorkflowsDialog
              workspaceId={workspaceId}
              channels={channels}
              canManage={isAdmin}
              onClose={noop}
            />
          )}
          {view === 'scheduled' && (
            <ScheduledDialog
              workspaceId={workspaceId}
              channels={channels}
              conversations={conversations}
              onClose={noop}
            />
          )}
          {view === 'standups' && (
            <StandupsDialog workspaceId={workspaceId} channels={channels} onClose={noop} />
          )}
        </div>
      </InlineDialogHost>
    </PaneShell>
  );
}
