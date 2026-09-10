'use client';

import { useState } from 'react';
import { Dialog } from './dialog';

/** Themed replacement for window.confirm. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{body}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          data-testid="confirm-dialog-confirm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${
            danger ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-hover'
          }`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/** Themed replacement for window.prompt (single-line or multi-line text input). */
export function PromptDialog({
  title,
  label,
  placeholder,
  confirmLabel = 'Submit',
  multiline,
  onSubmit,
  onClose,
}: {
  title: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  multiline?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputCls =
    'w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

  const submit = async () => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onSubmit(v);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose}>
      {label && <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>}
      {multiline ? (
        <textarea
          autoFocus
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className={`${inputCls} mb-3 resize-y`}
          data-testid="prompt-dialog-input"
        />
      ) : (
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          className={`${inputCls} mb-3`}
          data-testid="prompt-dialog-input"
        />
      )}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="prompt-dialog-submit"
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
