// src/features/plan-generator/components/AgentRunPanel.tsx
// Agent 一次运行的结果面板：把"多角色协作这一轮到底发生了什么"摊开给用户看。
//
// 展示优先级（也是面试时要讲清的三件事）：
//   1) **走到了哪一级能力**（multi / single / pipeline / rule）与哪些角色参与了；
//   2) **哪些澄清结论是假设**（basis=default）—— 假设必须可见、可改，不能冒充事实；
//   3) **Critic 发现并修掉了什么**（违规清单 + 修正差异），以及还剩什么问题没解决。
import React from 'react';
import {
  FaProjectDiagram,
  FaCheckCircle,
  FaExclamationTriangle,
  FaInfoCircle,
  FaUndo,
  FaRoute,
} from 'react-icons/fa';
import type { AgentPlanRun } from '../services/agent/agents/orchestrator';
import type { AgentLevel } from '../services/agent/agents/protocol';

const LEVEL_LABEL: Record<AgentLevel, { text: string; hint: string; tone: string }> = {
  multi: {
    text: '多角色协作',
    hint: '澄清 → 检索 → 规划 → 校验 四个角色全部跑通',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300',
  },
  single: {
    text: '单 Agent 降级',
    hint: '有 specialist 失败，规划仍由模型完成',
    tone: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300',
  },
  pipeline: {
    text: '检索 + 规划',
    hint: '澄清/校验角色未参与，走确定性管线',
    tone: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-700/40 dark:text-gray-300',
  },
  rule: {
    text: '规则引擎',
    hint: '模型不可用，已回退确定性规则生成器',
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300',
  },
};

const BASIS_LABEL: Record<string, string> = {
  profile: '本地画像',
  memory: '历史记忆',
  default: '默认假设',
};

interface Props {
  run: AgentPlanRun;
  onClose: () => void;
}

export const AgentRunPanel: React.FC<Props> = ({ run, onClose }) => {
  const level = LEVEL_LABEL[run.level];
  const assumptions = run.answers.filter((a) => a.basis === 'default');
  const errors = run.critique.violations.filter((v) => v.severity === 'error');
  const warns = run.critique.violations.filter((v) => v.severity === 'warn');

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-900/10 overflow-hidden">
      <div className="px-5 py-3 border-b border-violet-100 dark:border-violet-900/40 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center">
          <FaProjectDiagram className="w-4 h-4 mr-2 text-violet-500" />
          Agent 运行报告
          <span className={`ml-2 px-2 py-0.5 rounded-full border text-[11px] font-normal ${level.tone}`}>
            {level.text}
          </span>
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-400 inline-flex items-center">
            <FaRoute className="w-2.5 h-2.5 mr-1" />
            trace {run.traceId}
          </span>
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 inline-flex items-center"
          >
            <FaUndo className="w-3 h-3 mr-1" />
            收起
          </button>
        </div>
      </div>

      <div className="p-5 space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">参与角色：</span>
          {run.roles.length === 0 ? (
            <span className="text-amber-600">无（已回退确定性路径）</span>
          ) : (
            run.roles.map((role) => (
              <span
                key={role}
                className="px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300"
              >
                {role}
              </span>
            ))
          )}
          <span className="text-gray-400">· 角色间消息 {run.messages.length} 条</span>
          <span className="text-gray-400">· {level.hint}</span>
        </div>

        {/* 澄清结论：依据来源必须可见 */}
        <div>
          <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
            澄清结论（自问自答，共 {run.answers.length} 条
            {assumptions.length > 0 ? `，其中 ${assumptions.length} 条为默认假设` : ''}）
          </p>
          <ul className="space-y-1 max-h-44 overflow-y-auto">
            {run.answers.map((a) => (
              <li key={a.id} className="flex items-start text-xs">
                <span
                  className={`mr-2 mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
                    a.basis === 'default'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {BASIS_LABEL[a.basis] ?? a.basis}
                </span>
                <span className="min-w-0 text-gray-600 dark:text-gray-300">
                  {a.question}
                  <span className="text-gray-400"> → </span>
                  {a.answer}
                </span>
              </li>
            ))}
          </ul>
          {assumptions.length > 0 && (
            <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-start">
              <FaInfoCircle className="w-3 h-3 mr-1 mt-0.5 shrink-0" />
              标记为「默认假设」的结论没有本地依据，是按保守策略填的，请重点核对。
            </p>
          )}
        </div>

        {/* Critic 校验与修正 */}
        <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5 flex items-center">
            {errors.length === 0 ? (
              <FaCheckCircle className="w-3 h-3 mr-1.5 text-emerald-500" />
            ) : (
              <FaExclamationTriangle className="w-3 h-3 mr-1.5 text-amber-500" />
            )}
            约束校验：{run.critique.ok ? '通过' : `仍有 ${errors.length} 个问题`}
            <span className="ml-2 font-normal text-gray-400">
              （检查了 {run.critique.checked} 项约束
              {run.repair.applied
                ? `，${run.repair.source === 'llm' ? '模型' : '规则'}修正 ${run.repair.rounds} 轮`
                : '，未触发修正'}
              ）
            </span>
          </p>

          {(errors.length > 0 || warns.length > 0) && (
            <ul className="space-y-0.5 mt-1">
              {[...errors, ...warns].slice(0, 6).map((v, i) => (
                <li key={`${v.type}-${v.day ?? i}`} className="text-xs text-gray-500 dark:text-gray-400">
                  <span
                    className={`mr-1.5 ${v.severity === 'error' ? 'text-red-500' : 'text-amber-500'}`}
                  >
                    {v.severity === 'error' ? '✕' : '!'}
                  </span>
                  {v.detail}
                </li>
              ))}
            </ul>
          )}

          {run.repair.applied && run.repair.diff.changes.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <p className="text-[11px] text-gray-400 mb-1">
                修正内容（{run.repair.note ?? '自动修正'}）：
              </p>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {run.repair.diff.changes.slice(0, 8).map((c, i) => (
                  <li key={`${c.kind}-${i}`} className="text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="text-gray-400">{c.day ?? '全局'}</span> · {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {run.warnings.length > 0 && (
          <ul className="space-y-0.5">
            {run.warnings.slice(0, 6).map((w, i) => (
              <li key={`w-${i}`} className="text-[11px] text-gray-500 dark:text-gray-400">
                · {w}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-gray-400 leading-relaxed">
          本轮的每一步（角色输入产出、工具裁决、检索与降级原因）都记在轨迹里；
          计划正文与 3 步向导生成的结果完全同构，可以继续用「对话式调整」或直接接受。
        </p>
      </div>
    </div>
  );
};
