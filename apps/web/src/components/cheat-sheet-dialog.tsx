'use client';

import { Dialog } from './dialog';

function Row({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-sm text-gray-600 dark:text-gray-300">{desc}</span>
      <kbd className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
        {keys}
      </kbd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 pt-2 first:border-t-0 first:pt-0 dark:border-gray-800">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      {children}
    </div>
  );
}

/** Quick reference for slash commands, composer syntax, and shortcuts. */
export function CheatSheetDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Tips & shortcuts" onClose={onClose}>
      <div className="space-y-3">
        <Section title="Slash commands">
          <Row keys="/jira KEY-123" desc="Post a live Jira issue status card" />
          <Row keys="/jira create <summary>" desc="Create a Jira issue in this channel" />
          <Row keys="/incident <title>" desc="Spin up an incident channel, issue and postmortem" />
        </Section>

        <Section title="In the message box">
          <Row keys="@name" desc="Mention someone (@channel, @here too)" />
          <Row keys=":smile:" desc="Emoji autocomplete → inserts the emoji" />
          <Row keys="Enter" desc="Send message" />
          <Row keys="Shift+Enter" desc="New line" />
          <Row keys="Enter (in code block)" desc="New line — code blocks never send" />
          <Row keys="↑" desc="Edit your last message (when box is empty)" />
          <Row keys="drag / paste" desc="Attach files" />
        </Section>

        <Section title="Formatting">
          <Row keys="**bold**  *italic*" desc="Bold / italic" />
          <Row keys="`code`" desc="Inline code" />
          <Row keys="``` code block" desc="Multi-line code (toolbar button too)" />
        </Section>

        <Section title="Navigation">
          <Row keys="⌘K / Ctrl+K" desc="Search messages, files, people" />
          <Row keys="Esc" desc="Close the side panel" />
          <Row keys="Click an avatar" desc="Open that person's profile" />
        </Section>

        <Section title="Integrations">
          <Row keys="Jira / Confluence" desc="Browse projects & spaces in the sidebar" />
          <Row keys="🗂 message action" desc="Create a Jira issue from any message" />
        </Section>
      </div>
    </Dialog>
  );
}
