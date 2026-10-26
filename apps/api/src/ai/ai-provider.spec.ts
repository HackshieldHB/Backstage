import {
  AnthropicProvider,
  OpenAiCompatProvider,
  extractJsonObject,
  resolveProvider,
} from './ai-provider';
import { keepCitedSources } from './ai.service';

describe('resolveProvider', () => {
  it('is off with no configuration', () => {
    expect(resolveProvider({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('uses Claude when only ANTHROPIC_API_KEY is set', () => {
    const p = resolveProvider({ ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p?.model).toBe('claude-opus-5-5');
  });

  it('prefers an OpenAI-compatible setup when AI_BASE_URL and AI_MODEL are set', () => {
    const p = resolveProvider({
      ANTHROPIC_API_KEY: 'k',
      AI_BASE_URL: 'https://api.groq.com/openai/v1/',
      AI_MODEL: 'llama-3.3-70b-versatile',
    } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(OpenAiCompatProvider);
    expect(p?.model).toBe('llama-3.3-70b-versatile');
  });

  it('honours AI_PROVIDER and needs the matching config', () => {
    const env = {
      AI_PROVIDER: 'anthropic',
      AI_BASE_URL: 'http://x',
      AI_MODEL: 'm',
    } as NodeJS.ProcessEnv;
    expect(resolveProvider(env)).toBeNull();
    expect(resolveProvider({ ...env, ANTHROPIC_API_KEY: 'k' })).toBeInstanceOf(AnthropicProvider);
    expect(
      resolveProvider({ AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('needs both a base URL and a model for OpenAI-compatible', () => {
    expect(
      resolveProvider({ AI_BASE_URL: 'http://localhost:11434/v1' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});

describe('OpenAiCompatProvider', () => {
  const ok = (body: unknown) =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response;

  it('posts a chat completion with the system prompt first and reads the reply', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        ok({ choices: [{ message: { content: '  Hello there  ' }, finish_reason: 'stop' }] }),
      );
    const p = new OpenAiCompatProvider(
      { baseUrl: 'http://llm/v1', model: 'm', apiKey: 'secret', timeoutMs: 5000 },
      fetchImpl as unknown as typeof fetch,
    );
    const res = await p.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      json: true,
    });
    expect(res).toEqual({ text: 'Hello there', refused: false, truncated: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://llm/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('m');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('sends no Authorization header without a key (e.g. Ollama)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ choices: [{ message: { content: 'x' } }] }));
    const p = new OpenAiCompatProvider(
      { baseUrl: 'http://o/v1', model: 'm', timeoutMs: 5000 },
      fetchImpl as never,
    );
    await p.complete({ system: 's', messages: [{ role: 'user', content: 'q' }] });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('reports truncation and refusals', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        ok({ choices: [{ message: { content: 'cut' }, finish_reason: 'length' }] }),
      )
      .mockResolvedValueOnce(
        ok({ choices: [{ message: { content: '', refusal: 'no' }, finish_reason: 'stop' }] }),
      );
    const p = new OpenAiCompatProvider(
      { baseUrl: 'http://o/v1', model: 'm', timeoutMs: 5000 },
      fetchImpl as never,
    );
    expect((await p.complete({ system: 's', messages: [] })).truncated).toBe(true);
    expect((await p.complete({ system: 's', messages: [] })).refused).toBe(true);
  });

  it('turns HTTP errors into a readable error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' } as Response);
    const p = new OpenAiCompatProvider(
      { baseUrl: 'http://o/v1', model: 'm', timeoutMs: 5000 },
      fetchImpl as never,
    );
    await expect(p.complete({ system: 's', messages: [] })).rejects.toThrow(
      'The AI model returned an error (401): bad key',
    );
  });

  it('turns network failures into a readable error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const p = new OpenAiCompatProvider(
      { baseUrl: 'http://o/v1', model: 'm', timeoutMs: 5000 },
      fetchImpl as never,
    );
    await expect(p.complete({ system: 's', messages: [] })).rejects.toThrow(
      'Could not reach the AI model (ECONNREFUSED).',
    );
  });
});

describe('extractJsonObject', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Sure! Here it is: {"a":3} — hope that helps')).toEqual({ a: 3 });
  });

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('nope')).toThrow();
  });
});

describe('keepCitedSources', () => {
  const src = (ref: string) => ({ kind: 'message' as const, label: ref, ref, channelId: 'c' });

  it('keeps only cited sources and renumbers them in order of first use', () => {
    const out = keepCitedSources('Per [3], then [1]. Also [3] again.', [
      src('a'),
      src('b'),
      src('c'),
    ]);
    expect(out.answer).toBe('Per [1], then [2]. Also [1] again.');
    expect(out.sources.map((s) => s.ref)).toEqual(['c', 'a']);
  });

  it('drops markers that point at no source and leaves uncited text alone', () => {
    const out = keepCitedSources('Something [9] and nothing else.', [src('a')]);
    expect(out.answer).toBe('Something  and nothing else.');
    expect(out.sources).toEqual([]);
  });
});
