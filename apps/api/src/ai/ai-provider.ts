import Anthropic from '@anthropic-ai/sdk';

/**
 * Which language model the AI features use. Two kinds:
 *  - Anthropic (Claude): ANTHROPIC_API_KEY (optionally ANTHROPIC_MODEL).
 *  - Any OpenAI-compatible chat API: AI_BASE_URL + AI_MODEL (+ AI_API_KEY).
 *    That covers OpenAI (GPT), Groq, Google Gemini's OpenAI endpoint,
 *    OpenRouter, and a self-hosted Ollama (free, no key).
 * AI_PROVIDER=anthropic|openai picks one explicitly; otherwise an
 * OpenAI-compatible setup wins when AI_BASE_URL is set, then Claude.
 */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export interface CompletionRequest {
  system: string;
  messages: ChatTurn[];
  /** Ask for a single JSON object back (the prompt must describe its shape). */
  json?: boolean;
  /** With `json`: the exact schema. Claude enforces it (structured outputs);
   *  OpenAI-compatible APIs get JSON mode and the prompt's description. */
  jsonSchema?: Record<string, unknown>;
  /** Upper bound for the reply. */
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  /** The model declined (safety). */
  refused: boolean;
  /** The reply was cut off by the token limit. */
  truncated: boolean;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai';
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export interface OpenAiCompatConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

/** Read the provider config from the environment; null when AI is off. */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  const explicit = env.AI_PROVIDER?.trim().toLowerCase();
  const compat = openAiCompatConfig(env);
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (explicit === 'anthropic')
    return anthropicKey ? new AnthropicProvider(env.ANTHROPIC_MODEL) : null;
  if (explicit === 'openai') return compat ? new OpenAiCompatProvider(compat) : null;
  if (compat) return new OpenAiCompatProvider(compat);
  if (anthropicKey) return new AnthropicProvider(env.ANTHROPIC_MODEL);
  return null;
}

export function openAiCompatConfig(env: NodeJS.ProcessEnv): OpenAiCompatConfig | null {
  const baseUrl = env.AI_BASE_URL?.trim();
  const model = env.AI_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const timeout = Number(env.AI_TIMEOUT_MS);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    apiKey: (env.AI_API_KEY ?? env.OPENAI_API_KEY)?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 90_000,
  };
}

/** Claude through the official SDK (the behaviour the app shipped with). */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private client: Anthropic | null = null;

  constructor(model?: string) {
    this.model = model?.trim() || 'claude-opus-5-5';
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.client) this.client = new Anthropic();
    // Effort is low (these are light text tasks); max_tokens also covers
    // thinking, so it stays generous. A safety decline is retried server-side
    // on a fallback model before we give up.
    const structured = req.json && req.jsonSchema;
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      output_config: structured
        ? { effort: 'low', format: { type: 'json_schema', schema: req.jsonSchema! } }
        : { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system:
        req.json && !structured
          ? `${req.system}\n\nReply with a single JSON object only — no prose, no code fences.`
          : req.system,
      messages: req.messages,
    });
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return {
      text,
      refused: res.stop_reason === 'refusal',
      truncated: res.stop_reason === 'max_tokens',
    };
  }
}

/** Any `/chat/completions` API (OpenAI, Groq, Gemini, OpenRouter, Ollama…). */
export class OpenAiCompatProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly model: string;

  constructor(
    private readonly cfg: OpenAiCompatConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.model = cfg.model;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_tokens: req.maxTokens ?? 1024,
      temperature: 0.3,
    };
    if (req.json) body.response_format = { type: 'json_object' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        controller.signal.aborted
          ? 'The AI model took too long to answer.'
          : `Could not reach the AI model (${err instanceof Error ? err.message : 'network error'}).`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(
        `The AI model returned an error (${res.status})${detail ? `: ${detail}` : ''}`,
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; refusal?: string | null };
        finish_reason?: string;
      }>;
    };
    const choice = data.choices?.[0];
    const text = (choice?.message?.content ?? '').trim();
    return {
      text,
      refused: !!choice?.message?.refusal || choice?.finish_reason === 'content_filter',
      truncated: choice?.finish_reason === 'length',
    };
  }
}

/** Pull the first JSON object out of a reply (some models wrap it in prose or fences). */
export function extractJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('No JSON object in the reply');
  }
}
