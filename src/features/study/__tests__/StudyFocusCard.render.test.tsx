// src/features/study/__tests__/StudyFocusCard.render.test.tsx
// 学习工作区主区的**服务端渲染冒烟**（同 TaskCompactRow：不需要 jsdom，只断言渲染出的文案）。
// 守住三件用户可见的事：没有任务时给去路、有任务时给"该看什么"、资源状态可读。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudyFocusCard } from '../components/StudyFocusCard';
import { PomodoroCard } from '../components/PomodoroCard';
import type { StudyResourceView } from '../types';
import type { Task } from '../../../types';

const noop = () => undefined;

function task(over: Partial<Task> = {}): Task {
  return {
    id: 7,
    title: '读列表推导式',
    status: 'pending',
    priority: 1,
    estimated_time: 30,
    due_date: '2026-09-29',
    description: ['目标：学习 Python 基础', '进度：第 1/6 天', '安排理由：先建立节奏'].join('\n'),
    created_at: '2026-09-28T00:00:00.000Z',
    tags: ['学习 Python 基础', '学习', '计划生成'],
    ...over,
  };
}

function resourceView(over: Partial<StudyResourceView> = {}): StudyResourceView {
  return {
    resource: {
      id: 'r1',
      source: 'manual',
      layer: 3,
      type: 'article',
      title: 'Python 列表推导式',
      url: 'https://example.com/py',
      durationMinutes: 15,
    },
    snippets: ['列表推导式把循环压成一行。'],
    ...over,
  };
}

describe('StudyFocusCard 渲染', () => {
  it('没有待做任务时给出去路（生成计划 / 配置白名单）', () => {
    const html = renderToStaticMarkup(
      <StudyFocusCard
        resources={[]}
        activeResourceId={null}
        studying={false}
        onStart={noop}
        onFinish={noop}
        onSelectResource={noop}
        onMarkResourceDone={noop}
      />,
    );
    expect(html).toContain('今天没有待做的学习任务');
    expect(html).toContain('#/tasks');
    expect(html).toContain('#/settings');
  });

  it('有任务时展示任务详情、队列位置与推荐内容（含计划期正文摘要）', () => {
    const html = renderToStaticMarkup(
      <StudyFocusCard
        goal="学习 Python 基础"
        queue={{ label: '学习 Python 基础', position: 2, total: 6, remaining: 4 }}
        task={task()}
        resources={[resourceView()]}
        activeResourceId="r1"
        studying={false}
        onStart={noop}
        onFinish={noop}
        onSelectResource={noop}
        onMarkResourceDone={noop}
        progressOf={() => undefined}
      />,
    );
    expect(html).toContain('读列表推导式');
    expect(html).toContain('第 2/6 条');
    expect(html).toContain('后面还有 4 条');
    expect(html).toContain('安排理由：先建立节奏');
    expect(html).toContain('Python 列表推导式');
    expect(html).toContain('未读');
    expect(html).toContain('有计划期正文摘要');
    expect(html).toContain('开始学习');
  });

  it('学习进行中时按钮变成"结束学习"；资源状态读得到进度', () => {
    const html = renderToStaticMarkup(
      <StudyFocusCard
        task={task()}
        resources={[resourceView()]}
        activeResourceId="r1"
        studying
        onStart={noop}
        onFinish={noop}
        onSelectResource={noop}
        onMarkResourceDone={noop}
        progressOf={() => ({
          resourceId: 'r1',
          url: 'https://example.com/py',
          state: 'reading',
          minutesSpent: 18,
          readCount: 0,
        })}
      />,
    );
    expect(html).toContain('结束学习');
    expect(html).toContain('在读');
    expect(html).toContain('已投入 18 分钟');
  });

  it('没有引用资源的手工任务也能用（提示可以自己记笔记）', () => {
    const html = renderToStaticMarkup(
      <StudyFocusCard
        task={task({ description: undefined, tags: ['个人'] })}
        resources={[]}
        activeResourceId={null}
        studying={false}
        onStart={noop}
        onFinish={noop}
        onSelectResource={noop}
        onMarkResourceDone={noop}
      />,
    );
    expect(html).toContain('这条任务没有引用资源');
  });
});

describe('PomodoroCard 渲染', () => {
  it('展示时钟、阶段与三个读数', () => {
    const html = renderToStaticMarkup(
      <PomodoroCard
        clock="24:35"
        phase="focus"
        running
        focusRounds={2}
        focusedMinutes={45}
        todayMinutes={70}
        focusMinutes={25}
        breakMinutes={5}
        onChangeDurations={noop}
        onToggle={noop}
        onSkip={noop}
        onReset={noop}
      />,
    );
    expect(html).toContain('24:35');
    expect(html).toContain('专注');
    expect(html).toContain('暂停');
    expect(html).toContain('45 分');
    expect(html).toContain('70 分');
  });
});
