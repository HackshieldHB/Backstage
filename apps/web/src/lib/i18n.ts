'use client';

import type { Locale } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
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

  // Navigation
  my_day: { en: 'My day', id: 'Hariku' },
  tasks: { en: 'Tasks', id: 'Tugas' },
  discover: { en: 'Discover', id: 'Jelajahi' },
  applications: { en: 'Applications', id: 'Aplikasi' },

  // Tasks
  tasks_subtitle: {
    en: 'Your to-dos and the work you’ve handed off',
    id: 'Daftar tugasmu dan pekerjaan yang kamu delegasikan',
  },
  add_task_placeholder: { en: 'Add a task…', id: 'Tambah tugas…' },
  assigned_to_me: { en: 'Assigned to me', id: 'Ditugaskan ke saya' },
  assigned_by_me: { en: 'Assigned by me', id: 'Saya tugaskan' },
  done: { en: 'Done', id: 'Selesai' },
  bucket_overdue: { en: 'Overdue', id: 'Terlambat' },
  bucket_today: { en: 'Today', id: 'Hari ini' },
  bucket_upcoming: { en: 'Upcoming', id: 'Mendatang' },
  bucket_someday: { en: 'No due date', id: 'Tanpa tenggat' },
  me: { en: 'Me', id: 'Saya' },
  unassigned: { en: 'Unassigned', id: 'Belum ditugaskan' },
  set_due_date: { en: 'Set due date', id: 'Atur tenggat' },
  from_person: { en: 'from {name}', id: 'dari {name}' },
  from_message: { en: 'From a message', id: 'Dari pesan' },
  from_meeting: { en: 'From a meeting', id: 'Dari rapat' },
  empty_mine: {
    en: 'Nothing on your plate. Add a task above, or turn a message into one from its menu.',
    id: 'Tidak ada tugas. Tambahkan tugas di atas, atau ubah pesan menjadi tugas dari menunya.',
  },
  empty_delegated: {
    en: 'You haven’t assigned anything to anyone.',
    id: 'Kamu belum menugaskan apa pun ke orang lain.',
  },
  empty_done: { en: 'No completed tasks yet.', id: 'Belum ada tugas yang selesai.' },
  loading: { en: 'Loading…', id: 'Memuat…' },
  could_not_load_tasks: { en: 'Could not load tasks.', id: 'Gagal memuat tugas.' },

  // Workflow requests
  requests_for_you: { en: 'Requests for you', id: 'Permintaan untukmu' },
  approve: { en: 'Approve', id: 'Setujui' },
  reject: { en: 'Reject', id: 'Tolak' },
  submit: { en: 'Submit', id: 'Kirim' },
  choose: { en: 'Choose…', id: 'Pilih…' },

  // My day
  my_day_loading: { en: 'Gathering your day…', id: 'Menyiapkan harimu…' },
  my_day_error: { en: 'Could not load your day.', id: 'Gagal memuat harimu.' },
  focus: { en: 'Focus', id: 'Fokus' },
  schedule: { en: 'Schedule', id: 'Jadwal' },
  meetings: { en: 'Meetings', id: 'Rapat' },
  due_today: { en: 'Due today', id: 'Jatuh tempo hari ini' },
  requests: { en: 'Requests', id: 'Permintaan' },
  suggest_order: { en: 'Suggest an order', id: 'Sarankan urutan' },
  planning: { en: 'Planning…', id: 'Merencanakan…' },
  standard_order: { en: 'Standard order', id: 'Urutan standar' },
  ai_order: { en: 'AI-suggested order', id: 'Urutan saran AI' },
  nothing_today: { en: 'Nothing waiting on you today. 🎉', id: 'Tidak ada yang menunggumu hari ini. 🎉' },
  no_meetings: { en: 'No meetings today.', id: 'Tidak ada rapat hari ini.' },
  respond: { en: 'Respond', id: 'Tanggapi' },
  hint_jira_not_linked: {
    en: 'Connect your Atlassian account (Workspace menu) to see Jira issues assigned to you.',
    id: 'Hubungkan akun Atlassian-mu (menu Workspace) untuk melihat issue Jira yang ditugaskan kepadamu.',
  },
  hint_jira_error: {
    en: 'Jira didn’t answer — your issues aren’t shown right now.',
    id: 'Jira tidak merespons — issue-mu belum bisa ditampilkan sekarang.',
  },
  hint_calendar_none: {
    en: 'Link your calendar (Availability & focus hours) to see your meetings here.',
    id: 'Tautkan kalendermu (Ketersediaan & jam fokus) untuk melihat rapatmu di sini.',
  },
  hint_calendar_error: {
    en: 'Your calendar feed couldn’t be read — check its link.',
    id: 'Feed kalendermu tidak bisa dibaca — periksa tautannya.',
  },
  // Fixed reasons sent by the server (dynamic ones, like due dates, stay as sent).
  'reason.Overdue': { en: 'Overdue', id: 'Terlambat' },
  'reason.Due today': { en: 'Due today', id: 'Jatuh tempo hari ini' },
  'reason.Due soon': { en: 'Due soon', id: 'Segera jatuh tempo' },
  'reason.No due date': { en: 'No due date', id: 'Tanpa tenggat' },
  'reason.Overdue in Jira': { en: 'Overdue in Jira', id: 'Terlambat di Jira' },
  'reason.Due today in Jira': { en: 'Due today in Jira', id: 'Jatuh tempo hari ini di Jira' },
  'reason.Assigned to you in Jira': { en: 'Assigned to you in Jira', id: 'Ditugaskan kepadamu di Jira' },
  'reason.Someone is waiting on your approval': {
    en: 'Someone is waiting on your approval',
    id: 'Seseorang menunggu persetujuanmu',
  },
  'reason.Someone is waiting on your answers': {
    en: 'Someone is waiting on your answers',
    id: 'Seseorang menunggu jawabanmu',
  },

  // Message toolbar
  add_reaction: { en: 'Add reaction', id: 'Tambah reaksi' },
  reply_in_thread: { en: 'Reply in thread', id: 'Balas di utas' },
  save_for_later: { en: 'Save for later', id: 'Simpan untuk nanti' },
  forward: { en: 'Forward', id: 'Teruskan' },
  create_task: { en: 'Create task', id: 'Buat tugas' },
  remind_me_about_this: { en: 'Remind me about this', id: 'Ingatkan saya tentang ini' },
  edit_message: { en: 'Edit message', id: 'Edit pesan' },
  delete_message: { en: 'Delete message', id: 'Hapus pesan' },
  edited: { en: '(edited)', id: '(diedit)' },

  // Search tabs
  'search.messages': { en: 'Messages', id: 'Pesan' },
  'search.files': { en: 'Files', id: 'Berkas' },
  'search.channels': { en: 'Channels', id: 'Kanal' },
  'search.people': { en: 'People', id: 'Orang' },
  'search.tasks': { en: 'Tasks', id: 'Tugas' },
  'search.decisions': { en: 'Decisions', id: 'Keputusan' },
};

export type TKey = keyof typeof DICT;
/** Read-only view of every translation, for completeness checks. */
export const DICTIONARY: Readonly<typeof DICT> = DICT;
export type Lang = 'en' | 'id';

/**
 * Translate `key` for `lang`, filling `{name}` placeholders from `vars`.
 * Unknown keys return the key itself, so partial coverage is safe.
 */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  let text = entry ? (entry[lang] ?? entry.en) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

export function useT() {
  const lang = useUiStore((s) => s.lang);
  return (key: string, vars?: Record<string, string | number>): string => translate(lang, key, vars);
}

/** date-fns locale for formatting dates in the UI language (undefined = English default). */
export function dateLocale(lang: Lang): Locale | undefined {
  return lang === 'id' ? idLocale : undefined;
}

/** Translate a server-supplied reason label when it's one we know; otherwise show it as sent. */
export function useReasonT() {
  const t = useT();
  return (reason: string): string => {
    const key = `reason.${reason}`;
    const out = t(key);
    return out === key ? reason : out;
  };
}
