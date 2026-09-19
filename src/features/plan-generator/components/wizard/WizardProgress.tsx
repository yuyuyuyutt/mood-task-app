// src/features/plan-generator/components/wizard/WizardProgress.tsx
// 三阶段向导的步骤指示器（可点击已完成步骤返回）。
import React from 'react';
import { FaCheck } from 'react-icons/fa';

export interface WizardStepDef {
  key: string;
  title: string;
  description: string;
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { key: 'clarify', title: '澄清问题', description: '先问清楚，才能做得准' },
  { key: 'resources', title: '资源检索', description: '真实可用的学习/训练材料' },
  { key: 'plan', title: '计划生成', description: '逐日安排 + 理由 + 引用' },
];

interface Props {
  /** 当前步骤索引（0 起） */
  current: number;
  /** 已完成到第几步（用于允许返回） */
  reachable: number;
  onJump: (index: number) => void;
}

export const WizardProgress: React.FC<Props> = ({ current, reachable, onJump }) => {
  return (
    <ol className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
      {WIZARD_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const clickable = index <= reachable && !active;
        return (
          <li key={step.key} className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(index)}
              className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm transition-colors ${
                active
                  ? 'bg-primary-500 text-white font-medium'
                  : done
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
              } ${clickable ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                  active
                    ? 'bg-white/25 text-white'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300'
                }`}
              >
                {done ? <FaCheck className="w-2.5 h-2.5" /> : index + 1}
              </span>
              <span className="whitespace-nowrap">{step.title}</span>
            </button>
            {index < WIZARD_STEPS.length - 1 && (
              <span className="hidden sm:block w-4 h-px bg-gray-200 dark:bg-gray-700" />
            )}
          </li>
        );
      })}
    </ol>
  );
};
