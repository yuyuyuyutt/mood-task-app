// src/features/study/components/StudyFocusCard.tsx
// 工作区主区：**今天该做的那一条** + 它引用的资源。
//
// 为什么只给一条：计划本身是连续的，工作区如果把它摊平成清单，就退化成"第二个任务列表"了。
// 这里与任务栏的"计划逐条解锁"用的是同一套语义（services/planQueue.ts）。
import React from 'react';
import {
  FaPlay,
  FaStop,
  FaExternalLinkAlt,
  FaClock,
  FaCalendarAlt,
  FaCheckCircle,
  FaRegCircle,
  FaDotCircle,
  FaBookOpen,
} from 'react-icons/fa';
import type { Task } from '../../../types';
import { parseTaskDetails } from '../../../components/tasks/taskDetails';
import { openExternal } from '../../../utils/openExternal';
import type { ResourceProgress, ResourceState, StudyResourceView } from '../types';

const STATE_LABEL: Record<ResourceState, string> = {
  unread: '未读',
  reading: '在读',
  done: '已读',
};

const STATE_ICON: Record<ResourceState, React.ReactNode> = {
  unread: <FaRegCircle className="text-[9px]" />,
  reading: <FaDotCircle className="text-[9px]" />,
  done: <FaCheckCircle className="text-[9px]" />,
};

const TYPE_LABEL: Record<string, string> = {
  video: '视频',
  article: '文章',
  book: '书',
  post: '帖子',
  link: '链接',
};

export interface StudyQueuePosition {
  label: string;
  position: number;
  total: number;
  remaining: number;
}

export interface StudyFocusCardProps {
  goal?: string;
  queue?: StudyQueuePosition;
  task?: Task;
  resources: StudyResourceView[];
  activeResourceId: string | null;
  studying: boolean;
  onStart: () => void;
  onFinish: () => void;
  onSelectResource: (resourceId: string) => void;
  onMarkResourceDone: (resourceId: string) => void;
  progressOf?: (resourceId: string) => ResourceProgress | undefined;
  /** 收工面板（由页面渲染，避免把会话表单塞进这张卡） */
  wrapUp?: React.ReactNode;
}

export const StudyFocusCard: React.FC<StudyFocusCardProps> = ({
  goal,
  queue,
  task,
  resources,
  activeResourceId,
  studying,
  onStart,
  onFinish,
  onSelectResource,
  onMarkResourceDone,
  progressOf,
  wrapUp,
}) => {
  if (!task) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-2 text-ink-3">
          <FaBookOpen className="text-xs" />
          <h2 className="text-base font-semibold text-ink">今天没有待做的学习任务</h2>
        </div>
        <p className="mt-2 text-sm text-ink-3">
          先去「任务列表」生成一份计划；计划任务会按天逐条出现，工作区这里只聚焦当前这一条。
        </p>
        <div className="mt-3 flex gap-2">
          <a href="#/tasks" className="btn btn-primary btn-sm">
            去生成计划
          </a>
          <a href="#/settings" className="btn btn-ghost btn-sm">
            配置正文抓取白名单
          </a>
        </div>
      </div>
    );
  }

  const details = parseTaskDetails(task.description);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-ink">
            当前任务
          </span>
          {goal && <span className="truncate text-xs text-ink-3">{goal}</span>}
        </div>
        {queue && (
          <span className="tnum text-[11px] text-ink-3">
            第 {queue.position}/{queue.total} 条
            {queue.remaining > 0 && ` · 后面还有 ${queue.remaining} 条`}
          </span>
        )}
      </div>

      <h2 className={`mt-2 text-lg leading-7 ${task.status === 'completed' ? 'text-ink-3 line-through' : 'font-semibold text-ink'}`}>
        {task.title}
      </h2>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
        {task.estimated_time != null && (
          <span className="tnum inline-flex items-center gap-1">
            <FaClock className="text-[9px]" />
            {task.estimated_time >= 60
              ? `${(task.estimated_time / 60).toFixed(1).replace(/\.0$/, '')} 小时`
              : `${task.estimated_time} 分钟`}
          </span>
        )}
        {task.due_date && (
          <span className="tnum inline-flex items-center gap-1">
            <FaCalendarAlt className="text-[9px]" />
            {task.due_date.slice(5)}
          </span>
        )}
      </div>

      {details.body && (
        <div className="mt-3 rounded-lg bg-surface-2 p-3 text-[12px] leading-5 whitespace-pre-wrap text-ink-2">
          {details.body}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {studying ? (
          <button type="button" onClick={onFinish} className="btn btn-primary btn-sm">
            <FaStop className="text-[10px]" />
            结束学习
          </button>
        ) : (
          <button type="button" onClick={onStart} className="btn btn-primary btn-sm">
            <FaPlay className="text-[10px]" />
            开始学习
          </button>
        )}
        <span className="text-[11px] text-ink-3">
          开始后侧栏番茄钟会计时；结束时记下总结并写进记忆（用于校准下次的时长预估）。
        </span>
      </div>

      {/* 资源区 */}
      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">这条任务推荐的内容</h3>
          <span className="text-[11px] text-ink-3">{resources.length} 条</span>
        </div>

        {resources.length === 0 ? (
          <p className="text-xs text-ink-3">
            这条任务没有引用资源（可能是手工任务）。可以在下方笔记里自己记录看过的材料。
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {resources.map((view) => {
              const progress = progressOf?.(view.resource.id);
              const state = progress?.state ?? 'unread';
              const active = view.resource.id === activeResourceId;
              return (
                <li
                  key={view.resource.id}
                  className={`flex items-start gap-3 px-3 py-2.5 transition-colors ${
                    active ? 'bg-brand-soft/40' : 'hover:bg-surface-2'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectResource(view.resource.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {view.resource.title}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-ink-3">
                      <span className="inline-flex items-center gap-1">
                        {STATE_ICON[state]}
                        {STATE_LABEL[state]}
                      </span>
                      <span>{TYPE_LABEL[view.resource.type] ?? view.resource.type}</span>
                      {view.resource.durationMinutes && <span className="tnum">{view.resource.durationMinutes} 分钟</span>}
                      {progress?.minutesSpent ? (
                        <span className="tnum">已投入 {progress.minutesSpent} 分钟</span>
                      ) : null}
                      {view.snippets.length > 0 && (
                        <span className="text-ok">有计划期正文摘要</span>
                      )}
                    </span>
                    {view.snippets[0] && (
                      <span className="mt-1 block truncate text-[11px] text-ink-3">
                        {view.snippets[0]}
                      </span>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      title="在浏览器打开"
                      onClick={() => void openExternal(view.resource.url)}
                      className="icon-btn"
                    >
                      <FaExternalLinkAlt className="text-[10px]" />
                    </button>
                    <button
                      type="button"
                      title={state === 'done' ? '已标记读完' : '标记为已读'}
                      onClick={() => onMarkResourceDone(view.resource.id)}
                      disabled={state === 'done'}
                      className="icon-btn disabled:opacity-40"
                    >
                      <FaCheckCircle className="text-[11px]" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {wrapUp}
    </div>
  );
};
