'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  AttachmentDto,
  ChannelDto,
  ConfluencePage,
  ConfluenceSpace,
  CatchUpResponse,
  ConversationDto,
  JiraMyIssue,
  LogTimeInput,
  MessageDto,
  MessagePage,
  ScheduledMessageDto,
  SearchResponse,
  SendMessageInput,
  StandupDto,
  StandupResponseDto,
  IncomingWebhookDto,
  CustomCommandDto,
  DecisionDto,
  WeeklyReportDto,
  WellbeingReportDto,
  WellbeingTeamDto,
  DigestPrefDto,
  WorkDashboardDto,
  SprintDashboardDto,
  JiraAlertRuleDto,
  JiraDashboardSummaryDto,
  JiraDashboardViewDto,
  ProjectsOverviewDto,
  IncidentDto,
  OncallDto,
  CalendarLinkDto,
  SlashCommandDto,
  TimelineResponse,
  TimesheetEntryDto,
  UnreadUpdatedPayload,
  UserDto,
  UtilizationResponse,
  WorkspaceDto,
  WorkspaceMemberDto,
  DiscoverDto,
  PersonRecommendationDto,
  ChannelRecommendationDto,
  PriorityInboxDto,
  FocusReportDto,
  BestTimeDto,
  ExpertsResponseDto,
  CatchupPicksDto,
  KnowledgeResponseDto,
  FollowupsDto,
  RecommendationFeedbackInput,
  HuddleRecapDto,
  ScheduledHuddleDto,
  ScheduleHuddleInput,
} from '@backstages/shared';
import { api } from '@/lib/api';

export type ChannelWithMeta = ChannelDto & { notificationPref?: string; myRole?: string };
export type WorkspaceWithRole = WorkspaceDto & { myRole: string };

export interface NotificationItem {
  id: string;
  type: string;
  actor: UserDto | null;
  messageId: string | null;
  channelId: string | null;
  channelName: string | null;
  conversationId: string | null;
  preview: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export const keys = {
  workspaces: ['workspaces'] as const,
  channels: (ws: string) => ['channels', ws] as const,
  browse: (ws: string) => ['channels-browse', ws] as const,
  conversations: (ws: string) => ['conversations', ws] as const,
  members: (ws: string) => ['members', ws] as const,
  unreads: (ws: string) => ['unreads', ws] as const,
  presence: (ws: string) => ['presence', ws] as const,
  messages: (containerId: string) => ['messages', containerId] as const,
  thread: (messageId: string) => ['thread', messageId] as const,
  myThreads: (ws: string) => ['my-threads', ws] as const,
  scheduled: (ws: string) => ['scheduled', ws] as const,
  customEmoji: (ws: string) => ['custom-emoji', ws] as const,
  workflows: (ws: string) => ['workflows', ws] as const,
  standups: (ws: string) => ['standups', ws] as const,
  standupResponses: (id: string, date: string) => ['standup-responses', id, date] as const,
  webhooks: (ws: string) => ['webhooks', ws] as const,
  customCommands: (ws: string) => ['custom-commands', ws] as const,
  decisions: (ws: string) => ['decisions', ws] as const,
  weeklyReports: (ws: string) => ['weekly-reports', ws] as const,
  wellbeing: (ws: string) => ['wellbeing', ws] as const,
  wellbeingTeam: (ws: string) => ['wellbeing-team', ws] as const,
  digest: (ws: string) => ['digest', ws] as const,
  workDashboard: (ws: string, scope: string) => ['work-dashboard', ws, scope] as const,
  jiraSprint: (ws: string) => ['jira-sprint', ws] as const,
  jiraAlerts: (ws: string) => ['jira-alerts', ws] as const,
  jiraDashboards: (ws: string) => ['jira-dashboards', ws] as const,
  jiraDashboardView: (ws: string, id: string) => ['jira-dashboard-view', ws, id] as const,
  projectsOverview: (ws: string, days: number) => ['projects-overview', ws, days] as const,
  incidents: (ws: string) => ['incidents', ws] as const,
  oncall: (ws: string) => ['oncall', ws] as const,
  calendar: ['calendar'] as const,
  pins: (channelId: string) => ['pins', channelId] as const,
  saved: (ws: string) => ['saved', ws] as const,
  notifications: ['notifications'] as const,
  channelMembers: (channelId: string) => ['channel-members', channelId] as const,
  timeline: (ws: string, from: string, to: string) => ['timeline', ws, from, to] as const,
  utilization: (ws: string, from: string, to: string) => ['utilization', ws, from, to] as const,
  timesheet: (ws: string) => ['timesheet', ws] as const,
  recsDiscover: (ws: string) => ['recs-discover', ws] as const,
  recsPeople: (ws: string) => ['recs-people', ws] as const,
  recsChannels: (ws: string) => ['recs-channels', ws] as const,
  recsPriority: (ws: string) => ['recs-priority', ws] as const,
  recsFocus: (ws: string) => ['recs-focus', ws] as const,
  recsCatchup: (ws: string) => ['recs-catchup', ws] as const,
  recsFollowups: (ws: string) => ['recs-followups', ws] as const,
  recsBestTime: (ws: string, target: string) => ['recs-best-time', ws, target] as const,
  recsExperts: (ws: string, q: string) => ['recs-experts', ws, q] as const,
  recsKnowledge: (messageId: string) => ['recs-knowledge', messageId] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: () => api<WorkspaceWithRole[]>('GET', '/workspaces'),
  });
}

