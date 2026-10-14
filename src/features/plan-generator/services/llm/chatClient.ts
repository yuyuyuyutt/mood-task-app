// src/features/plan-generator/services/llm/chatClient.ts
// 模型网关：所有"需要模型做决策"的调用都从这里出去。
//
// 相对既有 llmClient（/api/generate，单条 prompt）的三点升级：
//   1) 走 /api/chat，system / user 分离 —— 角色与硬性约束放 system（稳定、可复用），
//      数据放 user。这既提升了本地小模型的指令遵循率，也为将来的 prompt 前缀缓存留了位置；
//   2) 支持 JSON Schema 结构化输出（Ollama format 支持传 schema 对象）——
//      把"事后容错解析"前移为"解码阶段约束"；
//   3) 统一超时 / 取消 / 降级语义，并把降级原因回传给上层写入 trace。
//
// 降级纪律（沿用项目既有原则，绝不阻塞业务）：
//   - 服务端拒绝 schema（老版本 Ollama / 不支持的模型后端）→ 自动退化为 format:'json' 重试一次；
//   - 仍然失败 → 抛错，由调用方回退到模板 / 规则路径。
import type { LLMConfig, LLMProviderKind } from '../llmClient';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  /** JSON Schema：交给支持结构化输出的后端做解码约束 */
  schema?: object;
  /** 没有 schema 时是否仍要求 JSON（默认 true） */
  json?: boolean;
}

export interface ChatCallResult {
  text: string;
  model: string;
  provider: LLMProviderKind;
  /** 本次是否真的把 schema 交给了服务端（降级重试后为 false） */
  schemaApplied: boolean;
  durationMs: number;
  /** 过程中的降级说明（会写进 trace） */
  warnings: string[];
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** OpenAI 兼容端点：baseUrl 已含 /v1 时不再重复拼接 */
export function chatCompletionsUrl(baseUrl: string): string {
  const base = trimSlash(baseUrl);
  return /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** 把外部 signal 与超时合并成一个内部 controller */
function linkAbort(signal: AbortSignal | undefined, timeoutMs: number): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/** 判断是否为"服务端不支持该 schema"类错误（值得去掉 schema 重试一次） */
export function shouldRetryWithoutSchema(message: string): boolean {
  return /http\s*400|grammar|format|invalid\s+schema|unsupported/i.test(message);
}

function describeError(err: unknown, signal: AbortSignal | undefined, timeoutMs: number): Error {
  if (signal?.aborted) return new Error('已取消');
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort/i.test(msg)) return new Error(`模型请求超时（${timeoutMs}ms）`);
  return err instanceof Error ? err : new Error(msg);
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`模型服务返回 HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

interface SingleCallContext {
  messages: ChatMessage[];
  config: LLMConfig;
  options: ChatCallOptions;
  schema: object | undefined;
  timeoutMs: number;
  warnings: string[];
}

async function callOllamaChat(ctx: SingleCallContext): Promise<string> {
  const { messages, config, options, schema, timeoutMs } = ctx;
  const { controller, dispose } = linkAbort(options.signal, timeoutMs);
  try {
    const data = await postJson(
      `${trimSlash(config.baseUrl)}/api/chat`,
      {
        model: config.model,
        messages,
        stream: false,
        // 30 秒后卸载模型：避免本地模型常驻占用 CPU / 内存
        keep_alive: config.keepAlive ?? '30s',
        ...(schema
          ? { format: schema }
          : options.json === false
            ? {}
            : { format: 'json' }),
        options: { temperature: options.temperature ?? config.temperature ?? 0.4 },
      },
      {},
      controller.signal,
    );
    if (typeof data.error === 'string' && data.error) throw new Error(`模型服务错误：${data.error}`);
    const message = data.message as { content?: string } | undefined;
    return message?.content ?? '';
  } catch (err) {
    throw describeError(err, options.signal, timeoutMs);
  } finally {
    dispose();
  }
}

async function callOpenAiCompatibleChat(ctx: SingleCallContext): Promise<string> {
  const { messages, config, options, schema, timeoutMs } = ctx;
  const { controller, dispose } = linkAbort(options.signal, timeoutMs);
  try {
    const data = await postJson(
      chatCompletionsUrl(config.baseUrl),
      {
        model: config.model,
        messages,
        temperature: options.temperature ?? config.temperature ?? 0.4,
        stream: false,
        ...(schema || options.json !== false ? { response_format: { type: 'json_object' } } : {}),
      },
      config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      controller.signal,
    );
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? '';
  } catch (err) {
    throw describeError(err, options.signal, timeoutMs);
  } finally {
    dispose();
  }
}

/**
 * 调用模型完成一次对话。
 * @throws 未选择模型 / 网络失败 / 超时（调用方负责降级）
 */
export async function callChat(
  messages: ChatMessage[],
  config: LLMConfig,
  options: ChatCallOptions = {},
): Promise<ChatCallResult> {
  if (!config.model) throw new Error('未选择模型');
  if (messages.length === 0) throw new Error('messages 不能为空');

  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? 90_000;
  const warnings: string[] = [];
  const started = Date.now();

  const run = (schema: object | undefined) =>
    config.provider === 'openai-compatible'
      ? callOpenAiCompatibleChat({ messages, config, options, schema, timeoutMs, warnings })
      : callOllamaChat({ messages, config, options, schema, timeoutMs, warnings });

  try {
    const text = await run(options.schema);
    return {
      text,
      model: config.model,
      provider: config.provider,
      schemaApplied: Boolean(options.schema),
      durationMs: Date.now() - started,
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 服务端不支持 schema / format 时，去掉约束重试一次（jsonExtract 仍会在下游兜底）
    if (options.schema && shouldRetryWithoutSchema(msg)) {
      warnings.push(`服务端拒绝 JSON Schema（${msg.slice(0, 80)}），已退化为 json 模式`);
      const text = await run(undefined);
      return {
        text,
        model: config.model,
        provider: config.provider,
        schemaApplied: false,
        durationMs: Date.now() - started,
        warnings,
      };
    }
    throw err;
  }
}

/** 便捷封装：单条 user 消息（无 system） */
export function userMessage(content: string): ChatMessage {
  return { role: 'user', content };
}

// ==================== 流式对话 ====================
//
// 为什么单独一条路径：本地 7B 模型上一段完整回答要十几秒，等最终 JSON 再渲染会让
// "辅导对话"这种交互完全没法用；流式把首字延迟降到 1 秒内，体验差别最大。
//
// 纪律：
//   - 流式**不携带 JSON Schema**（对话类回答不需要结构化，且流式 + 解码约束在部分后端会互相干扰）；
//     需要结构化输出的场景继续走 `callChat`；
//   - 取消/超时语义与 `callChat` 完全一致（复用 linkAbort），因此可以安全地放进 `llmTasks.run`；
//   - 逐行解析 NDJSON / SSE，**处理跨 chunk 的半行**（这是流式最常见的坑）。

export interface StreamChatOptions extends ChatCallOptions {
  /** 每收到一段增量就回调一次（UI 直接往消息里追加） */
  onDelta?: (chunk: string) => void;
}

/** 按行读取流式响应；没有 body（老环境）时退化为整段读取 */
async function readLineStream(res: Response, onLine: (line: string) => void): Promise<void> {
  const body = res.body;
  if (!body) {
    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onLine(line);
      index = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) onLine(tail);
}

async function streamOllamaChat(
  messages: ChatMessage[],
  config: LLMConfig,
  options: StreamChatOptions,
  timeoutMs: number,
): Promise<string> {
  const { controller, dispose } = linkAbort(options.signal, timeoutMs);
  try {
    const res = await fetch(`${trimSlash(config.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        keep_alive: config.keepAlive ?? '30s',
        options: { temperature: options.temperature ?? config.temperature ?? 0.4 },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`模型服务返回 HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`);
    }

    let out = '';
    await readLineStream(res, (line) => {
      let data: { error?: string; message?: { content?: string }; done?: boolean };
      try {
        data = JSON.parse(line) as typeof data;
      } catch {
        return; // 半个 JSON 或心跳行，忽略
      }
      if (typeof data.error === 'string' && data.error) throw new Error(`模型服务错误：${data.error}`);
      const delta = data.message?.content ?? '';
      if (delta) {
        out += delta;
        options.onDelta?.(delta);
      }
    });
    return out;
  } catch (err) {
    throw describeError(err, options.signal, timeoutMs);
  } finally {
    dispose();
  }
}

