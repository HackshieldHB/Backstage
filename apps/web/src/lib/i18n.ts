'use client';

import { useUiStore } from '@/stores/ui-store';

/**
 * Lightweight i18n. `useT()` returns a translator bound to the current UI
 * language (persisted in the store). Add keys here; unknown keys fall back to
 * the key's English value or the key itself, so partial coverage is safe.
 */
const DICT: Record<string, { en: string; id: string }> = {
  inbox: { en: 'Inbox', id: 'Kotak masuk' },
  threads: { en: 'Threads', id: 'Utas' },
  activity: { en: 'Activity', id: 'Aktivitas' },
  clients_projects: { en: 'Clients & Projects', id: 'Klien & Proyek' },
  incidents: { en: 'Incidents', id: 'Insiden' },
  ask_backstages: { en: 'Ask Backstages', id: 'Tanya Backstages' },
  later: { en: 'Later', id: 'Nanti' },
  scheduled: { en: 'Scheduled', id: 'Terjadwal' },
  workflows: { en: 'Workflows', id: 'Alur Kerja' },
  team_timeline: { en: 'Team timeline', id: 'Timeline tim' },
  standups: { en: 'Standups', id: 'Standup' },
  integrations: { en: 'Integrations', id: 'Integrasi' },
  decisions: { en: 'Decisions', id: 'Keputusan' },
  weekly_reports: { en: 'Weekly reports', id: 'Laporan mingguan' },
  work_dashboard: { en: 'Jira & Confluence', id: 'Jira & Confluence' },
  catch_me_up: { en: 'Catch me up', id: 'Rangkum untukku' },
  user_groups: { en: 'User groups', id: 'Grup pengguna' },
  analytics: { en: 'Analytics', id: 'Analitik' },
  audit_log: { en: 'Audit log', id: 'Log audit' },
  tools: { en: 'Tools', id: 'Alat' },
  insights: { en: 'Insights', id: 'Wawasan' },
  productivity: { en: 'Productivity', id: 'Produktivitas' },
  workspace_group: { en: 'Workspace', id: 'Workspace' },
  channels: { en: 'Channels', id: 'Kanal' },
  direct_messages: { en: 'Direct messages', id: 'Pesan langsung' },
  browse_channels: { en: 'Browse channels', id: 'Jelajahi kanal' },
  add: { en: 'Add', id: 'Tambah' },
  sign_out: { en: 'Sign out', id: 'Keluar' },
  language: { en: 'Language', id: 'Bahasa' },
  replay_tour: { en: 'Replay the intro tour', id: 'Ulangi tur perkenalan' },
  take_a_tour: { en: 'Take a tour', id: 'Ikuti tur' },
};

export type TKey = keyof typeof DICT;

export function useT() {
  const lang = useUiStore((s) => s.lang);
  return (key: string): string => {
    const entry = DICT[key];
    if (!entry) return key;
    return entry[lang] ?? entry.en;
  };
}
