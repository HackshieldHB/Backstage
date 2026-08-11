'use client';

import { create } from 'zustand';

export type RightPanel =
  | { kind: 'none' }
  | { kind: 'thread'; messageId: string; from?: 'threads' }
  | { kind: 'threads' }
  | { kind: 'canvas' }
  | { kind: 'details' }
  | { kind: 'activity' }
  | { kind: 'saved' };

/** Which full-pane view fills the main area. 'chat' shows channels/DMs; the
 *  others are dedicated Atlassian / insights sections that replace the chat pane. */
export type MainView = 'chat' | 'jira' | 'confluence' | 'timeline';

interface TypingEntry {
  userId: string;
  displayName: string;
  expiresAt: number;
}

export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface UiState {
  rightPanel: RightPanel;
  mainView: MainView;
  sidebarOpen: boolean; // mobile drawer
  searchOpen: boolean;
  theme: 'light' | 'dark';
  /** containerId -> typing users */
  typing: Record<string, TypingEntry[]>;
  /** Message currently in inline-edit mode (ArrowUp shortcut). */
  editingMessageId: string | null;
  /** When true, suppress desktop notifications (Activity mute). Persisted. */
  notificationsMuted: boolean;
  /** UI language. Persisted. */
  lang: 'en' | 'id';
  setLang: (lang: 'en' | 'id') => void;
  /** Transient toast notifications. */
  toasts: Toast[];

  pushToast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  setEditingMessageId: (id: string | null) => void;
  setRightPanel: (panel: RightPanel) => void;
  setMainView: (view: MainView) => void;
  toggleSidebar: (open?: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setNotificationsMuted: (muted: boolean) => void;
  upsertTyping: (containerId: string, entry: TypingEntry) => void;
  removeTyping: (containerId: string, userId: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  rightPanel: { kind: 'none' },
  mainView: 'chat',
  sidebarOpen: false,
  searchOpen: false,
  theme: 'light',
  typing: {},
  editingMessageId: null,
  notificationsMuted:
    typeof window !== 'undefined' && window.localStorage.getItem('bs.notificationsMuted') === '1',
  lang:
    typeof window !== 'undefined' && window.localStorage.getItem('bs.lang') === 'id' ? 'id' : 'en',
  setLang: (lang) => {
    if (typeof window !== 'undefined') window.localStorage.setItem('bs.lang', lang);
    set({ lang });
  },
  toasts: [],

  pushToast: (message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 5000);
    }
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setEditingMessageId: (id) => set({ editingMessageId: id }),
  setNotificationsMuted: (muted) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bs.notificationsMuted', muted ? '1' : '0');
    }
    set({ notificationsMuted: muted });
  },
  setRightPanel: (panel) => set({ rightPanel: panel }),
  setMainView: (view) => set({ mainView: view }),
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
