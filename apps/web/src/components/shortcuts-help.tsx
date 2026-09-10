'use client';

import { useEffect, useState } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

/**
 * A keyboard-shortcut cheatsheet toggled with "?" (ignored while typing). Pairs
 * naturally with the onboarding tour for discoverability.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const lang = useUiStore((s) => s.lang);
  const id = lang === 'id';
  const [mod, setMod] = useState('⌘');

  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    setMod(mac ? '⌘' : 'Ctrl');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const editable =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '?' && !editable) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const rows: { keys: string[]; label: string }[] = [
    { keys: [mod, 'K'], label: id ? 'Cari pesan, orang & file' : 'Search messages, people & files' },
    { keys: ['Esc'], label: id ? 'Tutup panel / tandai sudah dibaca' : 'Close panel / mark as read' },
    { keys: ['↑'], label: id ? 'Edit pesan terakhir (composer kosong)' : 'Edit your last message (empty composer)' },
    { keys: ['?'], label: id ? 'Tampilkan pintasan ini' : 'Show this cheatsheet' },
  ];

  return (
    <Dialog title={id ? 'Pintasan keyboard' : 'Keyboard shortcuts'} onClose={() => setOpen(false)}>
      <ul className="divide-y divide-line dark:divide-line">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-gray-700 dark:text-gray-200">{row.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.keys.map((k) => (
                <kbd
                  key={k}
                  className="rounded-md border border-line-strong bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:border-line-strong dark:bg-gray-800 dark:text-gray-300"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
