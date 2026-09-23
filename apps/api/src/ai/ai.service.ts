import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { AskAnswerDto, AskSourceDto } from '@backstages/shared';
import type { HuddleRecapInput, HuddleRecapDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer, conversationContainer } from '../messages/messages.service';

/** Build a minimal TipTap doc from plain-text lines (blank lines → empty paragraphs). */
function textDoc(lines: string[]): unknown {
  return {
    type: 'doc',
    content: lines.map((l) =>
      l.trim() ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' },
    ),
  };
}

/**
 * Parse the model's action-item reply (one item per line) into a clean list:
 * strips list markers/numbering, drops blanks, honours the "NONE" sentinel, and
 * caps the count. Pure so it can be tested without the model.
 */
export function parseActionItems(raw: string): string[] {
  if (/^\s*none\s*$/i.test(raw)) return [];
  return raw
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * AI helpers backed by the Claude API. Enabled only when ANTHROPIC_API_KEY is
 * set; otherwise every endpoint reports "disabled" and the UI hides the actions.
 * Kept to single, stateless calls (summaries, translation) — no tools, no state.
 */
@Injectable()
export class AiService {
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private anthropic(): Anthropic {
    if (!this.enabled) throw new ServiceUnavailableException('AI features are not configured');
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  /** One-shot Claude call returning plain text. Thinking is disabled — these are
   *  lightweight text transforms, not reasoning tasks. */
  private async complete(system: string, user: string, maxTokens = 1024): Promise<string> {
    const res = await this.anthropic().messages.create({
      model: 'claude-opus-5',
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') return 'The assistant declined to respond to this content.';
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  }

  private async accessMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.channelId) await this.policy.requireChannelMember(userId, message.channelId);
    else if (message.conversationId)
      await this.policy.requireConversationMember(userId, message.conversationId);
    return message;
  }

  /**
   * Turn a bundle of weekly facts into a short human narrative. Returns null when
   * AI is not configured so callers can fall back to a plain stats digest.
   */
  async narrateWeekly(facts: string): Promise<string | null> {
    if (!this.enabled) return null;
    return this.complete(
      'You write a team\'s weekly wrap-up from raw activity facts. Open with one upbeat sentence on what the team accomplished, then 3–5 tight bullet points grouping shipped work, decisions, and collaboration. Be concrete, never invent facts beyond those given, and keep it under 130 words. No preamble, no closing sign-off.',
      `Write this week's team wrap-up from these facts:\n\n${facts}`,
      600,
    );
  }

  /**
   * "Ask Backstages" — answers a question grounded in the workspace's decisions
   * and the messages in channels the caller belongs to (never leaks channels they
   * can't see). Retrieval is keyword-based; the model must cite sources and admit
   * when the answer isn't in the context.
   */
  async ask(userId: string, workspaceId: string, question: string): Promise<AskAnswerDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const terms = [...new Set((question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []))].slice(0, 8);
    if (terms.length === 0) return { answer: 'Please ask a more specific question.', sources: [] };

    const [decisions, messages] = await Promise.all([
      this.prisma.decision.findMany({
        where: {
          workspaceId,
          OR: terms.flatMap((t) => [
            { title: { contains: t, mode: 'insensitive' as const } },
            { detail: { contains: t, mode: 'insensitive' as const } },
            { outcome: { contains: t, mode: 'insensitive' as const } },
          ]),
        },
        take: 6,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.message.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          channel: { members: { some: { userId } } },
          OR: terms.map((t) => ({ contentText: { contains: t, mode: 'insensitive' as const } })),
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { displayName: true } }, channel: { select: { id: true, name: true } } },
      }),
    ]);

    const sources: AskSourceDto[] = [];
    const ctx: string[] = [];
    for (const d of decisions) {
      sources.push({ kind: 'decision', label: d.title, ref: d.id, channelId: d.channelId });
      ctx.push(
        `[${sources.length}] DECISION "${d.title}"${d.outcome ? ` — decided: ${d.outcome}` : ''}${d.detail ? ` (${d.detail})` : ''}`,
      );
    }
    for (const m of messages) {
      sources.push({
        kind: 'message',
        label: `#${m.channel?.name ?? 'channel'} · ${m.user?.displayName ?? 'someone'}`,
        ref: m.id,
        channelId: m.channelId,
      });
      ctx.push(
        `[${sources.length}] MESSAGE in #${m.channel?.name ?? 'channel'} by ${m.user?.displayName ?? 'someone'}: ${m.contentText.slice(0, 300)}`,
      );
    }

    if (ctx.length === 0) {
      return {
        answer: "I couldn't find anything about that in this workspace's decisions or your channels.",
        sources: [],
      };
    }

    const answer = await this.complete(
      "You answer a teammate's question using ONLY the numbered context from their workspace. Cite the sources you rely on inline as [n]. Be concise (2–5 sentences). If the context doesn't contain the answer, say you couldn't find it — never invent facts.",
      `Question: ${question}\n\nContext:\n${ctx.join('\n')}`,
      700,
    );
    return { answer, sources };
  }

  async summarizeThread(userId: string, messageId: string): Promise<{ summary: string }> {
    const parent = await this.accessMessage(userId, messageId);
    const replies = await this.prisma.message.findMany({
      where: { parentId: messageId, deletedAt: null },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const parentAuthor = await this.prisma.user.findUnique({
      where: { id: parent.userId ?? '' },
      select: { displayName: true },
    });
    const transcript = [
      `${parentAuthor?.displayName ?? 'Someone'}: ${parent.contentText}`,
      ...replies.map((r) => `${r.user?.displayName ?? 'Someone'}: ${r.contentText}`),
    ].join('\n');

    const summary = await this.complete(
      'You summarize a chat thread for a teammate who missed it. Reply with 2–4 short bullet points capturing decisions, questions, and action items. No preamble.',
      `Summarize this thread:\n\n${transcript}`,
    );
    return { summary };
  }

  async summarizeChannel(userId: string, channelId: string): Promise<{ summary: string }> {
    await this.policy.requireChannelMember(userId, channelId);
    const messages = await this.prisma.message.findMany({
      where: { channelId, parentId: null, deletedAt: null },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const transcript = messages
      .reverse()
      .map((m) => `${m.user?.displayName ?? 'Someone'}: ${m.contentText}`)
      .join('\n');
    if (!transcript.trim()) return { summary: 'No recent messages to summarize.' };

    const summary = await this.complete(
      'You catch a teammate up on a busy channel. Reply with a short digest: the main topics, any decisions, and open action items, as tight bullet points. No preamble.',
      `Summarize the recent conversation in this channel:\n\n${transcript}`,
      1500,
    );
    return { summary };
  }

  /**
   * Pulls concrete action items out of a thread so they can be turned into Jira
   * issues. Returns one imperative line per item (empty when there are none).
   */
  async extractActionItems(userId: string, messageId: string): Promise<{ items: string[] }> {
    const parent = await this.accessMessage(userId, messageId);
    const rootId = parent.parentId ?? parent.id;
    const rows = await this.prisma.message.findMany({
      where: { OR: [{ id: rootId }, { parentId: rootId }], deletedAt: null },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const transcript = rows
      .map((r) => `${r.user?.displayName ?? 'Someone'}: ${r.contentText}`)
      .join('\n');
    if (!transcript.trim()) return { items: [] };

    const out = await this.complete(
      'You extract concrete, actionable to-do items from a team discussion. Reply with one action item per line in the imperative voice — no numbering, no preamble. If there are no clear action items, reply with the single word NONE.',
      `Extract the action items from this discussion:\n\n${transcript}`,
      600,
    );
    return { items: parseActionItems(out) };
  }

  /**
   * Summarise a huddle from its in-meeting chat + notes into a short recap and a
   * list of action items, and (optionally) post the recap into the huddle's
   * channel/DM as a message so the meeting leaves a durable artifact.
   */
  async huddleRecap(userId: string, workspaceId: string, input: HuddleRecapInput): Promise<HuddleRecapDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (input.channelId) await this.policy.requireChannelMember(userId, input.channelId);
    else if (input.conversationId) await this.policy.requireConversationMember(userId, input.conversationId);

    const transcript = input.transcript.slice(0, 16000).trim();
    if (!transcript) return { summary: '', actionItems: [], posted: false };

    const [summary, itemsRaw] = await Promise.all([
      this.complete(
        'You summarise a team meeting from its chat and shared notes. Write 3–6 concise bullet points (each starting with "- ") covering the key discussion and any decisions. No preamble, no closing remarks.',
        transcript,
        600,
      ),
      this.complete(
        'You extract concrete action items from a meeting. Reply with one action item per line in the imperative voice — prefix an owner when clearly named (e.g. "Kevin — review the config"). No numbering, no preamble. Reply with the single word NONE if there are none.',
        transcript,
        500,
      ),
    ]);
    const actionItems = parseActionItems(itemsRaw);

    let posted = false;
    if (input.post && (input.channelId || input.conversationId)) {
      const lines = ['🧠 Huddle recap', '', ...summary.split('\n')];
      if (actionItems.length) {
        lines.push('', 'Action items:', ...actionItems.map((i) => `• ${i}`));
      }
      const contentText = lines.join('\n');
      const container = input.channelId
        ? channelContainer(input.channelId)
        : conversationContainer(input.conversationId!);
      await this.integrationMessages.post(container, {
        workspaceId,
        contentText,
        contentJson: textDoc(lines),
      });
      posted = true;
    }
    return { summary, actionItems, posted };
  }

  /**
   * Generate structured minutes from a meeting transcript (captions + chat + notes):
   * a bulleted summary, the decisions reached, and concrete action items. Throws
   * when AI isn't configured so the caller can surface a clear "not available".
   */
  async generateMinutes(
    transcript: string,
  ): Promise<{ summary: string; decisions: string[]; actionItems: string[] }> {
    if (!this.enabled) throw new ServiceUnavailableException('AI features are not configured');
    const text = transcript.slice(0, 24000).trim();
    if (!text) return { summary: '', decisions: [], actionItems: [] };
    const [summary, decisionsRaw, itemsRaw] = await Promise.all([
      this.complete(
        'You write concise minutes of a team meeting from its transcript. Reply with 3–6 bullet points (each starting with "- ") covering the key discussion. No preamble, no closing remarks.',
        text,
        700,
      ),
      this.complete(
        'You list the concrete decisions a team reached in this meeting. One decision per line, no numbering, no preamble. Reply with the single word NONE if there are none.',
        text,
        400,
      ),
      this.complete(
        'You extract concrete action items from a meeting. Reply with one action item per line in the imperative voice — prefix an owner when clearly named (e.g. "Kevin — review the config"). No numbering, no preamble. Reply with the single word NONE if there are none.',
        text,
        500,
      ),
    ]);
    return { summary, decisions: parseActionItems(decisionsRaw), actionItems: parseActionItems(itemsRaw) };
  }

  /** Translate a short piece of free text (e.g. a live caption line). No auth —
   *  the caller supplies the text; returns '' when AI is off or the text is empty. */
  async translateText(text: string, targetLanguage: string): Promise<{ translation: string }> {
    const t = (text || '').trim();
    if (!t || !this.enabled) return { translation: '' };
    const lang = (targetLanguage || 'English').slice(0, 40);
    const translation = await this.complete(
      `You are a translator. Translate the user's text into ${lang}. Reply with ONLY the translation — no notes, no quotes, no preamble.`,
      t.slice(0, 2000),
      400,
    );
    return { translation };
  }

  async translate(
    userId: string,
    messageId: string,
    targetLanguage: string,
  ): Promise<{ translation: string }> {
    const message = await this.accessMessage(userId, messageId);
    if (!message.contentText.trim()) return { translation: '' };
    const lang = (targetLanguage || 'English').slice(0, 40);
    const translation = await this.complete(
      `You are a translator. Translate the user's message into ${lang}. Reply with only the translation — no notes, no quotes, no preamble.`,
      message.contentText,
    );
    return { translation };
  }
}
