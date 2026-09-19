// src/features/plan-generator/services/taskMaterializer.ts
// 把计划"落地"为数据库中真实存在的任务：
// - 每条计划项 -> 一条任务，due_date = 计划中的具体日期（任务表按日期呈现）；
// - 通过既有 api.createTask（Tauri -> SQLite tasks 表）写入，不使用任何远端服务；
// - 记录写入的任务 id，支持一键撤回（删除这些任务）。
import { api } from '../../../api';
import type { GeneratedPlan } from '../types';
import { planToTaskPayloads, type NewTaskPayload } from './planToTaskPayloads';

export interface MaterializeResult {
  created: number;
  failed: number;
  /** 写入成功的任务 id（用于撤回） */
  taskIds: number[];
  /** 出错信息（最多保留前 5 条） */
  errors: string[];
}

/** 是否运行在 Tauri（仅桌面端可写入 SQLite 任务表） */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 将计划写入任务表。
 * @param plan 计划
 * @param onProgress 逐条进度回调（用于 UI 显示 3/12）
 */
export async function materializePlan(
  plan: GeneratedPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<MaterializeResult> {
  const payloads: NewTaskPayload[] = planToTaskPayloads(plan);
  const result: MaterializeResult = { created: 0, failed: 0, taskIds: [], errors: [] };

  if (!isDesktopRuntime()) {
    return {
      created: 0,
      failed: payloads.length,
      taskIds: [],
      errors: ['当前环境不是桌面应用，无法写入本地数据库（请在 Tauri 桌面端使用此功能）'],
    };
  }

  let done = 0;
  for (const payload of payloads) {
    try {
      const id = await api.createTask(payload);
      if (typeof id === 'number' && Number.isFinite(id)) {
        result.taskIds.push(id);
        result.created += 1;
      } else {
        result.failed += 1;
      }
    } catch (err) {
      result.failed += 1;
      if (result.errors.length < 5) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    } finally {
      done += 1;
      onProgress?.(done, payloads.length);
    }
  }
  return result;
}

/** 撤回：删除此前写入的任务 */
export async function rollbackMaterialized(
  taskIds: number[],
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const id of taskIds) {
    try {
      await api.deleteTask(id);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

/** 该计划已写入多少条任务 */
export function materializedCount(plan: GeneratedPlan): number {
  return plan.materializedTaskIds?.length ?? 0;
}

/** 计划总共包含多少个可写入项 */
export function plannedItemCount(plan: GeneratedPlan): number {
  return planToTaskPayloads(plan).length;
}
