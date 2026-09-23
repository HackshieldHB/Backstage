'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronRight, ClipboardCheck, FileText, Loader2, Sparkles, Trash2 } from 'lucide-react';
import type { Container } from '@/hooks/queries';
import {
  useAiStatus,
  useActionItemToDecision,
  useDeleteMeetingRecord,
  useGenerateMinutes,
  useMeetingRecord,
  useMeetingRecords,
} from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}
function durationLabel(startIso: string, endIso: string): string {
  const mins = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

export function MeetingHistoryDialog({
  container,
  onClose,
}: {
  container: Container;
  workspaceId: string;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const records = useMeetingRecords(container);

  return (
    <Dialog title={selectedId ? 'Meeting minutes' : 'Meeting history'} onClose={onClose}>
      {selectedId ? (
        <MeetingDetail id={selectedId} container={container} onBack={() => setSelectedId(null)} />
      ) : (
        <div className="min-w-[320px]">
          {records.isLoading ? (
            <p className="py-6 text-center text-sm text-ink-3">Loading…</p>
          ) : (records.data?.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">
              No recorded meetings yet. Turn on live captions in a huddle and its transcript will be
              saved here when it ends.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {records.data!.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-hovered"
                  >
                    <FileText size={16} className="shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                        {when(r.startedAt)}
                        <span className="text-[11px] font-normal text-ink-3">· {durationLabel(r.startedAt, r.endedAt)}</span>
                        {r.hasMinutes && (
                          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">Minutes</span>
                        )}
                      </div>
                      <div className="truncate text-[12px] text-ink-3">
                        {r.summaryPreview ?? `${r.lineCount} transcript line${r.lineCount === 1 ? '' : 's'}`}
                        {r.actionItemCount > 0 && ` · ${r.actionItemCount} action item${r.actionItemCount === 1 ? '' : 's'}`}
                      </div>
                    </div>
                    <ChevronRight size={15} className="shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

function MeetingDetail({ id, container, onBack }: { id: string; container: Container; onBack: () => void }) {
  const record = useMeetingRecord(id);
  const ai = useAiStatus();
  const generate = useGenerateMinutes(container);
  const toDecision = useActionItemToDecision();
  const del = useDeleteMeetingRecord(container);
  const pushToast = useUiStore((s) => s.pushToast);
  const [showTranscript, setShowTranscript] = useState(false);

  const r = record.data;

  return (
    <div className="min-w-[340px] max-w-lg">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-ink-2 hover:bg-hovered">
          <ArrowLeft size={14} /> Back
        </button>
        <span className="flex-1" />
        {r && (
          <button
            onClick={() =>
              del.mutate(r.id, {
                onSuccess: () => { pushToast('Meeting record deleted.', 'success'); onBack(); },
              })
            }
            title="Delete this meeting record"
            className="rounded p-1 text-ink-3 hover:bg-red-500/10 hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {!r ? (
        <p className="py-6 text-center text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-[12px] text-ink-3">
            {when(r.startedAt)} · {durationLabel(r.startedAt, r.endedAt)} · {r.transcript.length} lines
          </p>

          {!r.hasMinutes ? (
            <div className="rounded-lg border border-line bg-elevated p-3 text-center">
              <p className="mb-2 text-[13px] text-ink-2">No minutes yet.</p>
              {ai.data?.enabled ? (
                <button
                  onClick={() =>
                    generate.mutate(r.id, {
                      onError: () => pushToast('Could not generate minutes.', 'error'),
                    })
                  }
                  disabled={generate.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {generate.isPending ? 'Generating…' : 'Generate AI minutes'}
                </button>
              ) : (
                <p className="text-[12px] text-ink-3">AI is not configured in this workspace.</p>
              )}
            </div>
          ) : (
            <>
              {r.summary && (
                <Section title="Summary">
                  <div className="whitespace-pre-wrap text-[13px] text-ink">{r.summary}</div>
                </Section>
              )}
              {r.decisions.length > 0 && (
                <Section title="Decisions">
                  <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink">
                    {r.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </Section>
              )}
              {r.actionItems.length > 0 && (
                <Section title="Action items">
                  <ul className="space-y-1.5">
                    {r.actionItems.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-ink">
                        <span className="flex-1">{item}</span>
                        {container.kind === 'channel' && (
                          <button
                            onClick={() =>
                              toDecision.mutate(
                                { id: r.id, index: i },
                                {
                                  onSuccess: () => pushToast('Added to Decisions.', 'success'),
                                  onError: () => pushToast('Could not add to Decisions.', 'error'),
                                },
                              )
                            }
                            title="Turn into a Decision"
                            className="flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-hovered"
                          >
                            <ClipboardCheck size={12} /> Decision
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {ai.data?.enabled && (
                <button
                  onClick={() => generate.mutate(r.id)}
                  disabled={generate.isPending}
                  className="text-[12px] font-medium text-accent hover:underline disabled:opacity-50"
                >
                  {generate.isPending ? 'Regenerating…' : 'Regenerate minutes'}
                </button>
              )}
            </>
          )}

          <div>
            <button onClick={() => setShowTranscript((v) => !v)} className="text-[12px] font-medium text-ink-2 hover:underline">
              {showTranscript ? 'Hide transcript' : `Show transcript (${r.transcript.length})`}
            </button>
            {showTranscript && (
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-elevated p-2 text-[12px]">
                {r.transcript.length === 0 && <p className="text-ink-3">No transcript captured.</p>}
                {r.transcript.map((l, i) => (
                  <p key={i}>
                    <span className="font-semibold text-ink-2">{l.name}</span>
                    {l.kind === 'chat' && <span className="text-ink-3"> (chat)</span>}
                    <span className="text-ink-3">: </span>
                    <span className="text-ink">{l.text}</span>
                  </p>
                ))}
              </div>
            )}
            {r.notes && (
              <div className="mt-2 rounded-lg border border-line bg-elevated p-2 text-[12px]">
                <div className="mb-1 font-semibold text-ink-2">Shared notes</div>
                <div className="whitespace-pre-wrap text-ink">{r.notes}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </div>
  );
}