export function useStandups(workspaceId: string) {
  return useQuery({
    queryKey: keys.standups(workspaceId),
    queryFn: () => api<StandupDto[]>('GET', `/workspaces/${workspaceId}/standups`),
    enabled: !!workspaceId,
  });
}

export function useStandupResponses(standupId: string | null, date: string) {
  return useQuery({
    queryKey: keys.standupResponses(standupId ?? '', date),
    queryFn: () => api<StandupResponseDto[]>('GET', `/standups/${standupId}/responses`),
    enabled: !!standupId,
  });
}

export function useWebhooks(workspaceId: string) {
  return useQuery({
    queryKey: keys.webhooks(workspaceId),
    queryFn: () => api<IncomingWebhookDto[]>('GET', `/workspaces/${workspaceId}/webhooks`),
    enabled: !!workspaceId,
  });
}

export function useCustomCommands(workspaceId: string) {
  return useQuery({
    queryKey: keys.customCommands(workspaceId),
    queryFn: () => api<CustomCommandDto[]>('GET', `/workspaces/${workspaceId}/custom-commands`),
    enabled: !!workspaceId,
  });
}

export function useDecisions(workspaceId: string) {
  return useQuery({
    queryKey: keys.decisions(workspaceId),
    queryFn: () => api<DecisionDto[]>('GET', `/workspaces/${workspaceId}/decisions`),
    enabled: !!workspaceId,
  });
}

export function useWeeklyReports(workspaceId: string) {
  return useQuery({
    queryKey: keys.weeklyReports(workspaceId),
    queryFn: () => api<WeeklyReportDto[]>('GET', `/workspaces/${workspaceId}/weekly-reports`),
    enabled: !!workspaceId,
  });
}

export function useWellbeing(workspaceId: string) {
  return useQuery({
    queryKey: keys.wellbeing(workspaceId),
    queryFn: () => api<WellbeingReportDto>('GET', `/workspaces/${workspaceId}/wellbeing/me`),
    enabled: !!workspaceId,
  });
}

export function useWellbeingTeam(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.wellbeingTeam(workspaceId),
    queryFn: () => api<WellbeingTeamDto>('GET', `/workspaces/${workspaceId}/wellbeing/team`),
    enabled: !!workspaceId && enabled,
  });
}

export function useDigestPref(workspaceId: string) {
  return useQuery({
    queryKey: keys.digest(workspaceId),
    queryFn: () => api<DigestPrefDto>('GET', `/workspaces/${workspaceId}/digest`),
    enabled: !!workspaceId,
  });
}

export function useWorkDashboard(workspaceId: string, scope: 'all' | 'me' = 'all', enabled = true) {
  return useQuery({
    queryKey: keys.workDashboard(workspaceId, scope),
    queryFn: () => api<WorkDashboardDto>('GET', `/workspaces/${workspaceId}/atlassian/dashboard?scope=${scope}`),
    enabled: !!workspaceId && enabled,
    staleTime: 60_000,
  });
}

