'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

/** Create a poll in a channel. */
export function CreatePollDialog({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [busy, setBusy] = useState(false);

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800';

  const submit = async () => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) {
      pushToast('Add a question and at least two options.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('POST', `/channels/${channelId}/polls`, {
        question: question.trim(),
        options: opts,
        allowMultiple,
      });
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create poll', 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog title="Create a poll" onClose={onClose}>
      <input
        autoFocus
        className={`${inputCls} mb-3`}
        placeholder="Ask a question…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={inputCls}
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => setOptions((o) => o.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {options.length > 2 && (
              <button
                onClick={() => setOptions((o) => o.filter((_, j) => j !== i))}
                className="rounded p-1 text-gray-400 hover:text-red-500"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {options.length < 10 && (
        <button
          onClick={() => setOptions((o) => [...o, ''])}
          className="mt-2 flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
        >
          <Plus size={13} /> Add option
        </button>
      )}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} />
        Allow selecting multiple options
      </label>
      <button
        onClick={() => void submit()}
        disabled={busy}
        className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        data-testid="create-poll"
      >
        {busy ? 'Creating…' : 'Create poll'}
      </button>
    </Dialog>
  );
}
