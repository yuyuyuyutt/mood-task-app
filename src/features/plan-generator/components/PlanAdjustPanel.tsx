// src/features/plan-generator/components/PlanAdjustPanel.tsx
// 对话式计划调整面板：把「Skill 白名单 + 权限门 + 确认闸门」这套机制暴露给用户。
//
// UI 上刻意做三件事，让安全模型"看得见"：
//   1) 变更以 **before → after 的逐条 diff** 呈现，而不是一句"已完成"；
//   2) 确认前明确写出"尚未生效"；
//   3) 底部展示本次 run 的 trace 摘要（选了哪个工具、是模型还是本地规则、是否降级）。
import React, { useState } from 'react';
import {
  FaRobot,
  FaCheck,
  FaTimes,
  FaSpinner,
  FaMagic,
  FaExclamationTriangle,
  FaShieldAlt,
  FaRoute,
} from 'react-icons/fa';
import type { GeneratedPlan } from '../types';
import type { LLMConfig } from '../services/llmClient';
import {
  ADJUST_SESSION_SCOPES,
  adjustPlan,
  commitAdjust,
  discardAdjust,
  type PlanAdjustResult,
} from '../services/agent/adjustPlan';
import { ADJUST_RULE_HINT } from '../services/prompts';
import type { PlanEditChange, PlanEditDiff } from '../services/agent/tools/types';

interface Props {
  plan: GeneratedPlan;
  config: LLMConfig;
  /** 用户确认后收到应用了 diff 的新计划 */
  onApplied: (plan: GeneratedPlan) => void;
}

type Pending = Extract<PlanAdjustResult, { status: 'ok' }>;

const KIND_LABEL: Record<PlanEditChange['kind'], string> = {
  shift_day: '顺延',
  compress_day: '压缩',
  remove_task: '删除',
  rename_task: '改写',
  move_task: '移动',
  resize_task: '调时长',
};

export const PlanAdjustPanel: React.FC<Props> = ({ plan, config, onApplied }) => {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  const aiReady = config.enabled && Boolean(config.model);

  const run = async () => {
    const text = instruction.trim();
    if (text.length < 2) {
      setMessage({ type: 'warn', text: '请先描述你想要的调整，例如「整周顺延 2 天」' });
      return;
    }
    setBusy(true);
    setMessage(null);
    setPending(null);
    try {
      const result = await adjustPlan({ instruction: text, plan, config });
      if (result.status === 'ok') {
        setPending(result);
        setMessage({
          type: 'ok',
          text: `${result.source === 'llm' ? 'AI 已给出变更建议' : '已用本地指令解析出变更'}（尚未生效，确认后才会应用到计划）`,
        });
      } else if (result.status === 'rejected') {
        setMessage({ type: 'error', text: `已拒绝执行：${result.reason}` });
      } else {
        setMessage({ type: 'warn', text: result.reply });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const res = await commitAdjust(pending.gate, pending.token, plan);
    setPending(null);
    if (!res.ok || !res.plan) {
      setMessage({ type: 'error', text: `确认失败：${res.reason ?? '未知原因'}` });
      return;
    }
    onApplied(res.plan);
    setMessage({ type: 'ok', text: `已应用变更（工具：${pending.diff.skill}）` });
    setInstruction('');
  };

  const cancel = () => {
    if (pending) discardAdjust(pending.gate, pending.token);
    setPending(null);
    setMessage({ type: 'warn', text: '已取消，计划未发生任何变化' });
  };

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-900/10 overflow-hidden">
      <div className="px-5 py-3 border-b border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center">
          <FaRobot className="w-4 h-4 mr-2 text-indigo-500" />
          对话式调整
          <span className="ml-2 text-[11px] font-normal text-gray-500 dark:text-gray-400">
            模型只做决策，动作经工具白名单 + 权限门 + 你的确认
          </span>
        </h3>
        <span className="text-[11px] text-gray-400 flex items-center">
          <FaShieldAlt className="w-3 h-3 mr-1" />
          已授权 {ADJUST_SESSION_SCOPES.length} 项权限范围
        </span>
      </div>

      <div className="p-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void run();
            }}
            placeholder="例如：周三出差，整周计划顺延 2 天"
            className="flex-1 min-w-[16rem] px-3.5 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
          />
          <button
            onClick={() => void run()}
            disabled={busy}
            className="inline-flex items-center px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {busy ? <FaSpinner className="w-3.5 h-3.5 mr-2 animate-spin" /> : <FaMagic className="w-3.5 h-3.5 mr-2" />}
            生成变更预览
          </button>
        </div>

        {!aiReady && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            当前未启用本地模型，将使用**本地指令解析**（不联网）。{ADJUST_RULE_HINT}
          </p>
        )}

        {message && (
          <p
            className={`text-xs px-3 py-2 rounded-lg flex items-start ${
              message.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                : message.type === 'warn'
                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}
          >
            {message.type === 'error' ? (
              <FaExclamationTriangle className="w-3 h-3 mr-1.5 mt-0.5 shrink-0" />
            ) : (
              <FaCheck className="w-3 h-3 mr-1.5 mt-0.5 shrink-0" />
            )}
            {message.text}
          </p>
        )}

        {pending && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-3.5 space-y-2.5">
            <p className="text-sm text-gray-800 dark:text-gray-200">{pending.reply}</p>
            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {pending.diff.summary}
              <span className="ml-2 font-normal text-gray-400">（共 {pending.diff.changes.length} 处变更，尚未生效）</span>
            </p>

            <DiffList diff={pending.diff} />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => void confirm()}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
              >
                <FaCheck className="w-3.5 h-3.5 mr-1.5" />
                确认应用
              </button>
              <button
                onClick={cancel}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
              >
                <FaTimes className="w-3.5 h-3.5 mr-1.5" />
                取消
              </button>
              <span className="text-[11px] text-gray-400 inline-flex items-center">
                <FaRoute className="w-2.5 h-2.5 mr-1" />
                trace {pending.traceId} · {pending.source === 'llm' ? '模型决策' : '本地指令解析'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const DiffList: React.FC<{ diff: PlanEditDiff }> = ({ diff }) => (
  <ul className="space-y-1 max-h-56 overflow-y-auto">
    {diff.changes.map((c, i) => (
      <li key={`${c.kind}-${c.day}-${i}`} className="flex items-start text-xs">
        <span className="mr-2 mt-0.5 shrink-0 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px] text-gray-500 dark:text-gray-400">
          {KIND_LABEL[c.kind] ?? c.kind}
        </span>
        <span className="min-w-0 text-gray-600 dark:text-gray-300">
          <span className="text-gray-400">{c.day}</span> · {c.title}
          <span className="ml-1.5 text-gray-400">{c.detail}</span>
        </span>
      </li>
    ))}
    {diff.changes.length === 0 && <li className="text-xs text-gray-400">没有可展示的变更项</li>}
  </ul>
);
