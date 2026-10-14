// src/features/plan-generator/services/llm/schemas.ts
// 结构化输出契约（JSON Schema）。
//
// 为什么需要它：本地小模型（qwen2.5:7b 级）最常见的失败不是"答得不好"，而是"字段漂移"——
// 少字段、改字段名、把数组写成字符串。此前靠 jsonExtract 事后容错 + 降级，属于"事后补救"；
// 把 schema 交给 Ollama 的 format 参数后，非法输出在**解码阶段**就被约束住，
// jsonExtract 降为最后一道防线。
//
// 约定：schema 保持保守（只用 object/array/string/integer/enum/required），
// 以便被 llama.cpp 的 grammar 转换器接受；过于花哨的关键字（oneOf/pattern）一律不用。

/** 阶段 1：澄清问题 */
export const CLARIFY_SCHEMA = {
  type: 'object',
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['question', 'why', 'kind', 'dimension'],
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          why: { type: 'string' },
          kind: { type: 'string', enum: ['number', 'text', 'single', 'multi'] },
          options: { type: 'array', items: { type: 'string' } },
          dimension: {
            type: 'string',
            enum: ['量化目标', '现有基础', '资源约束', '偏好风格', '成功标准', '其他'],
          },
        },
      },
    },
  },
} as const;

/** 阶段 2：检索关键词 */
export const KEYWORD_SCHEMA = {
  type: 'object',
  required: ['keywords'],
  properties: {
    keywords: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        required: ['keyword', 'priority', 'reason'],
        properties: {
          keyword: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 3 },
          reason: { type: 'string' },
          lang: { type: 'string', enum: ['zh', 'en'] },
        },
      },
    },
  },
} as const;

/** 阶段 3：逐日计划 + 整体策略 */
export const PLAN_SCHEMA = {
  type: 'object',
  required: ['strategy', 'narrative', 'days'],
  properties: {
    strategy: {
      type: 'object',
      required: ['methodology', 'risks', 'successCriteria'],
      properties: {
        methodology: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        successCriteria: { type: 'array', items: { type: 'string' } },
      },
    },
    narrative: { type: 'string' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        required: ['date', 'tasks'],
        properties: {
          date: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title', 'minutes'],
              properties: {
                title: { type: 'string' },
                minutes: { type: 'integer', minimum: 10, maximum: 180 },
                time: { type: 'string' },
                reason: { type: 'string' },
                methodology: { type: 'array', items: { type: 'string' } },
                resourceIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * 计划调整：单步工具调用。
 *
 * 这是"prompt-based tool calling"——不依赖模型原生 function calling（本地 7B 模型支持度不一），
 * 而是要求模型输出 {tool, args, reply}，再由宿主的**工具注册表白名单**裁决：
 * 未注册的工具名一律拒绝执行。契约 + 白名单两道关，比"让模型直接说人话然后正则解析"可靠得多。
 */
export const TOOL_CALL_SCHEMA = {
  type: 'object',
  required: ['tool', 'args', 'reply'],
  properties: {
    tool: { type: 'string' },
    args: { type: 'object' },
    reply: { type: 'string' },
  },
} as const;

/**
 * 极简 schema 自检：确保我们只用了保守关键字。
 * 用于单测，防止后续有人加了 oneOf/pattern 之类导致本地模型解码失败。
 */
export function collectSchemaKeywords(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    schema.forEach((s) => collectSchemaKeywords(s, out));
    return out;
  }
  if (!schema || typeof schema !== 'object') return out;
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'properties' && value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach((v) => collectSchemaKeywords(v, out));
      continue;
    }
    out.add(key);
    if (value && typeof value === 'object') collectSchemaKeywords(value, out);
  }
  return out;
}

/** llama.cpp grammar 转换器接受的保守关键字白名单 */
export const ALLOWED_SCHEMA_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'description',
]);