export function useJiraSprint(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.jiraSprint(workspaceId),
    queryFn: () => api<SprintDashboardDto>('GET', `/workspaces/${workspaceId}/atlassian/sprint`),
    enabled: !!workspaceId && enabled,
    staleTime: 60_000,
  });
}

export function useJiraAlerts(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.jiraAlerts(workspaceId),
    queryFn: () => api<JiraAlertRuleDto[]>('GET', `/workspaces/${workspaceId}/atlassian/alerts`),
    enabled: !!workspaceId && enabled,
  });
}

export function useJiraDashboards(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.jiraDashboards(workspaceId),
    queryFn: () => api<JiraDashboardSummaryDto[]>('GET', `/workspaces/${workspaceId}/atlassian/jira-dashboards`),
    enabled: !!workspaceId && enabled,
    staleTime: 60_000,
  });
}

export function useJiraDashboardView(workspaceId: string, dashboardId: string, enabled = true) {
  return useQuery({
    queryKey: keys.jiraDashboardView(workspaceId, dashboardId),
    queryFn: () => api<JiraDashboardViewDto>('GET', `/workspaces/${workspaceId}/atlassian/jira-dashboards/${dashboardId}`),
    enabled: !!workspaceId && !!dashboardId && enabled,
    staleTime: 60_000,
  });
}

export function useProjectsOverview(workspaceId: string, days = 30, enabled = true) {
  return useQuery({
    queryKey: keys.projectsOverview(workspaceId, days),
    queryFn: () => api<ProjectsOverviewDto>('GET', `/workspaces/${workspaceId}/projects/overview?days=${days}`),
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  });
}

export function useIncidents(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.incidents(workspaceId),
    queryFn: () => api<IncidentDto[]>('GET', `/workspaces/${workspaceId}/incidents`),
    enabled: !!workspaceId && enabled,
  });
}

export function useOncall(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.oncall(workspaceId),
    queryFn: () => api<OncallDto>('GET', `/workspaces/${workspaceId}/oncall`),
    enabled: !!workspaceId && enabled,
  });
}

export function useCalendar(enabled = true) {
  return useQuery({
    queryKey: keys.calendar,
    queryFn: () => api<CalendarLinkDto>('GET', '/me/calendar'),
    enabled,
  });
}

export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: keys.channels(workspaceId),
    queryFn: () => api<ChannelWithMeta[]>('GET', `/workspaces/${workspaceId}/channels`),
    enabled: !!workspaceId,
  });
}

export function useBrowseChannels(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.browse(workspaceId),
    queryFn: () => api<ChannelDto[]>('GET', `/workspaces/${workspaceId}/channels/browse`),
    enabled: !!workspaceId && enabled,
  });
}

export function useConversations(workspaceId: string) {
  return useQuery({
    queryKey: keys.conversations(workspaceId),
    queryFn: () => api<ConversationDto[]>('GET', `/workspaces/${workspaceId}/conversations`),
    enabled: !!workspaceId,
  });
}

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: keys.members(workspaceId),
    queryFn: () => api<WorkspaceMemberDto[]>('GET', `/workspaces/${workspaceId}/members`),
    enabled: !!workspaceId,
  });
}

export function useUpdateMemberRole(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'ADMIN' | 'MEMBER' | 'GUEST' }) =>
      api<WorkspaceMemberDto>('PATCH', `/workspaces/${workspaceId}/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(workspaceId) }),
  });
}

export function useRemoveMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<{ ok: boolean }>('DELETE', `/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(workspaceId) }),
  });
}

export function useUnreads(workspaceId: string) {
  return useQuery({
    queryKey: keys.unreads(workspaceId),
    queryFn: () => api<UnreadUpdatedPayload[]>('GET', `/workspaces/${workspaceId}/unreads`),
    enabled: !!workspaceId,
  });
}

export function usePresence(workspaceId: string) {
  return useQuery({
    queryKey: keys.presence(workspaceId),
    queryFn: () => api<Record<string, string>>('GET', `/workspaces/${workspaceId}/presence`),
    enabled: !!workspaceId,
    refetchInterval: 60000,
  });
}

export type Container = { kind: 'channel' | 'conversation'; id: string };

export function containerPath(c: Container) {
  return c.kind === 'channel' ? `/channels/${c.id}` : `/conversations/${c.id}`;
}

