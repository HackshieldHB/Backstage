'use client';

import { useEffect, useRef, useState } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { Settings2 } from 'lucide-react';
import { fileUrl } from '@/lib/api';
import { useCustomEmoji } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { EmojiManagerDialog } from './custom-emoji';

export function EmojiPickerPopover({
  onPick,
  onClose,
  workspaceId,
}: {
  onPick: (shortcode: string, native: string) => void;
  onClose: () => void;
  /** When set, a strip of this workspace's custom emoji is shown above the picker. */
  workspaceId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useUiStore((s) => s.theme);
  const [ready, setReady] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const custom = useCustomEmoji(workspaceId ?? '');

  useEffect(() => {
    setReady(true);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!ready) return null;
  return (
    <div ref={ref} className="absolute bottom-full right-0 z-50 mb-1">
      {workspaceId && (
        <div className="mb-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Custom
            </span>
            <button
              onClick={() => setManageOpen(true)}
              className="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              data-testid="manage-custom-emoji"
            >
              <Settings2 size={11} /> Manage
            </button>
          </div>
          {(custom.data ?? []).length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-gray-400">No custom emoji yet.</p>
          ) : (
            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
              {(custom.data ?? []).map((e) => (
                <button
                  key={e.id}
                  onClick={() => onPick(e.name, e.name)}
                  title={`:${e.name}:`}
                  className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <img src={fileUrl(e.url)} alt={e.name} className="h-6 w-6 object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <Picker
        data={data}
        theme={theme}
        previewPosition="none"
        onEmojiSelect={(emoji: { id: string; native: string }) => onPick(emoji.id, emoji.native)}
      />
      {manageOpen && workspaceId && (
        <EmojiManagerDialog workspaceId={workspaceId} onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
}
