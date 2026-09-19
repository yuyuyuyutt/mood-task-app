// src/features/plan-generator/services/llmTaskManager.ts
// LLM 任务生命周期管理器：所有 LLM 调用（澄清 / 关键词 / 计划）都必须经过它。
//
// 目标：
// - 避免 CPU 常驻占用：串行执行（并发 1），且每次派发前等待浏览器空闲；
//   向导卸载/上一步返回时 cancelAll()，立刻中止在途请求；
// - 避免竞态：同一 key（如 'clarify'）只保留最新一次调用，旧的自动取消；
// - 统一超时与错误语义，便于上层静默降级。
export type LlmTaskKind = 'clarify' | 'keywords' | 'plan';

export interface LlmRunOptions<T> {
  kind: LlmTaskKind;
  /** 去重键：同 key 的新任务会取消尚未完成的旧任务 */
  key: string;
  /** 任务超时（毫秒） */
  timeoutMs?: number;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 实际工作（必须尊重传入的 signal） */
  run: (signal: AbortSignal) => Promise<T>;
}

export interface LlmManagerStats {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** 最近一次任务的类型（UI 可显示"AI 正在处理：澄清问题"） */
  lastKind: LlmTaskKind | null;
}

interface QueueItem {
  kind: LlmTaskKind;
  key: string;
  timeoutMs: number;
  controller: AbortController;
  /** 任务被取消时的拒绝回调（排队中被丢弃 / 运行中被中止都必须 settle） */
  cancelTask: () => void;
  execute: () => Promise<void>;
}

/** 等待浏览器空闲（避免在用户交互/渲染高峰期启动重计算） */
export function whenIdle(timeoutMs = 300): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === 'function') {
      ric(() => resolve(), { timeout: timeoutMs });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export class LlmTaskManager {
  private queue: QueueItem[] = [];
  /** 正在执行的任务（cancelAll/cancel 也必须把它们中止，否则请求会继续占用资源） */
  private runningItems = new Set<QueueItem>();
  private running = 0;
  private stats = { completed: 0, failed: 0, cancelled: 0 };
  private lastKind: LlmTaskKind | null = null;
  private listeners = new Set<(s: LlmManagerStats) => void>();

  constructor(private concurrency = 1) {}

  getStats(): LlmManagerStats {
    return {
      running: this.running,
      queued: this.queue.length,
      completed: this.stats.completed,
      failed: this.stats.failed,
      cancelled: this.stats.cancelled,
      lastKind: this.lastKind,
    };
  }

  subscribe(fn: (s: LlmManagerStats) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 提交一个 LLM 任务；同 key 的旧任务会被取消 */
  run<T>(options: LlmRunOptions<T>): Promise<T> {
    this.cancel(options.key); // 同 key 去重：只保留最新一次
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const item: QueueItem = {
        kind: options.kind,
        key: options.key,
        timeoutMs: options.timeoutMs ?? 120_000,
        controller,
        cancelTask: () => {
          this.stats.cancelled += 1;
          finish(() => reject(new Error('任务已取消')));
        },
        execute: async () => {
          if (controller.signal.aborted) {
            this.stats.cancelled += 1;
            finish(() => reject(new Error('任务已取消')));
            return;
          }
          this.lastKind = options.kind;
          this.emit();
          const timer = setTimeout(() => controller.abort(), item.timeoutMs);
          try {
            await whenIdle(); // 空闲再开工：不与渲染/交互抢 CPU
            const result = await options.run(controller.signal);
            if (controller.signal.aborted) throw new Error('任务已取消');
            this.stats.completed += 1;
            finish(() => resolve(result));
          } catch (err) {
            if (controller.signal.aborted) {
              this.stats.cancelled += 1;
              finish(() => reject(new Error('任务已取消')));
            } else {
              this.stats.failed += 1;
              finish(() => reject(err));
            }
          } finally {
            clearTimeout(timer);
            this.emit();
          }
        },
      };
      this.queue.push(item);
      this.emit();
      void this.pump();
    });
  }

  /** 取消指定 key 的排队与进行中任务（两者都会被 settle，避免调用方永久等待） */
  cancel(key: string): void {
    this.queue = this.queue.filter((item) => {
      if (item.key !== key) return true;
      item.controller.abort();
      item.cancelTask();
      return false;
    });
    for (const item of this.runningItems) {
      if (item.key === key) {
        item.controller.abort();
        item.cancelTask();
      }
    }
    this.emit();
  }

  /** 取消全部任务（向导卸载 / 返回上一步时调用，确保不留常驻请求） */
  cancelAll(): void {
    for (const item of this.queue) {
      item.controller.abort();
      item.cancelTask();
    }
    this.queue = [];
    for (const item of this.runningItems) {
      item.controller.abort();
      item.cancelTask();
    }
    this.emit();
  }

  private async pump(): Promise<void> {
    if (this.running >= this.concurrency) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running += 1;
    this.runningItems.add(next);
    this.emit();
    try {
      await next.execute();
    } finally {
      this.runningItems.delete(next);
      this.running -= 1;
      this.emit();
      void this.pump();
    }
  }

  private emit(): void {
    const stats = this.getStats();
    for (const fn of this.listeners) fn(stats);
  }
}

/** 全局单例：整个功能共用一个管理器，避免多处并发压垮本地模型 */
export const llmTasks = new LlmTaskManager(1);
