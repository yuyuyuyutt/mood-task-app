// src/features/plan-generator/components/wizard/PlanStep.tsx
// 阶段 3：计划预览。
// - 顶部：整体策略卡片（方法论 / 风险提示（警示样式） / 可验证成功标准）
// - 每个任务：标题、耗时可编辑、建议时间、安排理由（小字灰色）、方法论标签、可点击的资源链接
// - 底部：接受（可写入任务表）/ 拒绝并反馈 / 上一步
import React from 'react';
import { handleExternalLink } from '../../../../utils/openExternal';
import {
  FaCheck,
  FaTimes,
  FaUndo,
  FaRobot,
  FaExclamationTriangle,
  FaLightbulb,
  FaBullseye,
  FaHourglassHalf,
  FaExternalLinkAlt,
  FaDatabase,
  FaCalendarAlt,
} from 'react-icons/fa';
import { summarizePlan } from '../../services/planGenerator';
import { plannedItemCount } from '../../services/taskMaterializer';
import { USER_TYPE_META } from '../../services/templates';
import type { GeneratedPlan, PlanDay, ResourceItem } from '../../types';

interface Props {
  plan: GeneratedPlan;
  revealed: number;
  resources: Map<string, ResourceItem>;
  onSkip: () => void;
  onPatchTask: (day: number, item: number, patch: { title?: string; estimatedMinutes?: number }) => void;
  onPatchEvent: (day: number, item: number, patch: { startTime?: string; endTime?: string; title?: string }) => void;
  onAccept: () => void;
  onRejectView: () => void;
  rejecting: boolean;
  feedback: string;
  onFeedback: (v: string) => void;
  onDoReject: () => void;
  onCancelReject: () => void;
  writeToDb: boolean;
  onWriteToDbChange: (v: boolean) => void;
  writeProgress: { done: number; total: number } | null;
  desktop: boolean;
  onBack: () => void;
  /** 资源被打开时上报来源，用于本地偏好打分（真实点击才计数） */
  onResourceOpen?: (source: string) => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  学习: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  健身: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  工作: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  创作: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  通用: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const PlanStep: React.FC<Props> = (props) => {
  const { plan, revealed, resources } = props;
  const meta = USER_TYPE_META[plan.userType];
  const summary = summarizePlan(plan);
  const planItemCount = plannedItemCount(plan);
  const done = revealed >= plan.days.length;
  const generation = plan.generation;

  const visibleDays: Array<{ day: PlanDay; idx: number }> = [];
  plan.days.forEach((d, i) => {
    if (i < revealed) visibleDays.push({ day: d, idx: i });
  });

  const dayName = (date: string): string => DAY_NAMES[new Date(date + 'T00:00:00').getDay()] ?? '';

  return (
    <div className="space-y-3">
      {/* 整体策略卡片 */}
      {plan.strategy && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center">
              <FaLightbulb className="w-4 h-4 mr-2 text-amber-500" />
              整体策略
            </h3>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                generation?.source === 'llm'
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {generation?.source === 'llm'
                ? `AI 生成${generation.model ? ` · ${generation.model}` : ''}`
                : '规则生成器（AI 未启用或失败）'}
            </span>
          </div>

          <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">方法论</h4>
              <ul className="space-y-1">
                {plan.strategy.methodology.map((m, i) => (
                  <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start">
                    <span className="w-1 h-1 rounded-full bg-primary-400 mt-1.5 mr-2 flex-shrink-0" />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1.5 flex items-center">
                <FaExclamationTriangle className="w-3 h-3 mr-1" />
                风险提示
              </h4>
              <ul className="space-y-1.5">
                {plan.strategy.risks.map((r, i) => (
                  <li
                    key={i}
                    className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-2 py-1.5"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1.5 flex items-center">
                <FaBullseye className="w-3 h-3 mr-1" />
                可验证的成功标准
              </h4>
              <ul className="space-y-1">
                {plan.strategy.successCriteria.map((c, i) => (
                  <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start">
                    <FaCheck className="w-2.5 h-2.5 text-emerald-500 mt-0.5 mr-1.5 flex-shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {(generation?.warnings?.length ?? 0) > 0 && (
            <div className="px-5 pb-4">
              <ul className="space-y-1">
                {generation!.warnings.map((w, i) => (
                  <li key={i} className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start">
                    <FaExclamationTriangle className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 计划卡片 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700" style={{ borderLeft: `4px solid ${meta.color}` }}>
          <div className="flex items-center flex-wrap gap-2 mb-1.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${meta.dot}`} />
              {meta.label}
            </span>
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {plan.planType === 'tasks' ? '任务列表' : '事件时段表'}
            </span>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLOR[plan.category]}`}>
              {plan.category}
            </span>
            {plan.llmModel && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                <FaRobot className="w-3 h-3 mr-1" />
                {plan.llmModel}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">目标：{plan.goal}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {plan.days.length} 天 · 共 {summary.itemCount} 项 · 合计约 {summary.totalMinutes} 分钟 · 日均约{' '}
            {summary.avgPerDay} 分钟
            {plan.resources?.length ? ` · 引用资源 ${plan.resources.length} 条` : ''}
          </p>
        </div>

        {plan.aiNarrative && (
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-violet-50/60 dark:bg-violet-900/10">
            <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-1 flex items-center">
              <FaRobot className="w-3.5 h-3.5 mr-1.5" />
              总体建议
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {plan.aiNarrative}
            </p>
          </div>
        )}

        {!done && (
          <div className="px-5 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mr-3 overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-300"
                style={{ width: `${Math.round((revealed / plan.days.length) * 100)}%` }}
              />
            </div>
            <button onClick={props.onSkip} className="text-xs text-primary-600 dark:text-primary-400 whitespace-nowrap">
              跳过动画 ({revealed}/{plan.days.length})
            </button>
          </div>
        )}

        <div className="max-h-[34rem] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
          {visibleDays.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-gray-400">正在本地生成…</div>
          )}
          {visibleDays.map(({ day, idx }) => (
            <div key={day.date} className="px-5 py-4" style={{ animation: 'planDayIn .35s ease both' }}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  <FaCalendarAlt className="w-3.5 h-3.5 mr-2 text-gray-400" />
                  {day.date.slice(5)} · {dayName(day.date)}
                  <span className="ml-2 text-xs font-normal text-gray-400">第 {idx + 1} 天</span>
                </h4>
                {day.tasks ? (
                  <span className="text-xs text-gray-400">
                    {day.tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0)} 分钟
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">{(day.events ?? []).length} 个时段</span>
                )}
              </div>

              {day.tasks ? (
                <ul className="space-y-3">
                  {day.tasks.map((t, ti) => (
                    <li key={ti} className="rounded-lg border border-gray-100 dark:border-gray-700/60 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-primary-50 dark:bg-primary-900/30 text-primary-500 dark:text-primary-400 flex items-center justify-center text-[11px] font-semibold flex-shrink-0">
                          {ti + 1}
                        </span>
                        <input
                          value={t.title}
                          onChange={(e) => props.onPatchTask(idx, ti, { title: e.target.value })}
                          className="flex-1 min-w-0 text-sm bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-600 focus:border-primary-500 outline-none text-gray-800 dark:text-gray-200"
                        />
                        <input
                          type="number"
                          min={5}
                          value={t.estimatedMinutes}
                          onChange={(e) => props.onPatchTask(idx, ti, { estimatedMinutes: Number(e.target.value) || 5 })}
                          className="w-16 text-xs text-right bg-gray-50 dark:bg-gray-700 rounded-md px-1.5 py-1 text-gray-600 dark:text-gray-300"
                        />
                        <span className="text-xs text-gray-400">分</span>
                      </div>

                      {t.bestTime && (
                        <p className="mt-1 ml-7 text-[11px] text-gray-400 flex items-center">
                          <FaHourglassHalf className="w-2.5 h-2.5 mr-1" />
                          建议时间 {t.bestTime}
                        </p>
                      )}

                      {t.reason && (
                        <p className="mt-1 ml-7 text-[11px] text-gray-400 leading-relaxed">理由：{t.reason}</p>
                      )}

                      {t.methodology && t.methodology.length > 0 && (
                        <div className="mt-1.5 ml-7 flex flex-wrap gap-1">
                          {t.methodology.map((m) => (
                            <span
                              key={m}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}

                      {t.resourceIds && t.resourceIds.length > 0 && (
                        <div className="mt-1.5 ml-7 space-y-0.5">
                          {t.resourceIds.map((id) => {
                            const res = resources.get(id);
                            if (!res) return null;
                            return (
                              <a
                                key={id}
                                href={res.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                onClick={(e) => {
                                  props.onResourceOpen?.(res.source);
                                  handleExternalLink(e, res.url);
                                }}
                                className="flex items-start text-[11px] text-primary-600 dark:text-primary-400 hover:underline"
                              >
                                <FaExternalLinkAlt className="w-2.5 h-2.5 mt-1 mr-1.5 flex-shrink-0" />
                                <span className="break-words">{res.title}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="space-y-1.5">
                  {(day.events ?? []).map((ev, ei) => (
                    <li key={ei} className="flex items-center gap-2 text-sm">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLOR[ev.category]}`}>{ev.category}</span>
                      <input
                        type="time"
                        value={ev.startTime}
                        onChange={(e) => props.onPatchEvent(idx, ei, { startTime: e.target.value })}
                        className="bg-gray-50 dark:bg-gray-700 rounded-md px-1 py-0.5 text-xs text-gray-600 dark:text-gray-300"
                      />
                      <span className="text-xs text-gray-400">→</span>
                      <input
                        type="time"
                        value={ev.endTime}
                        onChange={(e) => props.onPatchEvent(idx, ei, { endTime: e.target.value })}
                        className="bg-gray-50 dark:bg-gray-700 rounded-md px-1 py-0.5 text-xs text-gray-600 dark:text-gray-300"
                      />
                      <input
                        value={ev.title}
                        onChange={(e) => props.onPatchEvent(idx, ei, { title: e.target.value })}
                        className="flex-1 min-w-0 bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-600 focus:border-primary-500 outline-none text-gray-800 dark:text-gray-200"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* 反馈与操作 */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
          {props.rejecting ? (
            <div className="space-y-2">
              <textarea
                value={props.feedback}
                onChange={(e) => props.onFeedback(e.target.value)}
                placeholder="这份计划哪里不合适？（可选）例如：时间太紧 / 资源太难 / 想拆得更碎…"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-200"
              />
              <div className="flex gap-2">
                <button
                  onClick={props.onDoReject}
                  className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm transition-colors"
                >
                  拒绝并保存反馈
                </button>
                <button
                  onClick={props.onCancelReject}
                  className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3">
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={props.writeToDb}
                    onChange={(e) => props.onWriteToDbChange(e.target.checked)}
                    className="mt-0.5 mr-2 w-4 h-4 rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    接受时写入任务表（按每个日期生成数据库中的真实任务）
                    <span className="block text-xs text-gray-400 mt-0.5">
                      共 {planItemCount} 条任务，将在任务列表中按到期日出现；任务描述会带上安排理由与引用资源
                    </span>
                  </span>
                </label>
                {!props.desktop && (
                  <p className="mt-1.5 ml-6 text-xs text-amber-600 dark:text-amber-400">
                    当前为浏览器环境，无法写入本地数据库；请使用桌面版（Tauri）运行。
                  </p>
                )}
                {props.writeProgress && (
                  <div className="mt-2 ml-6 flex items-center text-xs text-primary-600 dark:text-primary-400">
                    <FaDatabase className="w-3 h-3 mr-1.5" />
                    正在写入任务表 {props.writeProgress.done}/{props.writeProgress.total}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={props.onAccept}
                  disabled={!done || props.writeProgress != null}
                  className="inline-flex items-center px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FaCheck className="w-4 h-4 mr-2" />
                  {props.writeToDb ? '接受并写入任务表' : '接受计划并保存'}
                </button>
                <button
                  onClick={props.onRejectView}
                  disabled={!done}
                  className="inline-flex items-center px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <FaTimes className="w-3.5 h-3.5 mr-1.5" />
                  不合适，反馈
                </button>
                <button
                  onClick={props.onBack}
                  className="inline-flex items-center px-3 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  <FaUndo className="w-3 h-3 mr-1" />
                  上一步（资源）
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes planDayIn { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: none;} }`}</style>
    </div>
  );
};
