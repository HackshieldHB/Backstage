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
export type MainView = 'chat' | 'jira' | 'confluence' | 'timeline' | 'projects' | 'incidents' | 'inbox' | 'discover';

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

/** Complete theme presets — each defines a full tinted neutral ramp, accent and
 *  sidebar, and whether it is a light or dark theme. See globals.css. */
export const ACCENTS = ['daylight', 'linen', 'midnight', 'obsidian', 'forest', 'dusk'] as const;
export type AccentId = (typeof ACCENTS)[number];
/** Whether each theme runs in light or dark mode (drives the `.dark` class). */
export const THEME_MODE: Record<AccentId, 'light' | 'dark'> = {
  daylight: 'light',
  linen: 'light',
  midnight: 'dark',
  obsidian: 'dark',
  forest: 'dark',
  dusk: 'dark',
};
/** Accent color per theme (the pop color) — for picker swatches. */
export const ACCENT_SWATCH: Record<AccentId, string> = {
  daylight: '#6d5cf5',
  linen: '#d97706',
  midnight: '#38bdf8',
  obsidian: '#a855f7',
  forest: '#10b981',
  dusk: '#f43f5e',
};
/** Canvas/base color per theme — for the picker preview cards. */
export const ACCENT_SIDEBAR: Record<AccentId, string> = {
  daylight: '#f8fafc',
  linen: '#fafaf9',
  midnight: '#080e1c',
  obsidian: '#09090b',
  forest: '#07140f',
  dusk: '#1a0d13',
};
/** Surface color per theme — the card colour shown on the preview. */
export const ACCENT_SURFACE: Record<AccentId, string> = {
  daylight: '#ffffff',
  linen: '#ffffff',
  midnight: '#0f182c',
  obsidian: '#18181b',
  forest: '#0d221c',
  dusk: '#2a161e',
};
export const ACCENT_LABEL: Record<AccentId, string> = {
  daylight: 'Daylight',
  linen: 'Linen',
  midnight: 'Midnight',
  obsidian: 'Obsidian',
  forest: 'Forest',
  dusk: 'Dusk',
};

interface UiState {
  rightPanel: RightPanel;
  mainView: MainView;
  sidebarOpen: boolean; // mobile drawer
  searchOpen: boolean;
  commandOpen: boolean;
  theme: 'light' | 'dark';
  accent: AccentId;
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
  setCommandOpen: (open: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setAccent: (accent: AccentId) => void;
  setNotificationsMuted: (muted: boolean) => void;
  upsertTyping: (containerId: string, entry: TypingEntry) => void;
  removeTyping: (containerId: string, userId: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  rightPanel: { kind: 'none' },
  mainView: 'chat',
  sidebarOpen: false,
  searchOpen: false,
  commandOpen: false,
  theme: 'light',
  accent:
    (typeof window !== 'undefined' && (window.localStorage.getItem('bs.accent') as AccentId)) ||
    'daylight',
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
  setCommandOpen: (open) => set({ commandOpen: open }),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bs.theme', theme);
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
    set({ theme });
  },
  setAccent: (accent) => {
    const mode = THEME_MODE[accent];
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bs.accent', accent);
      window.localStorage.setItem('bs.theme', mode);
      document.documentElement.dataset.accent = accent;
      document.documentElement.classList.toggle('dark', mode === 'dark');
    }
    // A theme carries its own light/dark mode — keep `theme` in sync.
    set({ accent, theme: mode });
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
