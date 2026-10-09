'use client';

import { useState } from 'react';
import { MailCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';

/**
 * Nudges people who haven't confirmed their address. Invites sent to a specific
 * email can only be accepted once it's confirmed.
 */
export function VerifyEmailBanner() {
  const user = useAuthStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const [hidden, setHidden] = useState(false);
  const [sending, setSending] = useState(false);
  if (!user || user.emailVerified !== false || hidden) return null;

  const resend = async () => {
    setSending(true);
    try {
      const res = await api<{ sent: boolean }>('POST', '/auth/verify-email/send');
      pushToast(res.sent ? `We sent a new link to ${user.email}.` : 'Your email is already confirmed.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not send the email', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      role="status"
      data-testid="verify-email-banner"
    >
      <MailCheck size={15} className="shrink-0" />
      <span className="min-w-0 truncate">
        Confirm your email address — we sent a link to <b>{user.email}</b>.
      </span>
      <button onClick={() => void resend()} disabled={sending} className="font-semibold underline disabled:opacity-50">
        {sending ? 'Sending…' : 'Resend'}
      </button>
      <button onClick={() => setHidden(true)} className="ml-auto rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
