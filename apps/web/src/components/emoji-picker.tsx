'use client';

import { useEffect, useRef, useState } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { useUiStore } from '@/stores/ui-store';

export function EmojiPickerPopover({
  onPick,
  onClose,
}: {
  onPick: (shortcode: string, native: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useUiStore((s) => s.theme);
  const [ready, setReady] = useState(false);

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
      <Picker
        data={data}
        theme={theme}
        previewPosition="none"
        onEmojiSelect={(emoji: { id: string; native: string }) => onPick(emoji.id, emoji.native)}
      />
    </div>
  );
}
