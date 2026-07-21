'use client';

import { create } from 'zustand';

export type RightPanel =
  | { kind: 'none' }
  | { kind: 'thread'; messageId: string }
  | { kind: 'details' }
  | { kind: 'activity' }
  | { kind: 'saved' };

interface TypingEntry {
  userId: string;
  displayName: string;
  expiresAt: number;
}

interface UiState {
  rightPanel: RightPanel;
  sidebarOpen: boolean; // mobile drawer
  searchOpen: boolean;
  theme: 'light' | 'dark';
  /** containerId -> typing users */
  typing: Record<string, TypingEntry[]>;
  /** Message currently in inline-edit mode (ArrowUp shortcut). */
  editingMessageId: string | null;
  /** When true, suppress desktop notifications (Activity mute). Persisted. */
  notificationsMuted: boolean;

  setEditingMessageId: (id: string | null) => void;
  setRightPanel: (panel: RightPanel) => void;
  toggleSidebar: (open?: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setNotificationsMuted: (muted: boolean) => void;
  upsertTyping: (containerId: string, entry: TypingEntry) => void;
  removeTyping: (containerId: string, userId: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  rightPanel: { kind: 'none' },
  sidebarOpen: false,
  searchOpen: false,
  theme: 'light',
  typing: {},
  editingMessageId: null,
  notificationsMuted:
    typeof window !== 'undefined' && window.localStorage.getItem('bs.notificationsMuted') === '1',

  setEditingMessageId: (id) => set({ editingMessageId: id }),
  setNotificationsMuted: (muted) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bs.notificationsMuted', muted ? '1' : '0');
    }
    set({ notificationsMuted: muted });
  },
  setRightPanel: (panel) => set({ rightPanel: panel }),
  toggleSidebar: (open) => set((s) => ({ sidebarOpen: open ?? !s.sidebarOpen })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bs.theme', theme);
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
    set({ theme });
  },
  upsertTyping: (containerId, entry) =>
    set((s) => {
      const list = (s.typing[containerId] ?? []).filter((t) => t.userId !== entry.userId);
      return { typing: { ...s.typing, [containerId]: [...list, entry] } };
    }),
  removeTyping: (containerId, userId) =>
    set((s) => ({
      typing: {
        ...s.typing,
        [containerId]: (s.typing[containerId] ?? []).filter((t) => t.userId !== userId),
      },
    })),
}));