export function useMessages(container: Container | null) {
  return useInfiniteQuery({
    queryKey: keys.messages(container?.id ?? 'none'),
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        'GET',
        `${containerPath(container!)}/messages${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!container,
  });
}

export function useThread(messageId: string | null) {
  return useQuery({
    queryKey: keys.thread(messageId ?? 'none'),
    queryFn: () => api<{ parent: MessageDto; replies: MessageDto[] }>('GET', `/messages/${messageId}/thread`),
    enabled: !!messageId,
  });
}

export interface ThreadSummary {
  message: MessageDto;
  containerLabel: string;
}

export interface CustomEmojiView {
  id: string;
  name: string;
  url: string;
}

export interface UserGroupView {
  id: string;
  name: string;
  handle: string;
  memberIds: string[];
}
export function useUserGroups(workspaceId: string) {
  return useQuery({
    queryKey: ['user-groups', workspaceId],
    queryFn: () => api<UserGroupView[]>('GET', `/workspaces/${workspaceId}/user-groups`),
    enabled: !!workspaceId,
    staleTime: 120000,
  });
}

export interface WorkspaceAnalytics {
  totalMessages: number;
  memberCount: number;
  activeUsers7d: number;
  messagesByDay: { date: string; count: number }[];
  topChannels: { name: string; count: number }[];
}
export function useAnalytics(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ['analytics', workspaceId],
    queryFn: () => api<WorkspaceAnalytics>('GET', `/workspaces/${workspaceId}/analytics`),
    enabled: enabled && !!workspaceId,
  });
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}
export function useAuditLog(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ['audit', workspaceId],
    queryFn: () => api<AuditEntry[]>('GET', `/workspaces/${workspaceId}/audit`),
    enabled: enabled && !!workspaceId,
  });
}

export function useCanvas(channelId: string, enabled = true) {
  return useQuery({
    queryKey: ['canvas', channelId],
    queryFn: () =>
      api<{ contentJson: unknown; contentText: string; updatedBy: string | null; updatedAt: string | null }>(
        'GET',
        `/channels/${channelId}/canvas`,
      ),
    enabled: enabled && !!channelId,
  });
}

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api<{ enabled: boolean }>('GET', '/ai/status'),
    staleTime: 600000,
  });
}

export function useSfuStatus() {
  return useQuery({
    queryKey: ['sfu-status'],
    queryFn: () => api<{ enabled: boolean }>('GET', '/huddles/sfu/status'),
    staleTime: 600000,
  });
}

export function useCustomEmoji(workspaceId: string) {
  return useQuery({
    queryKey: keys.customEmoji(workspaceId),
    queryFn: () => api<CustomEmojiView[]>('GET', `/workspaces/${workspaceId}/emoji`),
    enabled: !!workspaceId,
    staleTime: 300000,
  });
}

export interface WorkflowView {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  config: { channelId: string; keyword?: string; actionChannelId: string; actionText: string };
  createdAt: string;
}

export function useWorkflows(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.workflows(workspaceId),
    queryFn: () => api<WorkflowView[]>('GET', `/workspaces/${workspaceId}/workflows`),
    enabled: enabled && !!workspaceId,
  });
}

export function useScheduledMessages(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.scheduled(workspaceId),
    queryFn: () =>
      api<ScheduledMessageDto[]>('GET', `/workspaces/${workspaceId}/scheduled`),
    enabled: enabled && !!workspaceId,
  });
}

// ---------- scheduled huddles ----------

export function useScheduledHuddles(container: Container | null) {
  return useQuery({
    queryKey: ['scheduled-huddles', container?.id ?? 'none'],
    queryFn: () => api<ScheduledHuddleDto[]>('GET', `${containerPath(container!)}/scheduled-huddles`),
    enabled: !!container,
    // Reminders fire server-side; refresh occasionally so start times stay fresh.
    refetchInterval: 60000,
  });
}

export function useScheduleHuddle(container: Container) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleHuddleInput) =>
      api<ScheduledHuddleDto>('POST', `${containerPath(container)}/scheduled-huddles`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-huddles', container.id] }),
  });
}

export function useCancelScheduledHuddle(container: Container) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>('DELETE', `/scheduled-huddles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-huddles', container.id] }),
  });
}

