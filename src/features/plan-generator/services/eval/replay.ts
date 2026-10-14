// src/features/plan-generator/services/eval/replay.ts
// 离线回放的传输层：用一个 fetch 桩**按阶段回放脚本**，让评测在 CI 里跑真实链路。
//
// 三个设计要点：
//   1) **按 system prompt 路由**：与生产一致（网关把角色写进 system），
//      因此"哪个阶段发了什么请求"这件事本身也被评测覆盖到了；
//   2) **脚本可包含错误**：`{ status: 500 }` 用于验证降级链（模型挂了 / schema 被拒）；
//   3) **未匹配的请求直接报错**：宁可让用例炸掉，也不要静默成功 ——
//      否则一次"漏发了请求"会被误判成"链路正常"。
//
// 关于 embedding：离线环境没有向量模型，这里用**哈希词袋伪向量**（确定性、无语义模型）。
// 它足以让"共享词更多的文本相似度更高"，从而把语义召回链路跑通；
// 但它不评价真实语义质量 —— 报告头部的说明里明确写了这条边界。
import { hashText, normalizeVector } from '../rag/embedding';
import type { EvalPageFixtures, EvalScript, ScriptedContext, ScriptedResponse, ScriptedText } from './types';

/** 伪向量维度（够区分几十条候选，又便于人工阅读） */
export const REPLAY_EMBEDDING_DIM = 48;

export type ReplayCallKind =
  | 'clarify'
  | 'keywords'
  | 'plan'
  | 'repair'
  | 'toolCall'
  | 'embed'
  | 'page'
  | 'unmatched';

export interface ReplayCall {
  kind: ReplayCallKind;
  url: string;
  /** 请求的 system 提示（chat 类） */
  system?: string;
  /** 请求的 user 提示（chat 类） */
  user?: string;
  /** 脚本给出的 HTTP 状态（默认 200） */
  status: number;
}

export interface ReplayHandle {
  calls: ReplayCall[];
  /** 某个阶段的调用次数 */
  countOf(kind: ReplayCallKind): number;
  restore(): void;
}

/**
 * 哈希词袋向量化：把文本按词切开、对每个词做哈希落到某一维并计数，最后 L2 归一化。
 * 同一个词在不同文本里落到同一维，因此"共享词更多"的文本余弦相似度更高。
 */
export function pseudoEmbedding(text: string, dim = REPLAY_EMBEDDING_DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const token of tokens) {
    const slot = parseInt(hashText(token), 36) % dim;
    if (Number.isFinite(slot)) vector[slot] += 1;
  }
  return normalizeVector(vector);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 从脚本队列里取一条：只剩最后一条时重复使用（模拟"后续调用都成功"） */
function take(queue: ScriptedResponse[] | undefined, kind: string): ScriptedResponse {
  if (!queue || queue.length === 0) {
    throw new Error(`评测脚本缺少 ${kind} 阶段的响应`);
  }
  return queue.length === 1 ? queue[0] : (queue.shift() as ScriptedResponse);
}

/** 解析脚本文本：允许写成函数，从而引用本次运行的日期白名单 / 资源 id */
export function resolveScriptedText(text: ScriptedText, context: ScriptedContext): string {
  return typeof text === 'function' ? text(context) : text;
}

function matchPage(pages: EvalPageFixtures | undefined, url: string): string | undefined {
  if (!pages) return undefined;
  // 按注册顺序取第一个前缀匹配项（用例里通常是一条完整 URL）
  for (const [prefix, html] of Object.entries(pages)) {
    if (url.startsWith(prefix)) return html;
  }
  return undefined;
}

/**
 * 安装回放用的 fetch 桩。**务必在 finally 里调用 restore()**，
 * 否则会影响同一进程里的其他用例。
 * `context` 会交给脚本文本函数，用于把日期白名单等运行期信息喂回脚本。
 */
export function installReplayFetch(script: EvalScript, context: ScriptedContext): ReplayHandle {
  const original = globalThis.fetch;
  const calls: ReplayCall[] = [];
  // 拷贝一份脚本队列：一次 run 内可以被消费，但不会污染用例定义
  const queues: Record<string, ScriptedResponse[]> = {
    clarify: [...(script.clarify ?? [])],
    keywords: [...(script.keywords ?? [])],
    plan: [...(script.plan ?? [])],
    toolCall: [...(script.toolCall ?? [])],
  };

  const handler = async (input: unknown, init?: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    const rawBody = String((init as RequestInit | undefined)?.body ?? '{}');
    const body = (() => {
      try {
        return JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })();

    // ---- 正文抓取 ----
    const html = matchPage(script.pages, url);
    if (html !== undefined) {
      calls.push({ kind: 'page', url, status: 200 });
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    // ---- embedding（批量 / 逐条） ----
    if (url.endsWith('/api/embed')) {
      const texts = (body.input ?? []) as string[];
      calls.push({ kind: 'embed', url, status: 200 });
      return jsonResponse({ embeddings: texts.map((t) => pseudoEmbedding(t)) });
    }
    if (url.endsWith('/api/embeddings')) {
      calls.push({ kind: 'embed', url, status: 200 });
      return jsonResponse({ embedding: pseudoEmbedding(String(body.prompt ?? '')) });
    }

    // ---- 聊天（按 system 路由到阶段） ----
    if (url.endsWith('/api/chat')) {
      const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const user = messages.find((m) => m.role === 'user')?.content ?? '';

      let kind: ReplayCallKind;
      if (system.includes('规划教练')) kind = 'clarify';
      else if (system.includes('信息检索专家')) kind = 'keywords';
      else if (system.includes('计划调整助手')) kind = 'toolCall';
      else if (system.includes('计划设计专家')) {
        // 同一个 system 同时服务首轮计划与修正轮，用 user 里的固定措辞区分
        kind = user.includes('当前计划存在以下问题') ? 'repair' : 'plan';
      } else {
        calls.push({ kind: 'unmatched', url, system, status: 404 });
        throw new Error(`评测回放收到未注册的 system 提示：${system.slice(0, 60)}`);
      }

      const response = take(kind === 'repair' ? queues.plan : queues[kind], kind);
      if ('status' in response && response.status >= 400) {
        calls.push({ kind, url, system, user, status: response.status });
        return new Response(response.body ?? `replay ${response.status}`, { status: response.status });
      }
      const text = resolveScriptedText((response as { text: ScriptedText }).text, context);
      calls.push({ kind, url, system, user, status: 200 });
      return jsonResponse({ message: { role: 'assistant', content: text } });
    }

    // ---- 其他出站请求：明确失败，让用例暴露"意外的网络依赖" ----
    calls.push({ kind: 'unmatched', url, status: 404 });
    return new Response(`replay: 未注册的请求 ${url}`, { status: 404 });
  };

  globalThis.fetch = handler as unknown as typeof fetch;

  return {
    calls,
    countOf: (kind) => calls.filter((c) => c.kind === kind).length,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
