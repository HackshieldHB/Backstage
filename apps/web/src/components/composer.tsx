'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, ReactRenderer, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Mention from '@tiptap/extension-mention';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import type { SuggestionOptions } from '@tiptap/suggestion';
import Suggestion from '@tiptap/suggestion';
import { Extension } from '@tiptap/core';
import data from '@emoji-mart/data';
import { init, SearchIndex } from 'emoji-mart';
import {
  Bold as BoldIcon,
  Code,
  Italic as ItalicIcon,
  Paperclip,
  SendHorizonal,
  Smile,
  SquareCode,
  Strikethrough,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  AttachmentDto,
  CommandResultDto,
  MessageDto,
  SendMessageInput,
} from '@backstages/shared';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useQueryClient } from '@tanstack/react-query';
import {
  keys,
  useChannelMembers,
  useConversations,
  useSendMessage,
  useUploadFile,
  type Container,
  type MessagesData,
  type PendingMessage,
} from '@/hooks/queries';
import { SuggestionList, type SuggestionItem, type SuggestionListHandle } from './suggestion-popup';
import { EmojiPickerPopover } from './emoji-picker';
import { CreateJiraIssueDialog } from './create-jira-issue-dialog';
import { DeclareIncidentDialog } from './declare-incident-dialog';
import { Avatar } from './avatar';

const lowlight = createLowlight(common);
void init({ data });

// ---------- suggestion plumbing (shared by @mentions and :emoji:) ----------

function makeSuggestionRender() {
  let component: ReactRenderer<SuggestionListHandle> | null = null;
  let popup: HTMLDivElement | null = null;

  return {
    onStart: (props: { clientRect?: (() => DOMRect | null) | null; editor: Editor; items: SuggestionItem[]; command: (item: SuggestionItem) => void }) => {
      component = new ReactRenderer(SuggestionList, {
        props: { items: props.items, command: props.command },
        editor: props.editor,
      });
      popup = document.createElement('div');
      popup.style.position = 'fixed';
      popup.style.zIndex = '60';
      popup.appendChild(component.element);
      document.body.appendChild(popup);
      const rect = props.clientRect?.();
      if (rect && popup) {
        popup.style.left = `${rect.left}px`;
        popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      }
    },
    onUpdate: (props: { clientRect?: (() => DOMRect | null) | null; items: SuggestionItem[]; command: (item: SuggestionItem) => void }) => {
      component?.updateProps({ items: props.items, command: props.command });
      const rect = props.clientRect?.();
      if (rect && popup) {
        popup.style.left = `${rect.left}px`;
        popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      }
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (props.event.key === 'Escape') {
        popup?.remove();
        component?.destroy();
        return true;
      }
      return component?.ref?.onKeyDown(props.event) ?? false;
    },
    onExit: () => {
      popup?.remove();
      component?.destroy();
      component = null;
      popup = null;
    },
  };
}

/** :shortcode: emoji autocomplete that inserts the native emoji character. */
const EmojiSuggestion = Extension.create({
  name: 'emojiSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: ':',
        pluginKey: undefined as never,
        allowSpaces: false,
        items: async ({ query }: { query: string }) => {
          if (query.length < 2) return [];
          const results = (await SearchIndex.search(query)) ?? [];
          return results.slice(0, 8).map((e: { id: string; skins: Array<{ native: string }> }) => ({
            id: e.skins[0]?.native ?? '',
            label: `:${e.id}:`,
            hint: e.skins[0]?.native ?? '',
          }));
        },
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SuggestionItem }) => {
          editor.chain().focus().insertContentAt(range, `${props.id} `).run();
        },
        render: makeSuggestionRender,
      }),
    ];
  },
});

// ---------- upload chip ----------

interface PendingUpload {
  key: string;
  filename: string;
  progress: number;
  attachment?: AttachmentDto;
  error?: string;
}

// ---------- the composer ----------

