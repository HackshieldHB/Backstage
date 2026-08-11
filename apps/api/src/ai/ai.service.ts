import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

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