async function streamOpenAiCompatibleChat(
  messages: ChatMessage[],
  config: LLMConfig,
  options: StreamChatOptions,
  timeoutMs: number,
): Promise<string> {
  const { controller, dispose } = linkAbort(options.signal, timeoutMs);
  try {
    const res = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: options.temperature ?? config.temperature ?? 0.4,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`模型服务返回 HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`);
    }

    let out = '';
    await readLineStream(res, (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const data = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = data.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          out += delta;
          options.onDelta?.(delta);
        }
      } catch {
        /* 忽略无法解析的行 */
      }
    });
    return out;
  } catch (err) {
    throw describeError(err, options.signal, timeoutMs);
  } finally {
    dispose();
  }
}

/**
 * 流式调用模型（逐段回调 `onDelta`，最终返回完整文本）。
 * @throws 未选择模型 / 网络失败 / 超时（调用方负责降级）
 */
export async function streamChat(
  messages: ChatMessage[],
  config: LLMConfig,
  options: StreamChatOptions = {},
): Promise<ChatCallResult> {
  if (!config.model) throw new Error('未选择模型');
  if (messages.length === 0) throw new Error('messages 不能为空');

  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? 90_000;
  const started = Date.now();
  const text =
    config.provider === 'openai-compatible'
      ? await streamOpenAiCompatibleChat(messages, config, options, timeoutMs)
      : await streamOllamaChat(messages, config, options, timeoutMs);

  return {
    text,
    model: config.model,
    provider: config.provider,
    // 流式路径不携带 schema（见上方说明），因此固定为 false
    schemaApplied: false,
    durationMs: Date.now() - started,
    warnings: [],
  };
}
