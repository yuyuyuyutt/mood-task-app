// src/features/plan-generator/services/clarificationService.ts
// 阶段 1：澄清问题。
// 优先让本地 LLM 生成 3–5 个强相关澄清问题（覆盖：量化目标 / 现有基础 / 资源约束 / 偏好风格 / 成功标准）；
// LLM 未开启、调用失败或 JSON 解析失败 → 回退到预定义通用问题模板（source='template'）。
import { asString, asStringArray, extractJsonObject } from './jsonExtract';
import { callOllamaText, type LLMConfig } from './llmClient';
import { buildClarifyPrompt } from './prompts';
import { llmTasks } from './llmTaskManager';
import type { ClarifyQuestionKind, ClarifyResult, ClarifyingQuestion } from '../types';

const KINDS: ClarifyQuestionKind[] = ['number', 'text', 'single', 'multi'];
const DIMENSIONS: ClarifyingQuestion['dimension'][] = [
  '量化目标',
  '现有基础',
  '资源约束',
  '偏好风格',
  '成功标准',
  '其他',
];

/** 通用问题模板（LLM 不可用时的兜底；覆盖五个维度） */
export function genericClarifyQuestions(goal: string): ClarifyingQuestion[] {
  const g = goal.trim() || '这个目标';
  return [
    {
      id: 'q_quantify',
      question: `「${g}」做到什么程度算达成？请给出可衡量的结果（例如：能独立写完 3 个小程序 / 跑完 5 公里）。`,
      why: '把模糊目标变成可验证的终点，计划才能安排到"够用"为止。',
      kind: 'text',
      placeholder: '例如：能独立完成一个包含增删改查的小项目',
      dimension: '量化目标',
    },
    {
      id: 'q_baseline',
      question: '你目前的基础大致在哪个阶段？',
      why: '决定起点难度：完全零基础需要先补概念，有基础可直接进练习。',
      kind: 'single',
      options: ['完全零基础', '了解一些概念，没系统练过', '能独立做简单任务', '已经比较熟练，想系统提升'],
      dimension: '现有基础',
    },
    {
      id: 'q_time',
      question: '每天大概能稳定投入多长时间？',
      why: '每日投入决定任务粒度与总量，避免计划过满导致连续失败。',
      kind: 'single',
      options: ['20–30 分钟', '约 1 小时', '1–2 小时', '2 小时以上'],
      dimension: '资源约束',
    },
    {
      id: 'q_style',
      question: '你更喜欢哪种学习/推进方式？（可多选）',
      why: '偏好决定任务形态：视频、读书、动手实践需要不同的资源与安排。',
      kind: 'multi',
      options: ['看视频讲解', '读书/文档', '动手做练习', '找人讨论/请教', '跟着项目做'],
      dimension: '偏好风格',
    },
    {
      id: 'q_success',
      question: '结束时你希望拿到什么可展示的成果？',
      why: '成果物是最可靠的验收标准，也便于回看进度。',
      kind: 'text',
      placeholder: '例如：一份笔记 + 一个可运行的小作品',
      dimension: '成功标准',
    },
  ];
}

/** 解析并校验 LLM 输出；任何不合法内容被丢弃，问题数不足 3 个则抛错以触发降级 */
export function parseClarifyJson(text: string): ClarifyingQuestion[] {
  const obj = extractJsonObject<{ questions?: unknown }>(text);
  const raw = Array.isArray(obj.questions) ? obj.questions : [];
  const questions: ClarifyingQuestion[] = [];

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const q = item as Record<string, unknown>;
    const question = asString(q.question, 200);
    if (question.length < 4) return;
    const kindRaw = asString(q.kind, 20) as ClarifyQuestionKind;
    const kind: ClarifyQuestionKind = KINDS.includes(kindRaw) ? kindRaw : 'text';
    const options = asStringArray(q.options, 6, 80);
    const dimRaw = asString(q.dimension, 20) as ClarifyingQuestion['dimension'];
    questions.push({
      id: asString(q.id, 40) || `q${index + 1}`,
      question,
      why: asString(q.why, 160) || '帮助把计划做得更贴合你的实际情况。',
      kind: (kind === 'single' || kind === 'multi') && options.length === 0 ? 'text' : kind,
      options: options.length > 0 ? options : undefined,
      dimension: DIMENSIONS.includes(dimRaw) ? dimRaw : '其他',
    });
  });

  if (questions.length < 3) throw new Error(`澄清问题数量不足（${questions.length} < 3）`);
  return questions.slice(0, 5);
}

export interface ClarifyParams {
  goal: string;
  days: number;
  userType: string;
  config: LLMConfig;
  signal?: AbortSignal;
}

/**
 * 生成澄清问题。
 * 降级路径：LLM 未开启 → template；调用/解析失败 → template（附 fallbackReason）。
 */
export async function generateClarifyingQuestions(params: ClarifyParams): Promise<ClarifyResult> {
  const { goal, days, userType, config, signal } = params;

  if (!config.enabled || !config.model) {
    return {
      questions: genericClarifyQuestions(goal),
      source: 'template',
      fallbackReason: config.enabled ? '未选择模型' : 'AI 增强未开启',
    };
  }

  try {
    const text = await llmTasks.run({
      kind: 'clarify',
      key: 'clarify',
      timeoutMs: config.timeoutMs ?? 90_000,
      signal,
      run: (taskSignal) =>
        callOllamaText(buildClarifyPrompt(goal, days, userType), config, { signal: taskSignal }),
    });
    return { questions: parseClarifyJson(text), source: 'llm' };
  } catch (err) {
    return {
      questions: genericClarifyQuestions(goal),
      source: 'template',
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}
