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
  MessageDto,
  MessagePage,
  SearchResponse,
  SendMessageInput,
  SlashCommandDto,
  UnreadUpdatedPayload,
  UserDto,
  WorkspaceDto,
  WorkspaceMemberDto,
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
  pins: (channelId: string) => ['pins', channelId] as const,
  saved: (ws: string) => ['saved', ws] as const,
  notifications: ['notifications'] as const,
  channelMembers: (channelId: string) => ['channel-members', channelId] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: () => api<WorkspaceWithRole[]>('GET', '/workspaces'),
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
