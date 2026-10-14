// src/features/plan-generator/__tests__/chatClient.test.ts
// 模型网关的契约测试：/api/chat 的请求形状、JSON Schema 透传与"服务端拒绝 schema 时自动降级"。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callChat, chatCompletionsUrl, shouldRetryWithoutSchema } from '../services/llm/chatClient';
import { ALLOWED_SCHEMA_KEYWORDS, PLAN_SCHEMA, collectSchemaKeywords } from '../services/llm/schemas';
import { DEFAULT_LLM_CONFIG } from '../services/llmClient';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ollamaConfig = { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b' };

interface Capture {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function stubFetch(
  handler: (capture: Capture, callIndex: number) => Response,
): { calls: Capture[] } {
  const calls: Capture[] = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
    const requestInit = (init ?? {}) as RequestInit;
    const signal = requestInit.signal as AbortSignal | undefined;
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    const capture: Capture = {
      url: String(input),
      body: JSON.parse(String(requestInit.body ?? '{}')) as Record<string, unknown>,
      headers: (requestInit.headers ?? {}) as Record<string, string>,
    };
    calls.push(capture);
    return handler(capture, calls.length - 1);
  }) as unknown as typeof fetch;
  return { calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('JSON Schema 契约', () => {
  it('只使用 llama.cpp grammar 支持的保守关键字', () => {
    const used = collectSchemaKeywords(PLAN_SCHEMA);
    for (const keyword of used) {
      expect(ALLOWED_SCHEMA_KEYWORDS.has(keyword)).toBe(true);
    }
  });

  it('plan schema 硬性要求 strategy / narrative / days 三个字段', () => {
    expect(PLAN_SCHEMA.required).toEqual(['strategy', 'narrative', 'days']);
  });
});

describe('端点与降级判定', () => {
  it('chatCompletionsUrl 兼容"已带 /v1"的地址', () => {
    expect(chatCompletionsUrl('http://localhost:8000')).toBe('http://localhost:8000/v1/chat/completions');
    expect(chatCompletionsUrl('http://localhost:8000/v1/')).toBe('http://localhost:8000/v1/chat/completions');
  });

  it('只在"服务端明确不接受 schema/format"时才重试', () => {
    expect(shouldRetryWithoutSchema('模型服务返回 HTTP 400：json: cannot compile grammar')).toBe(true);
    expect(shouldRetryWithoutSchema('unsupported format')).toBe(true);
    expect(shouldRetryWithoutSchema('模型服务返回 HTTP 500：boom')).toBe(false);
    expect(shouldRetryWithoutSchema('模型请求超时（90000ms）')).toBe(false);
  });
});

describe('callChat（Ollama /api/chat）', () => {
  it('system 与 user 分离、schema 走 format、stream=false，并回传 schemaApplied', async () => {
    const { calls } = stubFetch(() => jsonResponse({ message: { role: 'assistant', content: '{"ok":true}' } }));

    const res = await callChat(
      [
        { role: 'system', content: '你是规划教练' },
        { role: 'user', content: '目标：学习 Python' },
      ],
      ollamaConfig,
      { schema: PLAN_SCHEMA },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:11434/api/chat');
    expect(calls[0].body.stream).toBe(false);
    expect(calls[0].body.format).toEqual(PLAN_SCHEMA);
    const messages = calls[0].body.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0].content).toContain('规划教练');

    expect(res.text).toBe('{"ok":true}');
    expect(res.schemaApplied).toBe(true);
    expect(res.provider).toBe('ollama');
    expect(res.warnings).toEqual([]);
  });

  it('服务端拒绝 schema → 自动去掉约束重试一次，并记录降级原因', async () => {
    const { calls } = stubFetch((_capture, index) =>
      index === 0
        ? new Response('json: cannot compile grammar', { status: 400 })
        : jsonResponse({ message: { content: '{"fallback":true}' } }),
    );

    const res = await callChat([{ role: 'user', content: 'hi' }], ollamaConfig, { schema: PLAN_SCHEMA });

    expect(calls).toHaveLength(2);
    expect(calls[0].body.format).toEqual(PLAN_SCHEMA);
    expect(calls[1].body.format).toBe('json'); // 退化为 json 模式
    expect(res.schemaApplied).toBe(false);
    expect(res.warnings[0]).toContain('已退化为 json 模式');
    expect(res.text).toBe('{"fallback":true}');
  });

  it('HTTP 500 不重试，直接抛错交给上层降级', async () => {
    const { calls } = stubFetch(() => new Response('boom', { status: 500 }));
    await expect(callChat([{ role: 'user', content: 'hi' }], ollamaConfig, { schema: PLAN_SCHEMA })).rejects.toThrow(
      'HTTP 500',
    );
    expect(calls).toHaveLength(1);
  });

  it('未选择模型 / 空 messages 直接抛错', async () => {
    await expect(callChat([{ role: 'user', content: 'hi' }], { ...ollamaConfig, model: '' })).rejects.toThrow(
      '未选择模型',
    );
    await expect(callChat([], ollamaConfig)).rejects.toThrow('messages 不能为空');
  });

  it('外部 signal 已中止时给出"已取消"语义（不误报超时）', async () => {
    stubFetch(() => jsonResponse({ message: { content: 'x' } }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      callChat([{ role: 'user', content: 'hi' }], ollamaConfig, { signal: controller.signal }),
    ).rejects.toThrow('已取消');
  });
});

describe('callChat（OpenAI 兼容端点）', () => {
  it('走 /v1/chat/completions 并带上 Authorization 与 response_format', async () => {
    const { calls } = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"ok":1}' } }] }),
    );

    const res = await callChat([{ role: 'user', content: 'hi' }], {
      ...ollamaConfig,
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'sk-test',
    });

    expect(calls[0].url).toBe('http://localhost:8000/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test');
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
    expect(res.text).toBe('{"ok":1}');
    expect(res.provider).toBe('openai-compatible');
  });
});
