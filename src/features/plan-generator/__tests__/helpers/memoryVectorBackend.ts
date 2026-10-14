// src/features/plan-generator/__tests__/helpers/memoryVectorBackend.ts
// 测试用的内存向量后端 + "按 system prompt 分发"的聊天桩。
//
// 内存后端本身已上升为产品代码（`services/rag/inMemoryVectorBackend.ts`，
// 离线评测也用它），这里只做一次转出，避免两份实现漂移。本文件不以 `.test.ts`
// 结尾，因此不会被 vitest 当作用例文件收集。
import type { VectorStoreBackend } from '../../services/rag/vectorStore';

export { InMemoryVectorBackend, InMemoryVectorBackend as MemoryVectorBackend } from '../../services/rag/inMemoryVectorBackend';

/** 供旧用例继续引用的类型出口（当前无额外约束，仅保持导入稳定） */
export type { VectorStoreBackend };

/** 按 system prompt 内容分发的桩：用于"一次 run 里要发多种请求"的场景 */
export function stubChatBySystem(
  routes: Array<{ match: string; response: string }>,
): { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  const handler = async (_input: unknown, init?: unknown): Promise<Response> => {
    const body = JSON.parse(String(((init ?? {}) as RequestInit).body ?? '{}')) as {
      messages?: Array<{ role: string; content: string }>;
    };
    const messages = body.messages ?? [];
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    calls.push({ system, user });
    const route = routes.find((r) => system.includes(r.match));
    if (!route) {
      return new Response(`未匹配到请求：${system.slice(0, 40)}`, { status: 500 });
    }
    return new Response(JSON.stringify({ message: { role: 'assistant', content: route.response } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  globalThis.fetch = handler as unknown as typeof fetch;
  return { calls };
}
