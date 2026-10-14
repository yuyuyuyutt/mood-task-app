// src/features/plan-generator/services/agent/trace.ts
// Agent 运行轨迹（run-level trace）：这是"可观测"这一项的全部实现。
//
// 为什么要有它：AI 类功能最常被追问的是"你怎么知道它为什么失败"。
// 本项目的答案不是一个 console.warn，而是一条结构化记录：
//   本次 run 用了哪一级能力（agent / pipeline / rule）、
//   每一步耗时与成败、调了哪些工具、召回了哪些记忆、
//   在哪个环节降级、降级原因是什么、prompt 是哪个版本。
//
// 存储策略：内存环形缓冲（保留最近 MAX_TRACES 条）+ 防抖落盘到 IndexedDB，
// 与插件注册表的持久化手法一致；落盘失败静默忽略（可观测性不能反过来拖垮业务）。
import { PROMPT_VERSION } from '../prompts';

export type TraceKind = 'clarify' | 'keywords' | 'plan' | 'adjust' | 'study';
/** 能力级别：agent = 多步/工具编排；pipeline = 既有固定管线；rule = 纯规则兜底 */
/**
 * 运行级别：与多角色编排的判定保持一致（见 agents/orchestrator.ts 末尾的三级判定）。
 * - `multi`    ：四个角色全部跑通
 * - `single`   ：部分 specialist 失败，规划仍由模型完成
 * - `pipeline` ：只有检索 + 规划
 * - `agent`    ：一次多角色 run 的**编排层**轨迹（角色之间的消息与裁决）
 * - `rule`     ：规划回退到规则引擎
 */
export type TraceLevel = 'multi' | 'single' | 'agent' | 'pipeline' | 'rule';
export type TraceStepKind =
  | 'llm'
  | 'tool'
  | 'retrieval'
  | 'memory'
  | 'rule'
  | 'guard'
  /** 角色 hop（Clarifier / Researcher / Planner / Critic / 修正轮） */
  | 'agent';

export interface TraceStep {
  name: string;
  kind: TraceStepKind;
  ok: boolean;
  ms: number;
  /** 简短结论（截断保存，避免 trace 变成日志垃圾场） */
  note?: string;
  detail?: Record<string, unknown>;
}

export interface TraceFallback {
  stage: string;
  reason: string;
}

export interface TraceToolCall {
  name: string;
  ok: boolean;
  reason?: string;
  args?: unknown;
}

export interface AgentRunTrace {
  id: string;
  kind: TraceKind;
  level: TraceLevel;
  goal?: string;
  model?: string | null;
  promptVersion: string;
  startedAt: string;
  endedAt?: string;
  ms?: number;
  /** 是否成功把 JSON Schema 交给服务端（降级重试后为 false） */
  schemaApplied?: boolean;
  steps: TraceStep[];
  fallbacks: TraceFallback[];
  toolCalls: TraceToolCall[];
  memoryHits: string[];
  warnings: string[];
}

/** 内存中保留的 trace 条数 */
export const MAX_TRACES = 20;
const MAX_NOTE = 160;
const MAX_FALLBACKS = 8;
const MAX_TOOL_CALLS = 20;

export function nextTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clip(text: string | undefined, max = MAX_NOTE): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 单次 run 的写入句柄：业务代码通过它记录过程，跑完 end() 落库 */
export class TraceRecorder {
  private readonly trace: AgentRunTrace;

  constructor(kind: TraceKind, goal?: string, level: TraceLevel = 'pipeline') {
    this.trace = {
      id: nextTraceId(),
      kind,
      level,
      goal: clip(goal, 60),
      model: null,
      promptVersion: PROMPT_VERSION,
      startedAt: new Date().toISOString(),
      steps: [],
      fallbacks: [],
      toolCalls: [],
      memoryHits: [],
      warnings: [],
    };
  }

  get id(): string {
    return this.trace.id;
  }

  setLevel(level: TraceLevel): this {
    this.trace.level = level;
    return this;
  }

  setModel(model: string | null | undefined): this {
    this.trace.model = model ?? null;
    return this;
  }

