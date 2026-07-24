'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import clsx from 'clsx';

export interface SuggestionItem {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** Keyboard-navigable list rendered under the caret for @ and : autocomplete. */
export const SuggestionList = forwardRef<
  SuggestionListHandle,
  { items: SuggestionItem[]; command: (item: SuggestionItem) => void }
>(function SuggestionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (items[selected]) command(items[selected]);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;
  return (
    <div className="max-h-56 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() => command(item)}
          onMouseEnter={() => setSelected(i)}
          data-testid={`suggestion-${item.label}`}
          className={clsx(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
            i === selected ? 'bg-accent text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-700',
          )}
        >
          {item.icon}
          <span className="font-medium">{item.label}</span>
          {item.hint && (
            <span className={clsx('ml-auto truncate text-xs', i === selected ? 'text-white/70' : 'text-gray-500 dark:text-gray-400')}>
              {item.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
});
