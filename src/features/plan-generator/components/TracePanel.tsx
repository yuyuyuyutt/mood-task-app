// src/features/plan-generator/components/TracePanel.tsx
// 设置页「运行轨迹」卡片：把每次 AI run 的结构化记录摊开给用户看。
//
// 这张卡回答的正是 Agent 类项目最常被追问的问题：**"你怎么知道它为什么失败？"**
//   - 本次用了哪一级能力（multi / single / agent / pipeline / rule）；
//   - 每一步的名称、类型、耗时、成败与结论；
//   - 调了哪些工具、是否被闸门拒绝、拒绝原因；
//   - 在哪个环节降级、降级原因是什么；
//   - 用的是哪个 prompt 版本、JSON Schema 有没有被服务端接受。
import React, { useState } from 'react';
import {
  FaStream,
  FaSyncAlt,
  FaTrash,
  FaChevronDown,
  FaChevronRight,
  FaCheckCircle,
  FaTimesCircle,
  FaExclamationTriangle,
  FaSpinner,
} from 'react-icons/fa';
import { useTraces } from '../hooks/useTraces';
import type { AgentRunTrace, TraceLevel } from '../services/agent/trace';

const LEVEL_LABEL: Record<TraceLevel, string> = {
  multi: '多角色协作',
  single: '单 Agent',
  agent: '工具编排',
  pipeline: '固定管线',
  rule: '规则兜底',
};

const LEVEL_TONE: Record<TraceLevel, string> = {
  multi: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300',
  single: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300',
  agent: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300',
  pipeline: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-700/40 dark:text-gray-300',
  rule: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300',
};

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export const TracePanel: React.FC = () => {
  const { traces, loading, clear, refresh } = useTraces();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg mr-3">
            <FaStream className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">运行轨迹</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              每次 AI 运行都留一条结构化记录：能力级别 / 每步耗时与成败 / 工具裁决 / 降级原因 / prompt 版本
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 text-gray-600 text-xs"
          >
            <FaSyncAlt className="w-3 h-3 mr-1.5" />
            刷新
          </button>
          <button
            onClick={() => {
              if (window.confirm('清空本机保存的运行轨迹？（仅删除可观测记录，不影响计划与任务数据）')) {
                clear();
              }
            }}
            disabled={traces.length === 0}
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 text-gray-600 text-xs disabled:opacity-50"
          >
            <FaTrash className="w-3 h-3 mr-1.5" />
            清空
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 flex items-center">
          <FaSpinner className="w-3.5 h-3.5 mr-2 animate-spin" />
          读取运行轨迹…
        </p>
      ) : traces.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-2">
          还没有运行记录。生成一次计划或做一次对话式调整后，这里会出现本次运行的完整轨迹。
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
          {traces.map((trace) => (
            <TraceRow
              key={trace.id}
              trace={trace}
              expanded={expanded === trace.id}
              onToggle={() => setExpanded(expanded === trace.id ? null : trace.id)}
            />
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
        轨迹只在本机保留最近 20 条，落盘失败会被静默忽略（可观测性不能反过来拖垮业务）；
        其中的目标是截断后的短文本，不包含任务正文与心情记录。
      </p>
    </div>
  );
};

const TraceRow: React.FC<{ trace: AgentRunTrace; expanded: boolean; onToggle: () => void }> = ({
  trace,
  expanded,
  onToggle,
}) => {
  const failedSteps = trace.steps.filter((s) => !s.ok).length;
  return (
    <li className="bg-white dark:bg-gray-800">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 flex items-center gap-2 flex-wrap"
      >
        {expanded ? (
          <FaChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
        ) : (
          <FaChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
        )}
        <span
          className={`px-2 py-0.5 rounded-full border text-[11px] shrink-0 ${LEVEL_TONE[trace.level]}`}
        >
          {LEVEL_LABEL[trace.level]}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{trace.kind}</span>
        <span className="text-sm text-gray-800 dark:text-gray-200 truncate min-w-0 flex-1">
          {trace.goal || '（无目标）'}
        </span>
        <span className="text-[11px] text-gray-400 shrink-0">
          {timeOf(trace.startedAt)} · {trace.steps.length} 步 · {trace.ms ?? 0}ms
          {failedSteps > 0 && <span className="text-red-500"> · {failedSteps} 步失败</span>}
          {trace.fallbacks.length > 0 && (
            <span className="text-amber-600"> · 降级 {trace.fallbacks.length}</span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span>
              模型：<span className="font-mono">{trace.model ?? '未使用'}</span>
            </span>
            <span>
              prompt：<span className="font-mono">{trace.promptVersion}</span>
            </span>
            <span>
              JSON Schema：
              {trace.schemaApplied === undefined
                ? '未走模型'
                : trace.schemaApplied
                  ? '已约束'
                  : '被拒→已去约束重试'}
            </span>
            <span>记忆命中：{trace.memoryHits.length}</span>
          </div>

          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left font-normal py-0.5">步骤</th>
                <th className="text-left font-normal">类型</th>
                <th className="text-right font-normal">耗时</th>
                <th className="text-left font-normal pl-2">结果</th>
              </tr>
            </thead>
            <tbody>
              {trace.steps.map((step, index) => (
                <tr key={`${step.name}-${index}`} className="align-top">
                  <td className="py-0.5 pr-2 text-gray-700 dark:text-gray-300 font-mono">
                    {step.name}
                  </td>
                  <td className="text-gray-400">{step.kind}</td>
                  <td className="text-right text-gray-400">{step.ms}ms</td>
                  <td className="pl-2">
                    {step.ok ? (
                      <FaCheckCircle className="inline w-3 h-3 text-emerald-500" />
                    ) : (
                      <FaTimesCircle className="inline w-3 h-3 text-red-500" />
                    )}
                    {step.note && <span className="ml-1 text-gray-500">{step.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {trace.toolCalls.length > 0 && (
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5">工具调用</p>
              <ul className="space-y-0.5">
                {trace.toolCalls.map((call, index) => (
                  <li key={`${call.name}-${index}`} className="text-[11px]">
                    {call.ok ? (
                      <span className="text-emerald-600">✓</span>
                    ) : (
                      <span className="text-red-500">✕</span>
                    )}
                    <span className="ml-1 font-mono text-gray-700 dark:text-gray-300">{call.name}</span>
                    {call.reason && <span className="ml-1 text-red-500">{call.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {trace.fallbacks.length > 0 && (
            <div>
              <p className="text-[11px] text-amber-600 flex items-center mb-0.5">
                <FaExclamationTriangle className="w-3 h-3 mr-1" />
                降级路径
              </p>
              <ul className="space-y-0.5">
                {trace.fallbacks.map((fb, index) => (
                  <li key={`${fb.stage}-${index}`} className="text-[11px] text-gray-500">
                    <span className="font-mono text-gray-600 dark:text-gray-300">{fb.stage}</span>
                    <span className="mx-1">→</span>
                    {fb.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {trace.warnings.length > 0 && (
            <ul className="space-y-0.5">
              {trace.warnings.map((w, index) => (
                <li key={`w-${index}`} className="text-[11px] text-gray-400">
                  · {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
};