  setSchemaApplied(applied: boolean): this {
    this.trace.schemaApplied = applied;
    return this;
  }

  step(name: string, kind: TraceStepKind, ms: number, ok: boolean, note?: string, detail?: Record<string, unknown>): this {
    this.trace.steps.push({ name, kind, ok, ms: Math.round(ms), note: clip(note), detail });
    return this;
  }

  fallback(stage: string, reason: string): this {
    if (this.trace.fallbacks.length >= MAX_FALLBACKS) return this;
    this.trace.fallbacks.push({ stage: clip(stage, 40) ?? stage, reason: clip(reason, 160) ?? String(reason) });
    return this;
  }

  tool(name: string, ok: boolean, reason?: string, args?: unknown): this {
    if (this.trace.toolCalls.length >= MAX_TOOL_CALLS) return this;
    this.trace.toolCalls.push({ name, ok, reason: clip(reason), args });
    return this;
  }

  memory(noteIds: string[]): this {
    for (const id of noteIds) {
      if (this.trace.memoryHits.length >= MAX_TOOL_CALLS) break;
      this.trace.memoryHits.push(id);
    }
    return this;
  }

  warn(message: string): this {
    if (this.trace.warnings.length >= MAX_FALLBACKS) return this;
    this.trace.warnings.push(clip(message, 160) ?? String(message));
    return this;
  }

  /** 包住一段异步操作，自动记录耗时与成败（失败时把错误信息写进 note，不吞异常） */
  async measure<T>(name: string, kind: TraceStepKind, run: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await run();
      this.step(name, kind, Date.now() - start, true);
      return result;
    } catch (err) {
      this.step(name, kind, Date.now() - start, false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  end(extra?: { warnings?: string[] }): AgentRunTrace {
    const endedAt = new Date().toISOString();
    const finished: AgentRunTrace = {
      ...this.trace,
      endedAt,
      ms: Date.parse(endedAt) - Date.parse(this.trace.startedAt),
      warnings: [...this.trace.warnings, ...(extra?.warnings ?? [])].slice(0, MAX_FALLBACKS),
    };
    traceStore.record(finished);
    return finished;
  }
}

/** trace 仓库：内存环形缓冲 + 防抖落盘 + 订阅（UI 面板消费） */
export class TraceStore {
  private traces: AgentRunTrace[] = [];
  private listeners = new Set<(traces: AgentRunTrace[]) => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly capacity = MAX_TRACES) {}

  list(): AgentRunTrace[] {
    return this.traces;
  }

  latest(kind?: TraceKind): AgentRunTrace | undefined {
    return kind ? this.traces.find((t) => t.kind === kind) : this.traces[0];
  }

  subscribe(fn: (traces: AgentRunTrace[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  record(trace: AgentRunTrace): void {
    this.traces = [trace, ...this.traces].slice(0, this.capacity);
    for (const fn of this.listeners) fn(this.traces);
    this.schedulePersist();
  }

  clear(): void {
    this.traces = [];
    for (const fn of this.listeners) fn(this.traces);
    this.schedulePersist();
  }

  /** 从本地存储恢复（启动时调用一次；失败静默忽略） */
  async hydrate(): Promise<void> {
    try {
      const { KV_TRACES, kvGet } = await import('../../db/plannerDB');
      const saved = await kvGet<AgentRunTrace[]>(KV_TRACES);
      if (Array.isArray(saved) && saved.length > 0) {
        this.traces = saved.slice(0, this.capacity);
        for (const fn of this.listeners) fn(this.traces);
      }
    } catch {
      /* 可观测性失败不影响业务 */
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer != null) clearTimeout(this.persistTimer);
    // 防抖：批量 run 时只落盘一次
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void (async () => {
        try {
          const { KV_TRACES, kvSet } = await import('../../db/plannerDB');
          await kvSet(KV_TRACES, this.traces);
        } catch {
          /* 忽略：浏览器隐私模式 / 配额不足都不应影响主流程 */
        }
      })();
    }, 400);
  }
}

/** 全局单例：与 llmTasks 一样，整个 plan-generator 共用一个 trace store */
export const traceStore = new TraceStore();
