// src/features/plan-generator/__tests__/localLLM.test.ts
// Ollama 输出解析 / 合并 的纯函数测试（不发起网络请求）。
import { describe, expect, it } from 'vitest';
import {
  buildPlanPrompt,
  isLocalEndpoint,
  mergeLLMPlan,
  parseLLMJson,
} from '../services/localLLM';
import { generatePlan } from '../services/planGenerator';
import type { GeneratedPlan } from '../types';

const NOW = new Date('2025-04-01T10:00:00');

function rulePlan(planType: 'tasks' | 'events' = 'tasks'): GeneratedPlan {
  return generatePlan(
    { goal: '学习 Python', days: 3, planType, userType: 'balanced' },
    { now: NOW, id: 'p1' },
  );
}

describe('parseLLMJson', () => {
  it('解析带代码块围栏的输出', () => {
    const raw = parseLLMJson('```json\n{"narrative":"保持节奏","days":[{"date":"2025-04-02","tasks":[{"title":"看文档","minutes":40,"time":"09:00"}]}]}\n```');
    expect(raw.narrative).toBe('保持节奏');
    expect(raw.days[0].tasks[0]).toMatchObject({ title: '看文档', minutes: 40, time: '09:00' });
  });

  it('容忍前后杂字并丢弃非法时间格式', () => {
    const raw = parseLLMJson('好的，这是计划：{"days":[{"date":"2025-04-02","tasks":[{"title":"A","minutes":30,"time":"25:99"}]}]} 完毕');
    expect(raw.days[0].tasks[0].time).toBeUndefined();
  });

  it('跳过无标题条目；无可用日程时抛错', () => {
    expect(() => parseLLMJson('{"days":[{"date":"2025-04-02","tasks":[{"minutes":10}]}]}')).toThrow();
    expect(() => parseLLMJson('不是 JSON')).toThrow();
  });
});

describe('mergeLLMPlan', () => {
  it('按日期把模型任务合并进计划，并保留建议时段', () => {
    const base = rulePlan('tasks');
    const raw = parseLLMJson(
      JSON.stringify({
        narrative: '先打基础再练手',
        days: [
          { date: base.days[0].date, tasks: [{ title: '安装环境', minutes: 30, time: '09:00' }, { title: '语法练习', minutes: 60, time: '10:00' }] },
        ],
      }),
    );
    const { plan, usedDays } = mergeLLMPlan(base, raw, { start: '08:00', end: '22:00' });
    expect(usedDays).toBe(1);
    expect(plan.aiNarrative).toBe('先打基础再练手');
    expect(plan.days[0].tasks!.map((t) => t.title)).toEqual(['安装环境', '语法练习']);
    expect(plan.days[0].tasks![0].bestTime).toBe('09:00-09:30');
    // 未覆盖的天保留规则计划
    expect(plan.days[1].tasks!.length).toBeGreaterThan(0);
    expect(plan.days.length).toBe(base.days.length);
  });

  it('丢弃模型编造的日期并记录安全调整', () => {
    const base = rulePlan('tasks');
    const raw = parseLLMJson(
      JSON.stringify({
        days: [
          { date: '2099-01-01', tasks: [{ title: '外星任务', minutes: 30 }] },
          { date: base.days[2].date, tasks: [{ title: '合法任务', minutes: 30 }] },
        ],
      }),
    );
    const { plan, adjustments, usedDays } = mergeLLMPlan(base, raw);
    expect(usedDays).toBe(1);
    expect(adjustments.join()).toContain('计划外日期');
    const allTitles = plan.days.flatMap((d) => (d.tasks ?? []).map((t) => t.title));
    expect(allTitles).not.toContain('外星任务');
    expect(allTitles).toContain('合法任务');
  });

  it('夹紧越界时长到 10–180 分钟', () => {
    const base = rulePlan('tasks');
    const raw = parseLLMJson(
      JSON.stringify({
        days: [{ date: base.days[0].date, tasks: [{ title: '过短', minutes: 2 }, { title: '过长', minutes: 999 }] }],
      }),
    );
    const { plan, adjustments } = mergeLLMPlan(base, raw);
    expect(plan.days[0].tasks![0].estimatedMinutes).toBe(10);
    expect(plan.days[0].tasks![1].estimatedMinutes).toBe(180);
    expect(adjustments.join()).toContain('夹紧');
  });

  it('事件形态：按 time 排布，缺失时从可用时段起点顺序铺开', () => {
    const base = rulePlan('events');
    const raw = parseLLMJson(
      JSON.stringify({
        days: [
          {
            date: base.days[0].date,
            tasks: [{ title: '晨读', minutes: 60, time: '09:00' }, { title: '练习', minutes: 45 }],
          },
        ],
      }),
    );
    const { plan } = mergeLLMPlan(base, raw, { start: '08:00', end: '12:00' });
    const evs = plan.days[0].events!;
    expect(evs[0]).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    expect(evs[1].startTime).toBe('10:10'); // 09:00+60 -> +10 分钟间隔
    expect(evs[1].endTime).toBe('10:55');
  });

  it('舍去超出可用时段的事件', () => {
    const base = rulePlan('events');
    const raw = parseLLMJson(
      JSON.stringify({
        days: [{ date: base.days[0].date, tasks: [{ title: '很晚', minutes: 120, time: '23:00' }] }],
      }),
    );
    const { plan } = mergeLLMPlan(base, raw, { start: '08:00', end: '10:00' });
    for (const ev of plan.days[0].events ?? []) {
      expect(Number(ev.endTime.slice(0, 2))).toBeLessThanOrEqual(10);
    }
  });
});

describe('buildPlanPrompt 隐私范围', () => {
  it('只包含计划相关字段（目标/日期/画像），不含其它本地数据', () => {
    const base = rulePlan('tasks');
    const prompt = buildPlanPrompt(
      { goal: '学习 Python', days: 3, planType: 'tasks', userType: 'night_owl' },
      base,
    );
    expect(prompt).toContain('学习 Python');
    expect(prompt).toContain('夜猫子');
    expect(prompt).toContain(base.days[0].date);
    expect(prompt).toContain('只输出 JSON');
    // 不应出现与计划无关的本地数据字段
    expect(prompt).not.toContain('心情');
    expect(prompt).not.toContain('avatar');
  });

  it('把用户可用时段写入提示词', () => {
    const base = rulePlan('tasks');
    const prompt = buildPlanPrompt(
      {
        goal: '晨跑',
        days: 2,
        planType: 'tasks',
        userType: 'morning_person',
        preferences: { availability: { start: '06:30', end: '08:30' } },
      },
      base,
    );
    expect(prompt).toContain('06:30–08:30');
  });
});

describe('isLocalEndpoint', () => {
  it('识别本机与远端端点', () => {
    expect(isLocalEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalEndpoint('http://localhost:11434')).toBe(true);
    expect(isLocalEndpoint('https://api.example.com/v1')).toBe(false);
    expect(isLocalEndpoint('not-a-url')).toBe(false);
  });
});