export function useMeetingInsights(workspaceId: string, days: number, enabled = true) {
  return useQuery({
    queryKey: ['meeting-insights', workspaceId, days],
    queryFn: () =>
      api<import('@backstages/shared').MeetingInsightsDto>(
        'GET',
        `/workspaces/${workspaceId}/meeting-insights?days=${days}`,
      ),
    enabled: enabled && !!workspaceId,
    staleTime: 60000,
  });
}

// ---------- meeting records / AI minutes ----------

export function useMeetingRecords(container: Container | null) {
  return useQuery({
    queryKey: ['meeting-records', container?.id ?? 'none'],
    queryFn: () =>
      api<import('@backstages/shared').MeetingRecordSummaryDto[]>(
        'GET',
        `${containerPath(container!)}/meeting-records`,
      ),
    enabled: !!container,
  });
}

export function useMeetingRecord(id: string | null) {
  return useQuery({
    queryKey: ['meeting-record', id ?? 'none'],
    queryFn: () => api<import('@backstages/shared').MeetingRecordDto>('GET', `/meeting-records/${id}`),
    enabled: !!id,
  });
}

export function useGenerateMinutes(container: Container) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<import('@backstages/shared').MeetingRecordDto>('POST', `/meeting-records/${id}/minutes`),
    onSuccess: (r) => {
      qc.setQueryData(['meeting-record', r.id], r);
      void qc.invalidateQueries({ queryKey: ['meeting-records', container.id] });
    },
  });
}

export function useActionItemToDecision() {
  return useMutation({
    mutationFn: ({ id, index }: { id: string; index: number }) =>
      api<import('@backstages/shared').DecisionDto>(
        'POST',
        `/meeting-records/${id}/action-items/${index}/decision`,
      ),
  });
}