export function Composer({
  workspaceId,
  container,
  placeholder,
  parentId,
  onSent,
}: {
  workspaceId: string;
  container: Container;
  placeholder: string;
  parentId?: string;
  onSent?: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const sendMessage = useSendMessage(container);
  const upload = useUploadFile(workspaceId);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [jiraCreateSummary, setJiraCreateSummary] = useState<string | null>(null);
  const [incidentTitle, setIncidentTitle] = useState<string | null>(null);
  const [alsoSend, setAlsoSend] = useState(false);
  const typingRef = useRef<{ active: boolean; timer: ReturnType<typeof setTimeout> | null }>({ active: false, timer: null });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Editor event handlers are bound once at editor creation; route them through a
  // ref so they always call the latest submit (avoids a stale null-editor closure).
  const submitRef = useRef<() => void>(() => undefined);
  const editorRef = useRef<Editor | null>(null);
  const containerIdRef = useRef(container.id);
  containerIdRef.current = container.id;

  const channelMembers = useChannelMembers(container.kind === 'channel' ? container.id : null);
  const conversations = useConversations(workspaceId);
  const dmMembers =
    container.kind === 'conversation'
      ? (conversations.data?.find((c) => c.id === container.id)?.members ?? [])
      : [];

  const mentionCandidates = useCallback((): SuggestionItem[] => {
    const users =
      container.kind === 'channel'
        ? (channelMembers.data ?? [])
        : dmMembers;
    const items: SuggestionItem[] = users.map((u) => ({ id: u.id, label: u.displayName }));
    if (container.kind === 'channel') {
      items.push({ id: 'channel', label: 'channel', hint: 'Notify everyone in this channel' });
      items.push({ id: 'here', label: 'here', hint: 'Notify active members' });
    }
    return items;
  }, [channelMembers.data, dmMembers, container.kind]);

  const typingPayload =
    container.kind === 'channel' ? { channelId: container.id } : { conversationId: container.id };

  const signalTyping = useCallback(() => {
    const socket = getSocket();
    if (!typingRef.current.active) {
      typingRef.current.active = true;
      socket.emit('typing:start', typingPayload);
    }
    if (typingRef.current.timer) clearTimeout(typingRef.current.timer);
    typingRef.current.timer = setTimeout(() => {
      typingRef.current.active = false;
      socket.emit('typing:stop', typingPayload);
    }, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container.id]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          items: ({ query }: { query: string }) =>
            mentionCandidates().filter((i) => i.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
          render: makeSuggestionRender,
        } as Partial<SuggestionOptions>,
      }),
      EmojiSuggestion,
    ],
    editorProps: {
      attributes: { class: 'px-3 py-2 text-[14px]', 'data-testid': 'composer' },
      handleKeyDown: (_view, event) => {
        // Inside a code block, Enter and Shift+Enter add a newline (never send),
        // so multi-line snippets can be written normally.
        if (event.key === 'Enter' && editorRef.current?.isActive('codeBlock')) {
          event.preventDefault();
          editorRef.current.chain().focus().insertContent('\n').run();
          return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          // Let suggestion popups consume Enter first (they use capture handlers).
          const suggestionOpen = document.querySelector('[data-testid^="suggestion-"]');
          if (suggestionOpen) return false;
          event.preventDefault();
          submitRef.current();
          return true;
        }
        if (event.key === 'ArrowUp' && editorRef.current?.isEmpty) {
          // Empty composer + ArrowUp = edit your last message (Slack parity).
          window.dispatchEvent(new CustomEvent('bs:edit-last', { detail: containerIdRef.current }));
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          for (const f of files) void startUpload(f);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          for (const f of files) void startUpload(f);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (!editor.isEmpty) signalTyping();
    },
    // Recreate when the channel (and thus placeholder / mention pool) changes.
  }, [placeholder, container.id]);
  editorRef.current = editor;

  const startUpload = async (file: File) => {
    const key = `${Date.now()}-${file.name}`;
    setUploads((u) => [...u, { key, filename: file.name, progress: 0 }]);
    try {
      const attachment = await upload.mutateAsync({
        file,
        onProgress: (pct) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: pct } : x))),
      });
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: 100, attachment } : x)));
    } catch (err) {
      setUploads((u) =>
        u.map((x) => (x.key === key ? { ...x, error: err instanceof Error ? err.message : 'failed' } : x)),
      );
    }
  };

  const submit = async () => {
    if (!editor) return;
    const text = editor.getText().trim();
    const ready = uploads.filter((u) => u.attachment);
    if (!text && ready.length === 0) return;
    if (uploads.some((u) => !u.attachment && !u.error)) return; // uploads still in flight

    // Slash commands are declared by the server's integration apps; the client
    // only dispatches. A command either runs server-side or names a dialog for
    // us to open with the remaining text.
    if (text.startsWith('/') && container.kind === 'channel') {
      editor.commands.clearContent();
      try {
        const result = await api<CommandResultDto>('POST', `/channels/${container.id}/commands`, {
          text,
        });
        if (result.dialog === 'jira-create') setJiraCreateSummary(result.args ?? '');
        else if (result.dialog === 'incident') setIncidentTitle(result.args ?? '');
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Command failed');
      }
      return;
    }

    const input: SendMessageInput = {
      clientMsgId: crypto.randomUUID(),
      contentJson: editor.getJSON(),
      contentText: text,
      attachmentIds: ready.map((u) => u.attachment!.id),
      ...(parentId ? { parentId, alsoSendToChannel: alsoSend } : {}),
    };
    editor.commands.clearContent();
    setUploads([]);
    setAlsoSend(false);
    if (typingRef.current.active) {
      typingRef.current.active = false;
      getSocket().emit('typing:stop', typingPayload);
    }
    sendMessage.mutate(input, { onSettled: () => onSent?.() });
  };
  submitRef.current = () => void submit();

  // Retry failed optimistic sends (event fired from MessageItem's retry button).
  const qc = useQueryClient();
  useEffect(() => {
    const onRetry = (e: Event) => {
      const clientMsgId = (e as CustomEvent<string>).detail;
      const data = qc.getQueryData<MessagesData>(keys.messages(container.id));
      const failed = data?.pages
        .flatMap((p) => p.messages as PendingMessage[])
        .find((m) => m.clientMsgId === clientMsgId && m.failed);
      if (!failed) return;
      // Drop the failed entry, then resend with the same clientMsgId (idempotent).
      qc.setQueryData<MessagesData>(keys.messages(container.id), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                messages: p.messages.filter((m) => m.clientMsgId !== clientMsgId),
              })),
            }
          : old,
      );
      sendMessage.mutate({
        clientMsgId: clientMsgId!,
        contentJson: failed.contentJson,
        contentText: failed.contentText,
        attachmentIds: failed.attachments.map((a) => a.id),
      });
    };
    window.addEventListener('bs:retry-message', onRetry);
    return () => window.removeEventListener('bs:retry-message', onRetry);
  }, [qc, container.id, sendMessage]);

  useEffect(() => () => {
    if (typingRef.current.timer) clearTimeout(typingRef.current.timer);
  }, []);

  if (!editor) return null;

  const uploadsInFlight = uploads.some((u) => !u.attachment && !u.error);

  return (
    <div className="relative rounded-lg border border-gray-300 bg-white focus-within:border-accent dark:border-gray-600 dark:bg-gray-800">
      {/* formatting toolbar */}
      <div className="flex items-center gap-0.5 border-b border-gray-100 px-2 py-1 dark:border-gray-700">
        <FormatButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <BoldIcon size={14} />
        </FormatButton>
        <FormatButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <ItalicIcon size={14} />
        </FormatButton>
        <FormatButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <Strikethrough size={14} />
        </FormatButton>
        <FormatButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
          <Code size={14} />
        </FormatButton>
        <FormatButton active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
          <SquareCode size={14} />
        </FormatButton>
      </div>

      <EditorContent editor={editor} />

      {/* upload chips */}
      {uploads.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-2">
          {uploads.map((u) => (
            <span
              key={u.key}
              className={clsx(
                'flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
                u.error ? 'border-red-300 text-red-600' : 'border-gray-200 dark:border-gray-600',
              )}
            >
              <Paperclip size={12} />
              <span className="max-w-[140px] truncate">{u.filename}</span>
              {u.error ? (
                <span>{u.error}</span>
              ) : u.attachment ? (
                <span className="text-green-600">ready</span>
              ) : (
                <span className="tabular-nums">{u.progress}%</span>
              )}
              <button onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))} className="text-gray-500 dark:text-gray-400 hover:text-gray-600">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* bottom bar */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-0.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? [])) void startUpload(f);
              e.target.value = '';
            }}
          />
          <FormatButton onClick={() => fileInputRef.current?.click()} title="Attach file">
            <Paperclip size={15} />
          </FormatButton>
          <FormatButton onClick={() => setEmojiOpen((v) => !v)} title="Emoji">
            <Smile size={15} />
          </FormatButton>
          {parentId && (
            <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={alsoSend} onChange={(e) => setAlsoSend(e.target.checked)} data-testid="also-send" />
              Also send to channel
            </label>
          )}
        </div>
        <button
          onClick={() => void submit()}
          disabled={uploadsInFlight}
          title="Send (Enter)"
          data-testid="send-button"
          className="rounded-md bg-accent p-1.5 text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <SendHorizonal size={15} />
        </button>
      </div>

      {emojiOpen && (
        <EmojiPickerPopover
          onPick={(_code, native) => {
            editor.chain().focus().insertContent(native).run();
            setEmojiOpen(false);
          }}
          onClose={() => setEmojiOpen(false)}
        />
      )}

      {jiraCreateSummary !== null && container.kind === 'channel' && (
        <CreateJiraIssueDialog
          workspaceId={workspaceId}
          defaultSummary={jiraCreateSummary}
          onCreate={(input) =>
            api<{ key: string; url: string }>('POST', `/channels/${container.id}/jira/create-issue`, input)
          }
          onClose={() => setJiraCreateSummary(null)}
        />
      )}

      {incidentTitle !== null && (
        <DeclareIncidentDialog
          workspaceId={workspaceId}
          defaultTitle={incidentTitle}
          // The new channel arrives in the sidebar over CHANNEL_CREATED, so
          // there is nothing to navigate here.
          onDeclared={() => undefined}
          onClose={() => setIncidentTitle(null)}
        />
      )}
    </div>
  );
}

function FormatButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        'rounded p-1.5',
        active
          ? 'bg-accent/15 text-accent'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
      )}
    >
      {children}
    </button>
  );
}

// ---------- inline edit editor ----------

export function EditMessageEditor({ message, onDone }: { message: MessageDto; onDone: () => void }) {
  const saveRef = useRef<() => void>(() => undefined);
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({ openOnClick: false, autolink: true }),
      Mention.configure({ HTMLAttributes: { class: 'mention' } }),
    ],
    content: (message.contentJson as object) ?? message.contentText,
    editorProps: {
      attributes: { class: 'px-3 py-2 text-[14px]', 'data-testid': 'edit-editor' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && editorRef.current?.isActive('codeBlock')) {
          event.preventDefault();
          editorRef.current.chain().focus().insertContent('\n').run();
          return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          saveRef.current();
          return true;
        }
        if (event.key === 'Escape') {
          onDone();
          return true;
        }
        return false;
      },
    },
  });

  editorRef.current = editor;

  const save = async () => {
    if (!editor) return;
    const text = editor.getText().trim();
    if (!text) return;
    await api('PATCH', `/messages/${message.id}`, {
      contentJson: editor.getJSON(),
      contentText: text,
    });
    onDone();
  };
  saveRef.current = () => void save();

  if (!editor) return null;
  return (
    <div className="mt-1 rounded-lg border border-accent bg-white dark:bg-gray-800">
      <EditorContent editor={editor} />
      <div className="flex gap-2 px-3 pb-2 text-xs">
        <button onClick={() => void save()} className="rounded bg-accent px-2 py-1 font-semibold text-white" data-testid="edit-save">
          Save
        </button>
        <button onClick={onDone} className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600">
          Cancel
        </button>
        <span className="self-center text-gray-500 dark:text-gray-400">Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}

export function TypingIndicator({ containerId }: { containerId: string }) {
  const typing = useUiStore((s) => s.typing[containerId] ?? []);
  if (typing.length === 0) return <div className="h-5" />;
  const names = typing.map((t) => t.displayName);
  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : 'Several people are typing…';
  return (
    <div className="h-5 px-1 text-xs italic text-gray-500 dark:text-gray-400" data-testid="typing-indicator">
      {label}
    </div>
  );
}
