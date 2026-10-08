'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Check, ClipboardList, X, Zap } from 'lucide-react';
import type { WorkflowRequestDto } from '@backstages/shared';
import { useRespondToWorkflowRequest, useWorkflowRequests } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { useT } from '@/lib/i18n';

const input =
  'w-full rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';

/**
 * "Requests for you": workflow approvals and forms waiting on the viewer. Shown
 * at the top of the Tasks pane; renders nothing when there are none.
 */
export function WorkflowRequests({ workspaceId }: { workspaceId: string }) {
  const requests = useWorkflowRequests(workspaceId);
  const t = useT();
  const items = requests.data ?? [];
  if (items.length === 0) return null;
  return (
    <section data-testid="workflow-requests">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
        {t('requests_for_you')} · {items.length}
      </h2>
      <ul className="space-y-2">
        {items.map((r) => (
          <RequestCard key={r.runId} request={r} workspaceId={workspaceId} />
        ))}
      </ul>
    </section>
  );
}

function RequestCard({
  request,
  workspaceId,
}: {
  request: WorkflowRequestDto;
  workspaceId: string;
}) {
  const respond = useRespondToWorkflowRequest(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const t = useT();

  const send = (body: { decision: 'approve' | 'reject' } | { answers: Record<string, string> }) =>
    respond.mutate(
      { runId: request.runId, ...body },
      {
        onSuccess: () =>
          pushToast(
            'decision' in body
              ? body.decision === 'approve'
                ? 'Approved — the workflow continues.'
                : 'Rejected — the workflow stopped.'
              : 'Thanks — your answers were sent.',
            'success',
          ),
        onError: (err) =>
          pushToast(err instanceof Error ? err.message : 'Could not respond.', 'error'),
      },
    );

  const missing = request.fields.some((f) => f.required && !(answers[f.key] ?? '').trim());

  return (
    <li
      className="rounded-xl border border-accent/40 bg-accent/5 p-3"
      data-testid={`workflow-request-${request.runId}`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-3">
        {request.kind === 'request_approval' ? (
          <Zap size={13} className="text-accent" />
        ) : (
          <ClipboardList size={13} className="text-accent" />
        )}
        <span className="font-medium text-ink-2">{request.workflowName}</span>
        <span>· {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}</span>
        {request.expiresAt && (
          <span className="ml-auto">
            expires {formatDistanceToNow(new Date(request.expiresAt), { addSuffix: true })}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-[14px] text-ink">{request.prompt}</p>

      {request.kind === 'request_approval' ? (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => send({ decision: 'approve' })}
            disabled={respond.isPending}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            data-testid="request-approve"
          >
            <Check size={14} /> {t('approve')}
          </button>
          <button
            onClick={() => send({ decision: 'reject' })}
            disabled={respond.isPending}
            className="flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-hovered disabled:opacity-50"
            data-testid="request-reject"
          >
            <X size={14} /> {t('reject')}
          </button>
        </div>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing) send({ answers });
          }}
        >
          {request.fields.map((f) => (
            <label key={f.key} className="block text-[12px] font-medium text-ink-2">
              {f.label}
              {f.required && <span className="text-red-500"> *</span>}
              {f.kind === 'select' ? (
                <select
                  className={`${input} mt-1`}
                  value={answers[f.key] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                >
                  <option value="">{t('choose')}</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${input} mt-1`}
                  value={answers[f.key] ?? ''}
                  maxLength={2000}
                  onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
          <button
            type="submit"
            disabled={missing || respond.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            data-testid="request-submit"
          >
            {t('submit')}
          </button>
        </form>
      )}
    </li>
  );
}