export function useDeleteMeetingRecord(container: Container) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>('DELETE', `/meeting-records/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-records', container.id] }),
  });
}

// ---------- availability / focus hours / OOO ----------

export function useAvailability(workspaceId: string) {
  return useQuery({
    queryKey: ['availability', workspaceId],
    queryFn: () => api<import('@backstages/shared').AvailabilityDto>('GET', `/workspaces/${workspaceId}/availability`),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetAvailability(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: import('@backstages/shared').AvailabilityInput) =>
      api<import('@backstages/shared').AvailabilityDto>('PUT', `/workspaces/${workspaceId}/availability`, input),
    onSuccess: (d) => qc.setQueryData(['availability', workspaceId], d),
  });
}

/** True when the member's own alerts should be muted right now: OOO active, or
 *  outside their working hours (evaluated in the viewer's own local time). */
export function isQuietNow(prefs: import('@backstages/shared').AvailabilityDto | undefined): boolean {
  if (!prefs) return false;
  if (prefs.oooUntil && new Date(prefs.oooUntil).getTime() > Date.now()) return true;
  if (prefs.workStartMin == null || prefs.workEndMin == null) return false;
  const now = new Date();
  const days = prefs.workDays && prefs.workDays.length ? prefs.workDays : [1, 2, 3, 4, 5];
  if (!days.includes(now.getDay())) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes < prefs.workStartMin || minutes >= prefs.workEndMin;
}

export function useMyThreads(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.myThreads(workspaceId),
    queryFn: () => api<{ threads: ThreadSummary[] }>('GET', `/workspaces/${workspaceId}/threads`),
    enabled: enabled && !!workspaceId,
  });
}

export interface ReadState {
  userId: string;
  lastReadAt: string | null;
}

export function useReadState(container: Container) {
  return useQuery({
    queryKey: ['read-state', container.id],
    queryFn: () => api<ReadState[]>('GET', `${containerPath(container)}/read-state`),
    // Others' read markers arrive via polling; cheap and eventually-consistent.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
}

export function usePins(channelId: string | null) {
  return useQuery({
    queryKey: keys.pins(channelId ?? 'none'),
    queryFn: () =>
      api<Array<{ message: MessageDto; pinnedBy: UserDto; pinnedAt: string }>>(
        'GET',
        `/channels/${channelId}/pins`,
      ),
    enabled: !!channelId,
  });
}

export function useSaved(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.saved(workspaceId),
    queryFn: () =>
      api<Array<{ message: MessageDto; savedAt: string }>>('GET', `/workspaces/${workspaceId}/saved`),
    enabled: !!workspaceId && enabled,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () =>
      api<{ notifications: NotificationItem[]; nextCursor: string | null; unreadCount: number }>(
        'GET',
        '/me/notifications',
      ),
    enabled,
    refetchInterval: 90000,
  });
}

export function useChannelMembers(channelId: string | null) {
  return useQuery({
    queryKey: keys.channelMembers(channelId ?? 'none'),
    queryFn: () => api<Array<UserDto & { joinedAt: string }>>('GET', `/channels/${channelId}/members`),
    enabled: !!channelId,
  });
}

// ---------- catch me up ----------

export function useCatchUp(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['catch-up', workspaceId],
    queryFn: () => api<CatchUpResponse>('GET', `/workspaces/${workspaceId}/catch-up`),
    enabled: !!workspaceId && enabled,
    staleTime: 15000,
  });
}

export function useHuddleRecap(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      channelId?: string;
      conversationId?: string;
      transcript: string;
      post?: boolean;
    }) => api<HuddleRecapDto>('POST', `/ai/workspaces/${workspaceId}/huddle-recap`, input),
  });
}

// ---------- integration browse tree (Jira projects/issues, Confluence spaces/pages) ----------

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}
export interface JiraIssueRow {
  key: string;
  summary: string;
  status: string | null;
  url: string;
}

export function useJiraProjects(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['jira-projects', workspaceId],
    queryFn: () => api<JiraProject[]>('GET', `/workspaces/${workspaceId}/jira/projects`),
    enabled: !!workspaceId && enabled,
    staleTime: 300000,
  });
}

export function useJiraIssues(workspaceId: string, projectKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ['jira-issues', workspaceId, projectKey],
    queryFn: () =>
      api<JiraIssueRow[]>('GET', `/workspaces/${workspaceId}/jira/projects/${projectKey}/issues`),
    enabled: !!workspaceId && !!projectKey && enabled,
    staleTime: 120000,
  });
}

/** Slash commands contributed by the server's integration apps. */
export function useCommands(workspaceId: string) {
  return useQuery({
    queryKey: ['commands', workspaceId],
    queryFn: () => api<SlashCommandDto[]>('GET', `/workspaces/${workspaceId}/commands`),
    enabled: !!workspaceId,
    staleTime: 300000,
  });
}

/**
 * The caller's own open Jira issues. Fails with 400 when the account isn't
 * linked, which is an expected state rather than an outage — no retries, and
 * the tree renders a connect hint from `error`.
 */
export function useMyJiraIssues(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['jira-my-issues', workspaceId],
    queryFn: () => api<JiraMyIssue[]>('GET', `/workspaces/${workspaceId}/jira/my-issues`),
    enabled: !!workspaceId && enabled,
    staleTime: 60000,
    retry: false,
  });
}

export function useConfluenceSpaces(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['confluence-spaces', workspaceId],
    queryFn: () => api<ConfluenceSpace[]>('GET', `/workspaces/${workspaceId}/confluence/spaces`),
    enabled: !!workspaceId && enabled,
    staleTime: 300000,
  });
}

export function useConfluencePages(workspaceId: string, spaceKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ['confluence-pages', workspaceId, spaceKey],
    queryFn: () =>
      api<ConfluencePage[]>('GET', `/workspaces/${workspaceId}/confluence/spaces/${spaceKey}/pages`),
    enabled: !!workspaceId && !!spaceKey && enabled,
    staleTime: 120000,
  });
}

export function useSearch(workspaceId: string, q: string) {
  return useQuery({
    queryKey: ['search', workspaceId, q],
    queryFn: () =>
      api<SearchResponse>('GET', `/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`),
    enabled: !!workspaceId && q.trim().length > 0,
    staleTime: 10000,
  });
}

// ---------- message cache helpers (shared by mutations + socket bridge) ----------

export type MessagesData = InfiniteData<MessagePage, string | null>;

export function appendMessage(qc: ReturnType<typeof useQueryClient>, containerId: string, message: MessageDto) {
  qc.setQueryData<MessagesData>(keys.messages(containerId), (old) => {
    if (!old) return old;
    // Deduplicate by id or clientMsgId (optimistic echo reconciliation).
    const exists = old.pages.some((p) =>
      p.messages.some(
        (m) => m.id === message.id || (message.clientMsgId && m.clientMsgId === message.clientMsgId),
      ),
    );
    const pages = old.pages.map((page, i) => {
      let messages = page.messages;
      if (exists) {
        messages = messages.map((m) =>
          m.id === message.id || (message.clientMsgId && m.clientMsgId === message.clientMsgId)
            ? message
            : m,
        );
      } else if (i === 0) {
        // Page 0 is the newest page; ascending order within a page.
        messages = [...messages, message];
      }
      return { ...page, messages };
    });
    return { ...old, pages };
  });
}

export function replaceMessage(qc: ReturnType<typeof useQueryClient>, containerId: string, message: MessageDto) {
  qc.setQueryData<MessagesData>(keys.messages(containerId), (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        messages: p.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m)),
      })),
    };
  });
}

export function patchMessage(
  qc: ReturnType<typeof useQueryClient>,
  containerId: string,
  messageId: string,
  patch: Partial<MessageDto>,
) {
  qc.setQueryData<MessagesData>(keys.messages(containerId), (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        messages: p.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      })),
    };
  });
}

// ---------- mutations ----------

export interface PendingMessage extends MessageDto {
  pending?: boolean;
  failed?: boolean;
}

export function useSendMessage(container: Container) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      api<MessageDto>('POST', `${containerPath(container)}/messages`, input),
    onMutate: async (input) => {
      // Optimistic render for top-level messages.
      if (input.parentId) return;
      const optimistic: PendingMessage = {
        id: `pending-${input.clientMsgId}`,
        workspaceId: '',
        channelId: container.kind === 'channel' ? container.id : null,
        conversationId: container.kind === 'conversation' ? container.id : null,
        user: null,
        kind: 'USER',
        contentJson: input.contentJson,
        contentText: input.contentText,
        parentId: null,
        showInChannel: false,
        isEdited: false,
        isDeleted: false,
        clientMsgId: input.clientMsgId,
        createdAt: new Date().toISOString(),
        editedAt: null,
        reactions: [],
        attachments: [],
        replyCount: 0,
        threadParticipants: [],
        lastReplyAt: null,
        pending: true,
      };
      appendMessage(qc, container.id, optimistic);
    },
    onSuccess: (message) => {
      appendMessage(qc, container.id, message); // reconciles by clientMsgId
      if (message.parentId) {
        qc.invalidateQueries({ queryKey: keys.thread(message.parentId) });
      }
    },
    onError: (_err, input) => {
      if (input.parentId) return;
      qc.setQueryData<MessagesData>(keys.messages(container.id), (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            messages: p.messages.map((m) =>
              m.clientMsgId === input.clientMsgId ? { ...m, pending: false, failed: true } : m,
            ) as PendingMessage[],
          })),
        };
      });
    },
  });
}

export function useUploadFile(workspaceId: string) {
  return useMutation({
    mutationFn: async ({ file, onProgress }: { file: File; onProgress?: (pct: number) => void }) => {
      // XHR for upload progress events.
      const form = new FormData();
      form.append('file', file);
      const { getAccessToken, API_URL } = await import('@/lib/api');
      return new Promise<AttachmentDto>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/workspaces/${workspaceId}/attachments`);
        xhr.setRequestHeader('Authorization', `Bearer ${getAccessToken()}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && !json.error) resolve(json.data);
            else reject(new Error(json.error?.message ?? `Upload failed (${xhr.status})`));
          } catch {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(form);
      });
    },
  });
}

// ---------- timesheet & team timeline ----------

export function useTeamTimeline(workspaceId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: keys.timeline(workspaceId, from, to),
    queryFn: () =>
      api<TimelineResponse>(
        'GET',
        `/workspaces/${workspaceId}/timeline?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: !!workspaceId && enabled,
  });
}

