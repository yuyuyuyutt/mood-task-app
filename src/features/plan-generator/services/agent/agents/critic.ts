// src/features/plan-generator/services/agent/agents/critic.ts
// Critic 角色：**确定性**的约束校验器（不调模型），外加一个"安全的自动修正"。
//
// 为什么不把 Critic 做成另一个 LLM 调用：
//   - 这里要检查的是硬约束（每天项数、时长偏差、引用是否越界），本来就是可判定的，
//     确定性代码比模型更准、更快、更便宜，而且**结论可复现**（评测时不会漂移）；
//   - 模型只在"需要结构性改动"时才被请回来做一次修正（见 orchestrator 的 repair 轮），
//     并且仍然要过同一套白名单与 schema。
//
// 修正的分工：
//   - 安全类（时长超限）→ 本模块直接给出确定性修正（只减不增，不会改变计划意图）；
//   - 结构类（项数不合理、引用越界）→ 只报告，交给模型/用户处理，不做猜测性删改。
import type { GeneratedPlan, PlanDay } from '../../../types';
import { fitMinutesToTarget } from '../tools/builtin/planEditTools';

export type ViolationType =
  | 'items_per_day'
  | 'duration_sum'
  | 'unknown_citation'
  | 'missing_risk'
  | 'empty_day'
  | 'uncovered_evidence';

export interface PlanViolation {
  type: ViolationType;
  day?: string;
  detail: string;
  severity: 'error' | 'warn';
}

export interface CritiqueInput {
  plan: GeneratedPlan;
  /** 用户设定的每日投入（分钟） */
  minutesPerDay: number;
  validResourceIds?: Set<string>;
  validEvidenceIds?: Set<string>;
  /** 每天项数区间（默认 2–5） */
  itemRange?: { min: number; max: number };
  /** 时长允许偏差（默认 30%） */
  durationTolerance?: number;
}

export interface CritiqueReport {
  ok: boolean;
  /** 实际检查了多少条规则（可观测：别只说"检查通过"，要说检查了什么） */
  checked: number;
  violations: PlanViolation[];
}

function dayMinutes(day: PlanDay): number {
  return (day.tasks ?? []).reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
}

/**
 * 校验计划的硬约束。返回的 violations 同时用于：
 *   - UI 展示（哪些地方不满足要求）
 *   - trace（可观测）
 *   - 是否需要发起修正轮
 */
export function critiquePlan(input: CritiqueInput): CritiqueReport {
  const { plan, minutesPerDay } = input;
  const itemRange = input.itemRange ?? { min: 2, max: 5 };
  const tolerance = input.durationTolerance ?? 0.3;
  const violations: PlanViolation[] = [];
  let checked = 0;

  for (const day of plan.days) {
    const tasks = day.tasks ?? [];
    if (tasks.length === 0) {
      checked += 1;
      violations.push({
        type: 'empty_day',
        day: day.date,
        detail: `${day.date} 没有任何任务项`,
        severity: 'error',
      });
      continue;
    }

    checked += 1;
    if (tasks.length < itemRange.min || tasks.length > itemRange.max) {
      violations.push({
        type: 'items_per_day',
        day: day.date,
        detail: `${day.date} 有 ${tasks.length} 项（要求 ${itemRange.min}–${itemRange.max} 项）`,
        severity: 'warn',
      });
    }

    checked += 1;
    const total = dayMinutes(day);
    const deviation = minutesPerDay > 0 ? Math.abs(total - minutesPerDay) / minutesPerDay : 0;
    if (deviation > tolerance) {
      violations.push({
        type: 'duration_sum',
        day: day.date,
        detail: `${day.date} 合计 ${total} 分钟，与每日投入 ${minutesPerDay} 分钟偏差 ${Math.round(
          deviation * 100,
        )}%（上限 ${Math.round(tolerance * 100)}%）`,
        severity: 'error',
      });
    }

    checked += 1;
    for (const task of tasks) {
      for (const id of task.resourceIds ?? []) {
        if (input.validResourceIds && !input.validResourceIds.has(id)) {
          violations.push({
            type: 'unknown_citation',
            day: day.date,
            detail: `${task.title} 引用了不存在的资源 ${id}`,
            severity: 'error',
          });
        }
      }
      for (const id of task.evidenceIds ?? []) {
        if (input.validEvidenceIds && !input.validEvidenceIds.has(id)) {
          violations.push({
            type: 'unknown_citation',
            day: day.date,
            detail: `${task.title} 引用了不在证据清单里的 ${id}`,
            severity: 'error',
          });
        }
      }
    }
  }

  checked += 1;
  const risks = plan.strategy?.risks ?? [];
  if (risks.length < 2) {
    violations.push({
      type: 'missing_risk',
      detail: `风险提示只有 ${risks.length} 条（要求至少 2 条）`,
      severity: 'error',
    });
  }

  // 证据注入了却一条都没被引用 → 说明模型没读它，值得提醒（不算错误）
  if (input.validEvidenceIds && input.validEvidenceIds.size > 0) {
    checked += 1;
    const cited = plan.days.some((d) => (d.tasks ?? []).some((t) => (t.evidenceIds ?? []).length > 0));
    if (!cited) {
      violations.push({
        type: 'uncovered_evidence',
        detail: `本次注入了 ${input.validEvidenceIds.size} 条正文证据，但没有任何任务引用`,
        severity: 'warn',
      });
    }
  }

  return {
    ok: violations.every((v) => v.severity !== 'error'),
    checked,
    violations,
  };
}

