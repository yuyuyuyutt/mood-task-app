// src/features/study/planLink.ts
// 把"任务表里的一条任务"还原成"计划里的资源与证据"（纯函数）。
//
// 为什么需要它：任务表只存 description 文本，不存 resourceIds（见 planToTaskPayloads）。
// 所以工作区要展示"这条任务该看哪个资源"有两条路：
//   1) 精确路径：用描述里的 `进度：第 X/Y 天` + 标题，回计划里找同一天的同一项 → 拿 resourceIds；
//   2) 兜底路径:解析描述里的 `引用资源：` 行（标题 + 链接），必要时再按 URL 回填计划资源。
// 精确路径拿到的 `ResourceItem` 带有 id，才能找到 `plan.evidence` 里的正文摘要 —— 那是
// "生成时真正读过这段内容"的唯一永久凭证（正文全文只在 7 天缓存里）。
import type { Task } from '../../types';
import { hashText } from '../plan-generator/services/rag/embedding';
import type {
  EvidenceRef,
  GeneratedPlan,
  ResourceItem,
  ResourceType,
} from '../plan-generator/types';
import { AI_TAG_PREFIX, PLAN_TAG } from '../plan-generator/services/planToTaskPayloads';
import { STUDY_TAG, REVIEW_TAG } from './review';

export interface CitedResourceRef {
  type: string;
  title: string;
  url: string;
}

const RESOURCE_TYPES: ResourceType[] = ['video', 'article', 'book', 'post', 'link'];

function asResourceType(value: string): ResourceType {
  return (RESOURCE_TYPES as string[]).includes(value) ? (value as ResourceType) : 'link';
}

/** 解析描述里的 `· [video] 标题 — https://…` 行（planToTaskPayloads 写入的格式） */
export function parseCitedResources(description?: string): CitedResourceRef[] {
  if (!description) return [];
  const out: CitedResourceRef[] = [];
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('·')) continue;
    const match = line.match(/^·\s*\[([a-z]+)\]\s*(.+?)\s*—\s*(\S+)$/);
    if (!match) continue;
    out.push({ type: match[1], title: match[2].trim(), url: match[3].trim() });
  }
  return out.slice(0, 6);
}

/** 解析描述里的 `进度：第 2/6 天` */
export function parsePlanProgress(description?: string): { day: number; totalDays: number } | null {
  if (!description) return null;
  const match = description.match(/进度：第\s*(\d+)\/(\d+)\s*天/);
  if (!match) return null;
  const day = Number(match[1]);
  const totalDays = Number(match[2]);
  if (!Number.isFinite(day) || day <= 0) return null;
  return { day, totalDays: Number.isFinite(totalDays) && totalDays > 0 ? totalDays : day };
}

/** 任务所属计划的"目标标签"（写入任务时用的 goal.slice(0,12)） */
export function goalTagOf(task: Task): string | null {
  const meta = new Set<string>([PLAN_TAG, STUDY_TAG, REVIEW_TAG]);
  const tag = (task.tags ?? []).find((t) => !meta.has(t) && !t.startsWith(AI_TAG_PREFIX));
  return tag ?? null;
}

/** 该任务是否来自计划生成（只有这类任务才有"计划资源"） */
export function isPlanTask(task: Task): boolean {
  return (task.tags ?? []).includes(PLAN_TAG);
}

export interface TaskPlanLink {
  plan?: GeneratedPlan;
  dayIndex?: number;
  resources: ResourceItem[];
  evidence: EvidenceRef[];
}

function syntheticResource(ref: CitedResourceRef): ResourceItem {
  return {
    id: `cited:${hashText(ref.url)}`,
    source: 'manual',
    layer: 3,
    type: asResourceType(ref.type),
    title: ref.title,
    url: ref.url,
    difficulty: 'unknown',
  };
}

/**
 * 把任务关联到计划资源。
 * 找不到计划也不算失败：退回"描述里的引用资源"，工作区照样能用（只是少了正文摘要）。
 */
export function linkTaskToPlan(task: Task, plans: GeneratedPlan[]): TaskPlanLink {
  const goalTag = goalTagOf(task);
  const plan = goalTag
    ? [...plans]
        .filter((p) => p.goal.trim().slice(0, 12) === goalTag)
        .sort((a, b) => {
          // 已接受的计划优先，其次取最新
          if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
          return a.createdAt < b.createdAt ? 1 : -1;
        })[0]
    : undefined;

  const cited = parseCitedResources(task.description);
  const progress = parsePlanProgress(task.description);
  const dayIndex = progress ? progress.day - 1 : undefined;

  // 精确路径：同一天的同一项 -> resourceIds
  const exactIds =
    plan && dayIndex != null && dayIndex >= 0
      ? (plan.days[dayIndex]?.tasks?.find((t) => t.title === task.title)?.resourceIds ?? [])
      : [];

  const planResources = plan?.resources ?? [];
  const resources: ResourceItem[] = [];
  const seen = new Set<string>();

  for (const id of exactIds) {
    const item = planResources.find((r) => r.id === id);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      resources.push(item);
    }
  }

  // 兜底路径：按 URL 对上计划资源；对不上就构造一个"仅用于展示与阅读"的轻量资源
  for (const ref of cited) {
    const matched = planResources.find((r) => r.url === ref.url);
    const item = matched ?? syntheticResource(ref);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    resources.push(item);
  }

  const ids = new Set(resources.map((r) => r.id));
  const evidence = (plan?.evidence ?? [])
    .filter((e) => ids.has(e.resourceId))
    .slice(0, 12);

  return { plan, dayIndex: dayIndex != null && dayIndex >= 0 ? dayIndex : undefined, resources, evidence };
}
