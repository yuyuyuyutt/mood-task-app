// src/features/plan-generator/services/planQueue.ts
// 计划任务的「逐条解锁」队列（纯函数，无 IO）。
//
// 背景：一份计划会一次性写入多天、每天 2–5 条任务。任务栏若把它们平铺出来，
// 用户面对的是"十几条待办"而不是"现在该做的那一条"——计划越完整，压迫感越强，
// 而计划本身是连续的（今天做完才轮到明天），平铺其实表达错了结构。
//
// 规则：
//   - 同一份计划的任务构成一个队列，队列里**只放行一条**（下一条待做）；
//   - 这条完成后，顺序里的下一条才出现（其余条目仍在数据库里，只是暂不展示）；
//   - 若用户显式把某条标为「进行中」，则优先放行它 —— 尊重显式意图，不让用户困惑。
//
// 为什么用 tags 分组而不是新增 plan_id 字段：
//   计划任务写入时已带 [目标短标签, 类别, 计划生成] 标签（见 planToTaskPayloads），
//   因此无需改数据库 schema、无需迁移。代价是"同一目标 + 同一类别"生成两次计划会被
//   视为同一队列 —— 这可以接受：本来就是同一件事的延续。
import type { Task } from '../../../types';
import { AI_TAG_PREFIX, PLAN_TAG } from './planToTaskPayloads';

/** 是否是计划生成的任务 */
export function isPlanTask(task: Task): boolean {
  return (task.tags ?? []).includes(PLAN_TAG);
}

/** 计划分组键：去掉元信息标签（计划生成 / AI 生成 …）后剩下的标签组合 */
export function planGroupKey(task: Task): string | null {
  if (!isPlanTask(task)) return null;
  const parts = (task.tags ?? []).filter((t) => t !== PLAN_TAG && !t.startsWith(AI_TAG_PREFIX));
  return parts.join(' · ') || PLAN_TAG;
}

/** 队列内的执行顺序：先按日期（计划的本质是日程），同日再按优先级与创建顺序 */
function compareQueueOrder(a: Task, b: Task): number {
  const ad = a.due_date ?? '';
  const bd = b.due_date ?? '';
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id - b.id;
}

export interface PlanQueueGroup {
  key: string;
  /** 展示名（目标短标签） */
  label: string;
  /** 队列内全部条目（含已完成），按执行顺序 */
  ordered: Task[];
  total: number;
  done: number;
  /** 下一条待做；全部完成时为 undefined */
  next?: Task;
  /** next 在队列中的位置（1 起，用于"第 2/6 条"这类进度提示） */
  position: number;
  /** next 之后还有多少条未完成（用于"完成后显示下一条，还剩 N 条"） */
  remaining: number;
}

/** 把任务集合切成"计划队列"（每个计划一条队列） */
export function buildPlanQueue(tasks: Task[]): PlanQueueGroup[] {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = planGroupKey(task);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(task);
    else groups.set(key, [task]);
  }

  return [...groups.entries()].map(([key, list]) => {
    const ordered = [...list].sort(compareQueueOrder);
    const undone = ordered.filter((t) => t.status !== 'completed');
    const next = undone.find((t) => t.status === 'in_progress') ?? undone[0];
    return {
      key,
      label: (ordered[0]?.tags ?? []).find((t) => t !== PLAN_TAG && !t.startsWith(AI_TAG_PREFIX)) ?? PLAN_TAG,
      ordered,
      total: ordered.length,
      done: ordered.length - undone.length,
      next,
      position: next ? ordered.indexOf(next) + 1 : ordered.length,
      remaining: next ? undone.filter((t) => t.id !== next.id).length : 0,
    };
  });
}

/**
 * 需要暂时隐藏的计划任务 id：队列里除"下一条待做"之外的**未完成**条目。
 * 已完成的条目本来就是历史数据，不在任务栏的进行中视图里。
 */
export function hiddenPlanTaskIds(groups: PlanQueueGroup[]): Set<number> {
  const hidden = new Set<number>();
  for (const group of groups) {
    for (const task of group.ordered) {
      if (task.status !== 'completed' && task.id !== group.next?.id) hidden.add(task.id);
    }
  }
  return hidden;
}

/** 行内进度提示的数据（键为"下一条待做"的 id） */
export interface PlanQueueHint {
  label: string;
  position: number;
  total: number;
  remaining: number;
}

export function planQueueHints(groups: PlanQueueGroup[]): Map<number, PlanQueueHint> {
  const hints = new Map<number, PlanQueueHint>();
  for (const group of groups) {
    if (!group.next) continue;
    hints.set(group.next.id, {
      label: group.label,
      position: group.position,
      total: group.total,
      remaining: group.remaining,
    });
  }
  return hints;
}
