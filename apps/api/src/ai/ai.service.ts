import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { extractJsonObject, resolveProvider, type ChatTurn, type LlmProvider } from './ai-provider';
import type { AskAnswerDto, AskSourceDto } from '@backstages/shared';
import type { HuddleRecapInput, HuddleRecapDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { WebSearchService } from './web-search';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer, conversationContainer } from '../messages/messages.service';

/**
 * Keep only the sources a reply actually cites, renumbering its [n] markers
 * 1..k in order of first use; markers pointing at no source are dropped.
 */
export function keepCitedSources(answer: string, sources: AskSourceDto[]): AskAnswerDto {
  const cited = [...new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))].filter(
    (n) => n >= 1 && n <= sources.length,
  );
  const renumber = new Map(cited.map((n, i) => [n, i + 1]));
  const text = answer.replace(/\[(\d{1,2})\]/g, (_whole, n: string) => {
    const next = renumber.get(Number(n));
    return next ? `[${next}]` : '';
  });
  return { answer: text, sources: cited.map((n) => sources[n - 1]) };
}

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
 * AI helpers backed by a language model: Claude, or any OpenAI-compatible chat
 * API (GPT, Groq, Gemini, OpenRouter, a self-hosted Ollama) — see ai-provider.ts.
 * Enabled only when a provider is configured; otherwise every endpoint reports
 * "disabled" and the UI hides or explains the actions.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: LlmProvider | null = resolveProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly integrationMessages: IntegrationMessagesService,
    private readonly web: WebSearchService,
  ) {
    if (this.provider) this.logger.log(`AI enabled: ${this.provider.name} (${this.provider.model})`);
  }

  get enabled(): boolean {
    return this.provider !== null;
  }

  private llm(): LlmProvider {
    if (!this.provider) throw new ServiceUnavailableException('AI features are not configured');
    return this.provider;
  }

  /** One-shot call returning plain text. Output length is steered by the prompts. */
  private async complete(system: string, user: string): Promise<string> {
    const res = await this.llm().complete({ system, messages: [{ role: 'user', content: user }] });
    if (res.refused) return 'The assistant declined to respond to this content.';
    return res.text;
  }

  /**
   * Suggest an order for the day's work. Returns the item ids in the suggested
   * order with a short reason each, or null when AI is off, declines, or replies
   * with something unusable. Callers still validate ids against what they sent.
   */
  async planDay(context: string): Promise<Array<{ id: string; reason: string }> | null> {
    if (!this.enabled) return null;
    const res = await this.llm().complete({
      json: true,
      jsonSchema: {
        type: 'object',
        properties: {
          order: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, reason: { type: 'string' } },
              required: ['id', 'reason'],
              additionalProperties: false,
            },
          },
        },
        required: ['order'],
        additionalProperties: false,
      },
      system:
        'You help a teammate plan their working day. Order the given work items into the sequence they should tackle them today, considering deadlines, people waiting on them, priority, and the fixed meetings (work around them; do not list meetings). Give each item a reason of at most 12 words. Include every item id exactly once and only ids from the list. Reply as JSON: {"order":[{"id":"…","reason":"…"}]}.',
      messages: [{ role: 'user', content: context }],
    });
    if (res.refused || res.truncated) return null;
    try {
      const parsed = extractJsonObject(res.text) as { order?: Array<{ id?: unknown; reason?: unknown }> };
      return (parsed.order ?? [])
        .filter((o) => typeof o.id === 'string' && typeof o.reason === 'string')
        .map((o) => ({ id: o.id as string, reason: (o.reason as string).slice(0, 120) }));
    } catch {
      return null;
    }
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
    );
  }

  /**
   * "Ask Backstages" — answers a question grounded in the workspace's decisions
   * and the messages in channels the caller belongs to (never leaks channels they
   * can't see). Retrieval is keyword-based; the model must cite sources and admit
   * when the answer isn't in the context.
   */
  /**
   * Find what the workspace knows about a question: recorded decisions, messages
   * in channels and DMs the caller is in, and their own tasks. Returns numbered
   * context lines for the model plus the matching sources for the UI.
   */
  private async gatherContext(
    userId: string,
    workspaceId: string,
    question: string,
  ): Promise<{ ctx: string[]; sources: AskSourceDto[] }> {
    const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 8);
    if (terms.length === 0) return { ctx: [], sources: [] };

    const [decisions, messages, tasks] = await Promise.all([
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
          // Only places the caller can read: their channels and their DMs.
          AND: [
            {
              OR: [
                { channel: { members: { some: { userId } } } },
                { conversation: { members: { some: { userId } } } },
              ],
            },
            { OR: terms.map((t) => ({ contentText: { contains: t, mode: 'insensitive' as const } })) },
          ],
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { displayName: true } }, channel: { select: { id: true, name: true } } },
      }),
      // Only tasks the caller created or is assigned (same visibility as the Tasks pane).
      this.prisma.task.findMany({
        where: {
          workspaceId,
          OR: [{ createdById: userId }, { assigneeId: userId }],
          AND: [
            {
              OR: terms.flatMap((t) => [
                { title: { contains: t, mode: 'insensitive' as const } },
                { notes: { contains: t, mode: 'insensitive' as const } },
              ]),
            },
          ],
        },
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { assignee: { select: { displayName: true } } },
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
      const where = m.channel ? `#${m.channel.name}` : 'a direct message';
      sources.push({
        kind: 'message',
        label: `${m.channel ? `#${m.channel.name}` : 'DM'} · ${m.user?.displayName ?? 'someone'}`,
        ref: m.id,
        channelId: m.channelId,
        conversationId: m.conversationId,
      });
      ctx.push(`[${sources.length}] MESSAGE in ${where} by ${m.user?.displayName ?? 'someone'}: ${m.contentText.slice(0, 300)}`);
    }
    for (const t of tasks) {
      sources.push({ kind: 'task', label: t.title, ref: t.id, channelId: t.channelId });
      const due = t.dueAt ? `, due ${t.dueAt.toISOString().slice(0, 10)}` : '';
      ctx.push(
        `[${sources.length}] TASK "${t.title}" — ${t.status === 'DONE' ? 'done' : 'open'}${due}${t.assignee ? `, assigned to ${t.assignee.displayName}` : ''}`,
      );
    }
    return { ctx, sources };
  }

  async ask(userId: string, workspaceId: string, question: string): Promise<AskAnswerDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (!/[\p{L}\p{N}]{3,}/u.test(question)) return { answer: 'Please ask a more specific question.', sources: [] };
    const { ctx, sources } = await this.gatherContext(userId, workspaceId, question);
    if (ctx.length === 0) {
      return {
        answer: "I couldn't find anything about that in this workspace's decisions, tasks or your channels.",
        sources: [],
      };
    }
    const answer = await this.complete(
      "You answer a teammate's question using ONLY the numbered context from their workspace. Cite the sources you rely on inline as [n]. Be concise (2–5 sentences). If the context doesn't contain the answer, say you couldn't find it — never invent facts.",
      `Question: ${question}\n\nContext:\n${ctx.join('\n')}`,
    );
    return { answer, sources };
  }

  /**
   * The assistant chat (the floating "Stagehand"). A normal conversation: it
   * helps with writing, brainstorming and how-to from general knowledge, and
   * whenever the workspace has something relevant (decisions, messages in the
   * caller's channels/DMs, their tasks) it answers from that and cites [n].
   * Only the sources actually cited are returned.
   */
  async chat(userId: string, workspaceId: string, messages: ChatTurn[]): Promise<AskAnswerDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const recent = messages.slice(-12);
    const userTurns = recent.filter((m) => m.role === 'user');
    // Search with the latest question plus the one before it, so short follow-ups
    // ("and who owns it?") still find the topic.
    const query = userTurns
      .slice(-2)
      .map((m) => m.content)
      .join(' ');
    const { ctx, sources } = await this.gatherContext(userId, workspaceId, query);
    // Live information (web, news, weather) for questions about the outside world.
    // Short follow-ups ("and tomorrow?") carry the previous question along.
    const latest = userTurns[userTurns.length - 1]?.content ?? '';
    const webQuestion = latest.trim().split(/\s+/).length < 4 && userTurns.length > 1 ? query : latest;
    const web = await this.web.lookup(webQuestion, ctx.length > 0);
    if (web) {
      web.lines.forEach((line, i) => {
        sources.push(web.sources[i] ?? web.sources[0]);
        ctx.push(`[${sources.length}] ${line}`);
      });
    }

    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
    const system = [
      `You are Stagehand, the friendly AI assistant inside Backstages, a team chat app. You are helping a member of the "${workspace?.name ?? 'team'}" workspace.`,
      'Be warm, clear and concise (usually under 150 words). Use short paragraphs or "-" bullet lists; plain text otherwise (bold with **text** is fine).',
      "Always reply in the language the user writes in.",
      `Current date and time: ${new Date().toUTCString()}.`,
      ctx.length > 0
        ? 'Below is numbered context: items from their workspace, and live results from the internet (marked WEB, WEATHER or FORECAST). When it is relevant, answer from it and cite inline as [n]. For news, weather, prices and other real-time questions, answer from the live results and say how recent they are; if they do not contain the answer, say you could not find current information instead of guessing. Never invent workspace facts (decisions, owners, dates, people) that are not in the context; if the context does not cover a workspace question, say so plainly. For general questions (writing, brainstorming, explanations) answer from general knowledge without citations.'
        : 'Nothing in their workspace or on the web matched this message. For questions about their team, decisions, tasks or messages, say you could not find it rather than guessing. For real-time questions (news, weather, prices) say you could not fetch current information right now. For general questions (writing, brainstorming, explanations) answer from general knowledge.',
      ctx.length > 0 ? `\nContext:\n${ctx.join('\n')}` : '',
    ].join('\n');

    const res = await this.llm().complete({ system, messages: recent, maxTokens: 900 });
    if (res.refused) return { answer: "Sorry — I can't help with that one.", sources: [] };
    const answer = res.text || "Sorry, I couldn't come up with an answer. Try rephrasing?";

    const result = keepCitedSources(answer, sources);
    // Live answers always show where they came from, even when the model forgot to cite.
    if (web && !result.sources.some((s) => s.kind === 'web')) {
      const seen = new Set<string>();
      for (const s of web.sources) {
        if (seen.has(s.ref) || seen.size >= 3) continue;
        seen.add(s.ref);
        result.sources.push(s);
      }
    }
    return result;
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
      ),
      this.complete(
        'You extract concrete action items from a meeting. Reply with one action item per line in the imperative voice — prefix an owner when clearly named (e.g. "Kevin — review the config"). No numbering, no preamble. Reply with the single word NONE if there are none.',
        transcript,
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
        appName: 'Backstages AI',
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
      ),
      this.complete(
        'You list the concrete decisions a team reached in this meeting. One decision per line, no numbering, no preamble. Reply with the single word NONE if there are none.',
        text,
      ),
      this.complete(
        'You extract concrete action items from a meeting. Reply with one action item per line in the imperative voice — prefix an owner when clearly named (e.g. "Kevin — review the config"). No numbering, no preamble. Reply with the single word NONE if there are none.',
        text,
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
