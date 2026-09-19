// src/features/plan-generator/services/llmClient.ts
// LLM 传输层：与 Ollama 的底层通讯（探测 + 生成）。
// 所有请求都：5 秒–60 秒可配置超时、可取消（AbortSignal）、失败抛错由上层降级。
export type LLMProviderKind = 'ollama' | 'openai-compatible';

export interface LLMConfig {
  enabled: boolean;
  provider: LLMProviderKind;
  /** Ollama: http://127.0.0.1:11434 */
  baseUrl: string;
  /** 模型名，如 qwen2.5:7b */
  model: string;
  /** 远端 OpenAI 兼容服务的密钥（Ollama 本地无需填写） */
  apiKey?: string;
  /** 采样温度（0 更稳定） */
  temperature?: number;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** Ollama 模型驻留时长（默认 '30s'，到时卸载避免常驻占用 CPU） */
  keepAlive?: string;
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  enabled: false, // 默认关闭
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  temperature: 0.4,
  timeoutMs: 90_000,
};

/** 判断端点是否为本机（用于 UI 警示强度） */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(host);
  } catch {
    return false;
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export interface OllamaProbe {
  ok: boolean;
  models: string[];
  error?: string;
}

/** 探测本地 Ollama 并列出已安装模型（GET /api/tags） */
export async function probeOllama(baseUrl: string, timeoutMs = 6000): Promise<OllamaProbe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${trimSlash(baseUrl)}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, models: [], error: `Ollama 返回 HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    return { ok: true, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      models: [],
      error: msg.includes('abort')
        ? '连接超时：请确认 Ollama 已启动（ollama serve）'
        : `无法连接 Ollama：${msg}。若控制台提示 CORS，请设置 OLLAMA_ORIGINS="*" 后重启 Ollama`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface CallOllamaOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 要求返回 JSON（Ollama format: 'json'） */
  json?: boolean;
}

/** 调用 Ollama /api/generate（非流式），返回模型文本 */
export async function callOllamaText(
  prompt: string,
  config: LLMConfig,
  options: CallOllamaOptions = {},
): Promise<string> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? config.timeoutMs ?? 90_000);
  try {
    const res = await fetch(`${trimSlash(config.baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: config.model,
        prompt,
        // 30 秒后卸载模型：避免本地模型常驻占用 CPU / 内存
        keep_alive: config.keepAlive ?? '30s',
        stream: false,
        ...(options.json === false ? {} : { format: 'json' }),
        options: { temperature: config.temperature ?? 0.4 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ''}`);
    }
    const data = (await res.json()) as { response?: string; error?: string };
    if (data.error) throw new Error(`Ollama 错误：${data.error}`);
    return data.response ?? '';
  } catch (err) {
    if (options.signal?.aborted) throw new Error('已取消');
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) throw new Error(`Ollama 请求超时（${options.timeoutMs ?? config.timeoutMs ?? 90_000}ms）`);
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