export function useUtilization(workspaceId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: keys.utilization(workspaceId, from, to),
    queryFn: () =>
      api<UtilizationResponse>(
        'GET',
        `/workspaces/${workspaceId}/utilization?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: !!workspaceId && enabled,
  });
}

export function useMyTimesheet(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.timesheet(workspaceId),
    queryFn: () => api<TimesheetEntryDto[]>('GET', `/workspaces/${workspaceId}/timesheet/entries`),
    enabled: !!workspaceId && enabled,
  });
}

export function useLogTime(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogTimeInput) =>
      api<TimesheetEntryDto>('POST', `/workspaces/${workspaceId}/timesheet/entries`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.timesheet(workspaceId) });
      void qc.invalidateQueries({ queryKey: ['timeline', workspaceId] });
      void qc.invalidateQueries({ queryKey: ['utilization', workspaceId] });
    },
  });
}

// ---- Recommendations (R1–R9) ----

const recBase = (ws: string) => `/workspaces/${ws}/recommendations`;

export function useDiscover(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsDiscover(workspaceId),
    queryFn: () => api<DiscoverDto>('GET', `${recBase(workspaceId)}/discover`),
    enabled: !!workspaceId && enabled,
    staleTime: 120_000,
  });
}

export function useRecommendedPeople(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsPeople(workspaceId),
    queryFn: () => api<PersonRecommendationDto[]>('GET', `${recBase(workspaceId)}/people`),
    enabled: !!workspaceId && enabled,
    staleTime: 120_000,
  });
}

export function useRecommendedChannels(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsChannels(workspaceId),
    queryFn: () => api<ChannelRecommendationDto[]>('GET', `${recBase(workspaceId)}/channels`),
    enabled: !!workspaceId && enabled,
    staleTime: 120_000,
  });
}

export function usePriorityInbox(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsPriority(workspaceId),
    queryFn: () => api<PriorityInboxDto>('GET', `${recBase(workspaceId)}/priority`),
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  });
}

export function useFocusReport(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsFocus(workspaceId),
    queryFn: () => api<FocusReportDto>('GET', `${recBase(workspaceId)}/focus`),
    enabled: !!workspaceId && enabled,
    staleTime: 300_000,
  });
}

export function useCatchupPicks(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsCatchup(workspaceId),
    queryFn: () => api<CatchupPicksDto>('GET', `${recBase(workspaceId)}/catchup`),
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  });
}

export function useFollowups(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsFollowups(workspaceId),
    queryFn: () => api<FollowupsDto>('GET', `${recBase(workspaceId)}/followups`),
    enabled: !!workspaceId && enabled,
    staleTime: 120_000,
  });
}

export function useBestTime(workspaceId: string, targetUserId: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.recsBestTime(workspaceId, targetUserId ?? ''),
    queryFn: () => api<BestTimeDto>('GET', `${recBase(workspaceId)}/best-time/${targetUserId}`),
    enabled: !!workspaceId && !!targetUserId && enabled,
    staleTime: 60_000,
  });
}

export function useExperts(workspaceId: string, q: string, enabled = true) {
  return useQuery({
    queryKey: keys.recsExperts(workspaceId, q),
    queryFn: () =>
      api<ExpertsResponseDto>('GET', `${recBase(workspaceId)}/experts?q=${encodeURIComponent(q)}`),
    enabled: !!workspaceId && q.trim().length >= 3 && enabled,
    staleTime: 60_000,
  });
}

export function useRelatedKnowledge(workspaceId: string, messageId: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.recsKnowledge(messageId ?? ''),
    queryFn: () =>
      api<KnowledgeResponseDto>('GET', `${recBase(workspaceId)}/knowledge/${messageId}`),
    enabled: !!workspaceId && !!messageId && enabled,
    staleTime: 120_000,
  });
}

export function useRecommendationFeedback(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecommendationFeedbackInput) =>
      api<{ ok: true }>('POST', `${recBase(workspaceId)}/feedback`, input),
    onSuccess: (_r, input) => {
      // Refresh the lists a dismissal/act affects.
      const affected: Record<string, readonly unknown[]> = {
        PERSON: keys.recsPeople(workspaceId),
        CHANNEL: keys.recsChannels(workspaceId),
        FOLLOWUP: keys.recsFollowups(workspaceId),
      };
      void qc.invalidateQueries({ queryKey: keys.recsDiscover(workspaceId) });
      const k = affected[input.kind];
      if (k) void qc.invalidateQueries({ queryKey: k });
    },
  });
}