// ---------------- 自动修正（只做安全类改动） ----------------

export type PlanChangeKind = 'minutes' | 'strategy' | 'items';

export interface PlanChange {
  kind: PlanChangeKind;
  day?: string;
  title?: string;
  detail: string;
}

export interface PlanDiff {
  summary: string;
  changes: PlanChange[];
}

export interface RepairResult {
  plan: GeneratedPlan;
  diff: PlanDiff;
  /** 是否真的改动了什么 */
  changed: boolean;
}

/**
 * 确定性修正：**只处理"时长超限"这一类**——按比例削到目标以内，绝不新增内容、不删任务、
 * 不改标题与理由，所以不会改变计划的意图（这是"敢自动改"的前提）。
 * 每项仍有 10 分钟下限保护（复用计划编辑工具里的同一套算法）。
 */
export function repairPlanByRules(plan: GeneratedPlan, minutesPerDay: number): RepairResult {
  const changes: PlanChange[] = [];

  const days = plan.days.map((day) => {
    const tasks = day.tasks ?? [];
    const before = dayMinutes(day);
    if (tasks.length === 0 || minutesPerDay <= 0) return day;
    const tolerance = minutesPerDay * 1.3;
    if (before <= tolerance) return day;

    const minutes = fitMinutesToTarget(
      tasks.map((t) => t.estimatedMinutes),
      minutesPerDay,
    );
    const after = minutes.reduce((s, v) => s + v, 0);
    if (after >= before) return day;

    changes.push({
      kind: 'minutes',
      day: day.date,
      detail: `${day.date} 合计 ${before} → ${after} 分钟（目标 ${minutesPerDay}）`,
    });
    return {
      ...day,
      tasks: tasks.map((t, i) => ({ ...t, estimatedMinutes: minutes[i] ?? t.estimatedMinutes })),
    };
  });

  const nextPlan: GeneratedPlan = { ...plan, days };
  return {
    plan: nextPlan,
    changed: changes.length > 0,
    diff: {
      summary: changes.length > 0 ? `按规则压缩了 ${changes.length} 天的时长` : '无需修正',
      changes,
    },
  };
}

// ---------------- 计划差异（"Critic 只出 diff"） ----------------

/** 比较两个版本的计划，产出人类可读的变更列表（用于 UI 展示修正了什么） */
export function diffPlans(before: GeneratedPlan, after: GeneratedPlan): PlanDiff {
  const changes: PlanChange[] = [];
  const beforeByDate = new Map(before.days.map((d) => [d.date, d] as const));

  for (const day of after.days) {
    const prev = beforeByDate.get(day.date);
    const prevTasks = prev?.tasks ?? [];
    const nextTasks = day.tasks ?? [];

    if (prevTasks.length !== nextTasks.length) {
      changes.push({
        kind: 'items',
        day: day.date,
        detail: `${day.date} 任务数 ${prevTasks.length} → ${nextTasks.length}`,
      });
    }

    nextTasks.forEach((task, index) => {
      const old = prevTasks[index];
      if (!old) {
        changes.push({ kind: 'items', day: day.date, title: task.title, detail: `新增「${task.title}」` });
        return;
      }
      if (old.estimatedMinutes !== task.estimatedMinutes) {
        changes.push({
          kind: 'minutes',
          day: day.date,
          title: task.title,
          detail: `「${task.title}」${old.estimatedMinutes} → ${task.estimatedMinutes} 分钟`,
        });
      }
      if ((old.title ?? '') !== (task.title ?? '')) {
        changes.push({
          kind: 'items',
          day: day.date,
          title: task.title,
          detail: `标题「${old.title}」→「${task.title}」`,
        });
      }
    });
  }

  const beforeRisks = (before.strategy?.risks ?? []).join('｜');
  const afterRisks = (after.strategy?.risks ?? []).join('｜');
  if (beforeRisks !== afterRisks) {
    changes.push({ kind: 'strategy', detail: '风险提示有调整' });
  }

  return {
    summary: changes.length > 0 ? `${changes.length} 处变更` : '没有变化',
    changes,
  };
}

/** 一行摘要（UI 与 trace 都用它） */
export function summarizeCritique(report: CritiqueReport): string {
  if (report.violations.length === 0) return `校验通过（检查了 ${report.checked} 项约束）`;
  const errors = report.violations.filter((v) => v.severity === 'error').length;
  const warns = report.violations.length - errors;
  return `校验发现 ${errors} 个问题、${warns} 个提醒（检查了 ${report.checked} 项约束）`;
}
