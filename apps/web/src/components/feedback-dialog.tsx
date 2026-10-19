'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Bug, Lightbulb, MessageCircle } from 'lucide-react';
import type { FeedbackCategory } from '@backstages/shared';
import { api } from '@/lib/api';
import { track } from '@/lib/usage';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

const CATEGORIES: { value: FeedbackCategory; label: string; icon: typeof Bug; hint: string }[] = [
  { value: 'BUG', label: 'Something broke', icon: Bug, hint: 'What did you do, and what happened instead?' },
  { value: 'IDEA', label: 'Idea', icon: Lightbulb, hint: 'What would make Backstages better for you?' },
  { value: 'OTHER', label: 'Other', icon: MessageCircle, hint: 'Tell us anything.' },
];

/** "Send feedback" — goes to the workspace owners (and the admin analytics). */
export function FeedbackDialog({ workspaceId }: { workspaceId: string }) {
  const open = useUiStore((s) => s.feedbackOpen);
  const setOpen = useUiStore((s) => s.setFeedbackOpen);
  const pushToast = useUiStore((s) => s.pushToast);
  const [category, setCategory] = useState<FeedbackCategory>('BUG');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const close = () => {
    setOpen(false);
    setMessage('');
    setCategory('BUG');
  };

  const send = async () => {
    setBusy(true);
    try {
      await api('POST', `/workspaces/${workspaceId}/feedback`, {
        category,
        message: message.trim(),
        page: `${window.location.pathname}${window.location.search}`,
      });
      track('feedback:send');
      pushToast('Thanks! Your feedback was sent to the workspace owners.', 'success');
      close();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not send feedback.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const current = CATEGORIES.find((c) => c.value === category)!;
  return (
    <Dialog title="Send feedback" onClose={close}>
      <div className="flex flex-col gap-3" data-testid="feedback-dialog">
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Feedback type">
          {CATEGORIES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              role="radio"
              aria-checked={category === value}
              onClick={() => setCategory(value)}
              className={clsx(
                'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[12px] font-medium',
                category === value ? 'border-accent bg-accent/10 text-accent' : 'border-line-strong text-ink-2 hover:bg-hovered',
              )}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={4000}
          autoFocus
          placeholder={current.hint}
          className="resize-y rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
          data-testid="feedback-message"
        />
        <p className="text-[11.5px] text-ink-3">The page you&apos;re on and your browser are attached to help reproduce issues.</p>
        <div className="flex justify-end gap-2">
          <button onClick={close} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 hover:bg-hovered">
            Cancel
          </button>
          <button
            onClick={() => void send()}
            disabled={busy || message.trim().length < 3}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            data-testid="feedback-send"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
