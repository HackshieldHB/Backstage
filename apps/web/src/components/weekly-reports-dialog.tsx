'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { BarChart3, Eye, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ChannelDto,
  CreateWeeklyReportInput,
  WeeklyReportDto,
  WeeklyReportPreviewDto,
} from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useWeeklyReports } from '@/hooks/queries';
import { Dialog } from './dialog';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const input =
  'w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

export function WeeklyReportsDialog({
  workspaceId,
  channels,
  onClose,
}: {
  workspaceId: string;
  channels: ChannelDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const reports = useWeeklyReports(workspaceId);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [dayOfWeek, setDayOfWeek] = useState(5);
  const [timeOfDay, setTimeOfDay] = useState('16:00');

  const create = async () => {
    if (!channelId) return;
    const body: CreateWeeklyReportInput = {
      channelId,
      dayOfWeek,
      timeOfDay,
      tzOffsetMin: -new Date().getTimezoneOffset(),
    };
    await api('POST', `/workspaces/${workspaceId}/weekly-reports`, body);
    await qc.invalidateQueries({ queryKey: keys.weeklyReports(workspaceId) });
  };

  return (
    <Dialog title="Weekly reports" onClose={onClose} wide>
      <p className="mb-3 text-sm text-gray-500">
        An automated digest — messages, meeting time, decisions and standups from the past 7 days — posted to a channel each week.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line p-3 dark:border-line">
        <label className="text-xs text-gray-500">
          Channel
          <select className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Day
          <select className={input} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
            {DAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Time
          <input type="time" className={input} value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
        </label>
        <button onClick={() => void create()} className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover" data-testid="create-report">
          <Plus size={14} /> Add
        </button>
      </div>

      <ul className="space-y-2">
        {(reports.data ?? []).map((r) => (
          <ReportRow key={r.id} report={r} channels={channels} workspaceId={workspaceId} />
        ))}
        {reports.isSuccess && reports.data.length === 0 && (
          <li className="rounded-lg border border-dashed border-line-strong py-6 text-center text-sm text-gray-500 dark:border-line">
            No scheduled reports yet.
          </li>
        )}
      </ul>
    </Dialog>
  );
}

function ReportRow({
  report,
  channels,
  workspaceId,
}: {
  report: WeeklyReportDto;
  channels: ChannelDto[];
  workspaceId: string;
}) {
  const qc = useQueryClient();
  const channel = channels.find((c) => c.id === report.channelId);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<WeeklyReportPreviewDto | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const runNow = async () => {
    setRunning(true);
    try {
      await api('POST', `/weekly-reports/${report.id}/run`);
    } finally {
      setRunning(false);
    }
  };
  const loadPreview = async () => {
    if (preview) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      setPreview(await api<WeeklyReportPreviewDto>('GET', `/weekly-reports/${report.id}/preview`));
    } finally {
      setPreviewing(false);
    }
  };
  const toggle = async () => {
    await api('PATCH', `/weekly-reports/${report.id}`, { active: !report.active });
    await qc.invalidateQueries({ queryKey: keys.weeklyReports(workspaceId) });
  };
  const remove = async () => {
    await api('DELETE', `/weekly-reports/${report.id}`);
    await qc.invalidateQueries({ queryKey: keys.weeklyReports(workspaceId) });
  };

  return (
    <li className="rounded-lg border border-line px-3 py-2 dark:border-line">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <BarChart3 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">#{channel?.name ?? 'channel'}</div>
          <div className="text-xs text-gray-500">
            {DAYS[report.dayOfWeek]} · {report.timeOfDay}
            {!report.active && ' · paused'}
          </div>
        </div>
        <button onClick={() => void loadPreview()} disabled={previewing} title="Preview draft" className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-accent dark:hover:bg-gray-800" data-testid="preview-report">
          <Eye size={14} />
        </button>
        <button onClick={() => void runNow()} disabled={running} title="Post now" className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-accent dark:hover:bg-gray-800">
          <Play size={14} />
        </button>
        <button onClick={() => void toggle()} className={clsx('rounded px-2 py-0.5 text-xs font-medium', report.active ? 'text-gray-500 hover:bg-hovered' : 'text-accent')}>
          {report.active ? 'Pause' : 'Resume'}
        </button>
        <button onClick={() => void remove()} className="rounded p-1 text-gray-400 hover:text-red-600">
          <Trash2 size={13} />
        </button>
      </div>
      {preview && (
        <div className="mt-2 rounded-md bg-gray-50 p-2.5 dark:bg-gray-800/50" data-testid="report-preview">
          {preview.aiGenerated && (
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-accent">
              <Sparkles size={11} /> AI-drafted preview
            </div>
          )}
          <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 dark:text-gray-200">{preview.text}</pre>
        </div>
      )}
    </li>
  );
}
