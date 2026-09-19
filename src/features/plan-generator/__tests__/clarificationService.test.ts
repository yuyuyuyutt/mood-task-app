// src/features/plan-generator/__tests__/clarificationService.test.ts
// 阶段 1 测试：JSON 解析容错 + 降级到通用模板。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateClarifyingQuestions,
  genericClarifyQuestions,
  parseClarifyJson,
} from '../services/clarificationService';
import { DEFAULT_LLM_CONFIG } from '../services/llmClient';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubOllama(responseText: string, ok = true, status = 200): void {
  globalThis.fetch = vi.fn(async () =>
    ok
      ? new Response(JSON.stringify({ response: responseText }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response('boom', { status }),
  ) as unknown as typeof fetch;
}

describe('genericClarifyQuestions（模板兜底）', () => {
  it('覆盖五个维度且不少于 3 个问题', () => {
    const questions = genericClarifyQuestions('学习 Python');
    expect(questions.length).toBeGreaterThanOrEqual(3);
    const dims = new Set(questions.map((q) => q.dimension));
    expect(dims.has('量化目标')).toBe(true);
    expect(dims.has('现有基础')).toBe(true);
    expect(dims.has('资源约束')).toBe(true);
    expect(dims.has('偏好风格')).toBe(true);
    expect(dims.has('成功标准')).toBe(true);
    // 每题都有"为什么问这个"
    expect(questions.every((q) => q.why.length > 5)).toBe(true);
    // 目标被带入问题
    expect(questions[0].question).toContain('学习 Python');
  });
});

describe('parseClarifyJson（容错解析）', () => {
  it('解析代码块包裹的 JSON，并保留 why/options', () => {
    const text =
      '```json\n{"questions":[{"id":"q1","question":"每天能投入多久？","why":"决定任务粒度","kind":"single","options":["30 分钟","1 小时"],"dimension":"资源约束"},{"id":"q2","question":"现在会什么？","why":"决定起点","kind":"text"},{"id":"q3","question":"怎样算完成？","why":"验收标准","kind":"text"}]}\n```';
    const qs = parseClarifyJson(text);
    expect(qs).toHaveLength(3);
    expect(qs[0].options).toEqual(['30 分钟', '1 小时']);
    expect(qs[0].dimension).toBe('资源约束');
    expect(qs[2].why).toBe('验收标准');
  });

  it('修正非法 kind（single 无选项 → text）与未知 dimension', () => {
    const text = JSON.stringify({
      questions: [
        { question: '问题一啊啊', why: 'w', kind: 'single', dimension: '不存在的维度' },
        { question: '问题二啊啊', why: 'w', kind: 'weird' },
        { question: '问题三啊啊', why: 'w', kind: 'number' },
      ],
    });
    const qs = parseClarifyJson(text);
    expect(qs[0].kind).toBe('text');
    expect(qs[0].dimension).toBe('其他');
    expect(qs[1].kind).toBe('text');
    expect(qs[2].kind).toBe('number');
  });

  it('丢弃空问题；不足 3 个时抛错（触发降级）', () => {
    expect(() => parseClarifyJson('{"questions":[{"question":"太短"}]}')).toThrow();
    expect(() => parseClarifyJson('完全是文本，没有 JSON')).toThrow();
  });

  it('容忍尾随逗号', () => {
    const text = '{"questions":[{"question":"问题一啊啊","why":"w"},{"question":"问题二啊啊","why":"w"},{"question":"问题三啊啊","why":"w"},]}';
    expect(parseClarifyJson(text)).toHaveLength(3);
  });
});

describe('generateClarifyingQuestions（降级路径）', () => {
  it('AI 未开启 → 直接使用模板（source=template）', async () => {
    const res = await generateClarifyingQuestions({
      goal: '学习 Python',
      days: 7,
      userType: 'balanced',
      config: DEFAULT_LLM_CONFIG, // enabled: false
    });
    expect(res.source).toBe('template');
    expect(res.fallbackReason).toContain('未开启');
    expect(res.questions.length).toBeGreaterThanOrEqual(3);
  });

  it('开启但未选模型 → 模板兜底并说明原因', async () => {
    const res = await generateClarifyingQuestions({
      goal: '学习 Python',
      days: 7,
      userType: 'balanced',
      config: { ...DEFAULT_LLM_CONFIG, enabled: true, model: '' },
    });
    expect(res.source).toBe('template');
    expect(res.fallbackReason).toContain('未选择模型');
  });

  it('AI 返回合法 JSON → source=llm', async () => {
    stubOllama(
      JSON.stringify({
        questions: [
          { id: 'a', question: '你每天能投入多少时间？', why: '决定粒度', kind: 'single', options: ['30m', '1h'], dimension: '资源约束' },
          { id: 'b', question: '目前基础如何？', why: '决定起点', kind: 'text', dimension: '现有基础' },
          { id: 'c', question: '怎样算成功？', why: '验收', kind: 'text', dimension: '成功标准' },
        ],
      }),
    );
    const res = await generateClarifyingQuestions({
      goal: '学习 Python',
      days: 5,
      userType: 'night_owl',
      config: { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b' },
    });
    expect(res.source).toBe('llm');
    expect(res.questions[0].options).toEqual(['30m', '1h']);
  });

  it('AI 返回不可解析内容 → 降级模板并带原因', async () => {
    stubOllama('抱歉，我无法回答。');
    const res = await generateClarifyingQuestions({
      goal: '学习 Python',
      days: 5,
      userType: 'balanced',
      config: { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b' },
    });
    expect(res.source).toBe('template');
    expect(res.fallbackReason).toBeTruthy();
    expect(res.questions.length).toBeGreaterThanOrEqual(3);
  });

  it('AI 请求失败（HTTP 500）→ 降级模板', async () => {
    stubOllama('', false, 500);
    const res = await generateClarifyingQuestions({
      goal: '学习 Python',
      days: 5,
      userType: 'balanced',
      config: { ...DEFAULT_LLM_CONFIG, enabled: true, model: 'qwen2.5:7b' },
    });
    expect(res.source).toBe('template');
    expect(res.fallbackReason).toMatch(/500|失败|错误/);
  });
});
