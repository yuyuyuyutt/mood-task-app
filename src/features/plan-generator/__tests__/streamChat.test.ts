// src/features/plan-generator/__tests__/streamChat.test.ts
// 流式对话的传输层：NDJSON / SSE 解析、跨 chunk 半行缓冲、错误与取消语义。
// 学习辅导的"手感"就取决于这一层——非流式要等十几秒才出字。
import { describe, expect, it, vi } from 'vitest';
import { streamChat, type ChatMessage } from '../services/llm/chatClient';
import { DEFAULT_LLM_CONFIG, type LLMConfig } from '../services/llmClient';

const messages: ChatMessage[] = [{ role: 'user', content: '列表推导式怎么用' }];

const ollama: LLMConfig = { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b', timeoutMs: 5_000 };
const openai: LLMConfig = { ...ollama, provider: 'openai-compatible', apiKey: 'k' };

/** 用分块流构造 Response，模拟真实网络的分片（含半行） */
function streamResponse(chunks: string[], status = 200, contentType = 'application/json'): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': contentType } },
  );
}

describe('streamChat：Ollama NDJSON', () => {
  it('逐段回调增量并返回完整文本；跨 chunk 的半行被正确拼回', async () => {
    const deltas: string[] = [];
    globalThis.fetch = (async () =>
      streamResponse([
        '{"message":{"content":"列表推导式"}}\n{"message":{"con', // 半行
        'tent":"把循环压成一行"}}\n{"message":{"content":"。"}}\n{"done":true}\n',
      ])) as unknown as typeof fetch;

    const result = await streamChat(messages, ollama, { onDelta: (d) => deltas.push(d) });

    expect(result.text).toBe('列表推导式把循环压成一行。');
    expect(deltas.join('')).toBe(result.text);
    expect(deltas).toHaveLength(3);
    expect(result.schemaApplied).toBe(false); // 流式不携带 schema
    expect(result.model).toBe('qwen2.5:7b');
  });

  it('请求体带 stream:true，且带 keep_alive（避免本地模型常驻）', async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return streamResponse(['{"message":{"content":"ok"},"done":true}\n']);
    }) as unknown as typeof fetch;

    await streamChat(messages, ollama);
    expect(body.stream).toBe(true);
    expect(body.keep_alive).toBe('30s');
  });

  it('服务端返回错误对象 -> 抛错', async () => {
    globalThis.fetch = (async () =>
      streamResponse(['{"error":"model not found"}\n'])) as unknown as typeof fetch;
    await expect(streamChat(messages, ollama)).rejects.toThrow('model not found');
  });

  it('HTTP 失败 -> 抛错并带上状态码', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(streamChat(messages, ollama)).rejects.toThrow('HTTP 500');
  });
});

describe('streamChat：OpenAI 兼容 SSE', () => {
  it('解析 data: 行，忽略 [DONE] 与心跳', async () => {
    const deltas: string[] = [];
    globalThis.fetch = (async () =>
      streamResponse([
        ': keep-alive\n\n',
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch;

    const result = await streamChat(messages, openai, { onDelta: (d) => deltas.push(d) });
    expect(result.text).toBe('你好，世界');
    expect(deltas).toEqual(['你好', '，世界']);
  });
});

describe('streamChat：边界', () => {
  it('未选择模型 / 空消息 -> 直接抛错（不发请求）', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(streamChat(messages, { ...ollama, model: '' })).rejects.toThrow('未选择模型');
    await expect(streamChat([], ollama)).rejects.toThrow('messages 不能为空');
    expect(spy).toHaveBeenCalledTimes(0);
  });
});
