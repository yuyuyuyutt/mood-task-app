// src/features/plan-generator/__tests__/adjustPlan.test.ts
// 对话式计划调整：单步 Agent run 的端到端行为（决策 → 闸门 → 确认 → 应用）。
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADJUST_SESSION_SCOPES,
  adjustPlan,
  commitAdjust,
  discardAdjust,
  parseRuleInstruction,
  parseToolCallJson,
} from '../services/agent/adjustPlan';
import { traceStore } from '../services/agent/trace';
import { PROMPT_VERSION } from '../services/prompts';
import { DEFAULT_LLM_CONFIG } from '../services/llmClient';
import type { GeneratedPlan } from '../types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const enabledConfig = { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b' };
const disabledConfig = { ...DEFAULT_LLM_CONFIG, enabled: false };

function stubChat(content: string, ok = true, status = 200): void {
  globalThis.fetch = (async () => {
    if (!ok) return new Response('boom', { status });
    return new Response(JSON.stringify({ message: { role: 'assistant', content } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function fixturePlan(): GeneratedPlan {
  return {
    id: 'p1',
    goal: '学习 Python 基础',
    planType: 'tasks',
    userType: 'balanced',
    category: '学习',
    createdAt: '2026-09-28T00:00:00.000Z',
    engineVersion: 1,
    accepted: false,
    days: [
      {
        date: '2026-09-28',
        tasks: [
          { title: '装好环境', category: '学习', estimatedMinutes: 30 },
          { title: '练语法', category: '学习', estimatedMinutes: 45 },
        ],
      },
      { date: '2026-09-29', tasks: [{ title: '写脚本', category: '学习', estimatedMinutes: 60 }] },
      { date: '2026-09-30', tasks: [{ title: '复盘', category: '学习', estimatedMinutes: 20 }] },
    ],
    strategy: { methodology: ['间隔重复'], risks: ['贪多求快', '缺少反馈'], successCriteria: ['连续 7 天'] },
  };
}

describe('parseRuleInstruction（不依赖模型的确定性兜底）', () => {
  it('识别顺延 / 压缩 / 删除三类高频指令', () => {
    expect(parseRuleInstruction('周三出差，整周计划顺延 2 天')).toMatchObject({
      tool: 'shift_plan_days',
      args: { days: 2 },
    });
    expect(parseRuleInstruction('每天只能 40 分钟')).toMatchObject({
      tool: 'compress_daily_minutes',
      args: { minutes: 40 },
    });
    expect(parseRuleInstruction('把第 3 天的第 1 项删掉')).toMatchObject({
      tool: 'remove_task',
      args: { day: 3, item: 1 },
    });
  });

  it('无法确定意图时不猜：返回 null', () => {
    expect(parseRuleInstruction('帮我把它弄好一点')).toBeNull();
    expect(parseRuleInstruction('')).toBeNull();
  });
});

describe('parseToolCallJson', () => {
  it('解析工具的 JSON 决策', () => {
    const intent = parseToolCallJson('{"tool":"shift_plan_days","args":{"days":2},"reply":"顺延两天"}');
    expect(intent).toMatchObject({ tool: 'shift_plan_days', args: { days: 2 }, reply: '顺延两天' });
  });

  it('缺少工具名直接抛错（走降级而不是瞎执行）', () => {
    expect(() => parseToolCallJson('{"args":{}}')).toThrow('缺少工具名');
  });

  it('args 缺失时退化为空对象，交由参数校验裁决', () => {
    const intent = parseToolCallJson('{"tool":"compress_daily_minutes","reply":"压缩"}');
    expect(intent.args).toEqual({});
  });
});

describe('adjustPlan —— 无模型（本地指令解析路径）', () => {
  it('顺延指令 → 干跑产出 diff，确认后才修改计划', async () => {
    const plan = fixturePlan();
    const result = await adjustPlan({ instruction: '整周顺延 2 天', plan, config: disabledConfig });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.source).toBe('rule');
    expect(result.diff.changes).toHaveLength(3);

    // 干跑阶段计划必须原封不动
    expect(plan.days[0].date).toBe('2026-09-28');

    const committed = await commitAdjust(result.gate, result.token, plan);
    expect(committed.ok).toBe(true);
    expect(committed.plan?.days.map((d) => d.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(result.gate.scopes).toEqual(ADJUST_SESSION_SCOPES);
  });

  it('取消后即使拿到旧令牌也无法应用', async () => {
    const plan = fixturePlan();
    const result = await adjustPlan({ instruction: '每天只能 40 分钟', plan, config: disabledConfig });
    if (result.status !== 'ok') throw new Error('应产出变更预览');

    discardAdjust(result.gate, result.token);
    const committed = await commitAdjust(result.gate, result.token, plan);
    expect(committed.ok).toBe(false);
  });

  it('无法解析的指令 → failed，并给出可用指令提示', async () => {
    const result = await adjustPlan({ instruction: '帮我弄得更好一点', plan: fixturePlan(), config: disabledConfig });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reply).toContain('本地指令');
  });
});

describe('adjustPlan —— 有模型（prompt-based tool calling）', () => {
  it('模型选择合法工具 → ok，且 trace 记录读工具与写工具调用', async () => {
    traceStore.clear();
    stubChat('{"tool":"compress_daily_minutes","args":{"minutes":30},"reply":"把每天压到 30 分钟"}');

    const result = await adjustPlan({ instruction: '时间不够了', plan: fixturePlan(), config: enabledConfig });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.source).toBe('llm');
    expect(result.diff.skill).toBe('compress_daily_minutes');

    const trace = traceStore.latest('adjust');
    expect(trace?.level).toBe('agent');
    expect(trace?.promptVersion).toBe(PROMPT_VERSION);
    expect(trace?.toolCalls.some((c) => c.name === 'get_plan_summary' && c.ok)).toBe(true);
    expect(trace?.toolCalls.some((c) => c.name === 'compress_daily_minutes' && c.ok)).toBe(true);
    expect(trace?.steps.some((s) => s.name === 'chat:adjust' && s.ok)).toBe(true);
  });

  it('模型发明未注册的工具 → 白名单拒绝执行', async () => {
    stubChat('{"tool":"delete_all_plans","args":{},"reply":"清空"}');
    const result = await adjustPlan({ instruction: '清空所有计划', plan: fixturePlan(), config: enabledConfig });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toContain('未注册的工具');
      expect(result.source).toBe('llm');
    }
  });

  it('模型给出非法参数 → 参数校验拒绝', async () => {
    stubChat('{"tool":"shift_plan_days","args":{"days":999},"reply":"顺延"}');
    const result = await adjustPlan({ instruction: '往后推很多天', plan: fixturePlan(), config: enabledConfig });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toContain('参数校验未通过');
  });

  it('模型明确表示无法处理 → rejected（tool=none）', async () => {
    stubChat('{"tool":"none","args":{},"reply":"现有工具无法表达这个诉求"}');
    const result = await adjustPlan({ instruction: '把计划改成诗歌', plan: fixturePlan(), config: enabledConfig });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reply).toContain('无法表达');
  });

  it('模型请求失败 → 静默降级为本地指令解析，并写入 trace 降级原因', async () => {
    traceStore.clear();
    stubChat('', false, 500);

    const result = await adjustPlan({ instruction: '整周顺延 1 天', plan: fixturePlan(), config: enabledConfig });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.source).toBe('rule');
    expect(traceStore.latest('adjust')?.fallbacks.some((f) => f.stage === 'adjust')).toBe(true);
  });
});
