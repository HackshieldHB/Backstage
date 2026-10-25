'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, type LucideIcon } from 'lucide-react';
import { AuthStage } from './auth-stage';

/** Secondary auth actions (social, SSO, Atlassian): same height as the inputs. */
export const altButton =
  'flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-ink shadow-soft transition hover:-translate-y-px hover:bg-hovered disabled:opacity-50';

/**
 * Split layout for the sign-in / sign-up family: the stage on the left (a
 * short banner on phones), the form on the right in the page's own theme.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <AuthStage />
      <section className="flex justify-center px-4 pb-12 pt-8 sm:px-8 lg:min-h-screen lg:items-center lg:py-12">
        <div className="auth-enter w-full max-w-[400px]">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-ink-2">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </section>
    </main>
  );
}

/**
 * Labelled input. Email and password fields get their icon automatically;
 * password fields also get a show/hide toggle. `hint` renders under the input.
 */
export function Field({
  label,
  icon,
  hint,
  ...props
}: { label: string; icon?: LucideIcon; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [reveal, setReveal] = useState(false);
  const isPassword = props.type === 'password';
  const Icon = icon ?? (props.type === 'email' ? Mail : isPassword ? Lock : undefined);
  return (
    <div className="mb-4">
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
        <span className="group relative flex items-center">
          {Icon && (
            <Icon
              size={16}
              aria-hidden
              className="pointer-events-none absolute left-3.5 text-ink-3 transition-colors group-focus-within:text-accent"
            />
          )}
          <input
            {...props}
            type={isPassword && reveal ? 'text' : props.type}
            className={clsx(
              'h-11 w-full rounded-lg border border-line-strong bg-surface text-sm text-ink shadow-soft outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-4 focus:ring-accent/15',
              Icon ? 'pl-10' : 'pl-3.5',
              isPassword ? 'pr-11' : 'pr-3.5',
            )}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              className="absolute right-1.5 rounded-md p-2 text-ink-3 transition hover:bg-hovered hover:text-ink"
            >
              {reveal ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
            </button>
          )}
        </span>
      </label>
      {hint}
    </div>
  );
}

export function SubmitButton({
  children,
  disabled,
  busy,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button type="submit" disabled={disabled || busy} className="auth-submit mt-1">
      {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      key={message}
      role="alert"
      className="auth-error mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

const STRENGTH = [
  { label: 'Too short', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  { label: 'Weak', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  { label: 'Fair', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  { label: 'Good', bar: 'bg-lime-500', text: 'text-lime-600 dark:text-lime-400' },
  { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
];

/** 0 = under 8 chars, then 1–4 by length ≥ 12, mixed case, digits and symbols. */
export function passwordLevel(password: string): number {
  if (password.length < 8) return 0;
  const extras = [
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  return 1 + Math.min(3, extras);
}

/** Four-segment meter for new passwords (shows a tip until something is typed). */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) {
    return <p className="mt-1.5 text-xs text-ink-3">Use 8+ characters with a mix of letters, numbers &amp; symbols.</p>;
  }
  const level = passwordLevel(password);
  const tone = STRENGTH[level];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={clsx(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              n <= Math.max(1, level) ? tone.bar : 'bg-line-strong',
            )}
          />
        ))}
      </div>
      <p className={clsx('mt-1.5 text-xs font-medium', tone.text)}>{tone.label}</p>
    </div>
  );
}
