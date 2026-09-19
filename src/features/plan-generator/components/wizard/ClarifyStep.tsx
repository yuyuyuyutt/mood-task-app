// src/features/plan-generator/components/wizard/ClarifyStep.tsx
// 阶段 1：澄清问题表单。每个问题下方显示"为什么问这个"，让用户理解意图。
import React from 'react';
import {
  FaSpinner,
  FaExclamationTriangle,
  FaQuestionCircle,
  FaArrowLeft,
  FaArrowRight,
  FaRobot,
} from 'react-icons/fa';
import type { ClarifyAnswers, ClarifyResult, ClarifyingQuestion } from '../../types';

interface Props {
  goal: string;
  days: number;
  questions: ClarifyingQuestion[];
  answers: ClarifyAnswers;
  loading: boolean;
  error: string | null;
  /** 问题来源：llm=模型生成；template=通用模板兜底 */
  source: ClarifyResult['source'] | null;
  fallbackReason?: string;
  onAnswer: (id: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
  onRetry: () => void;
}

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent';

export const ClarifyStep: React.FC<Props> = ({
  goal,
  days,
  questions,
  answers,
  loading,
  error,
  source,
  fallbackReason,
  onAnswer,
  onNext,
  onBack,
  onRetry,
}) => {
  const answeredCount = questions.filter((q) => (answers[q.id] ?? '').trim().length > 0).length;
  const canProceed = questions.length === 0 || answeredCount >= Math.min(2, questions.length);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center">
          <FaQuestionCircle className="w-4 h-4 mr-2 text-primary-500" />
          第 1 步 · 澄清问题
        </h3>
        <span className="text-xs text-gray-400">
          目标：{goal} · {days} 天
        </span>
      </div>

      <div className="p-5 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-10 text-gray-500 dark:text-gray-400">
            <FaSpinner className="w-5 h-5 mr-2 animate-spin" />
            正在生成澄清问题…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 flex items-start">
            <FaExclamationTriangle className="w-4 h-4 text-red-500 mr-2 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-700 dark:text-red-300">
              <p>{error}</p>
              <button onClick={onRetry} className="mt-1.5 text-xs underline">
                重试
              </button>
            </div>
          </div>
        )}

        {!loading && questions.length > 0 && (
          <>
            {source === 'template' && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start">
                <FaExclamationTriangle className="w-3.5 h-3.5 mr-2 mt-0.5 flex-shrink-0" />
                <span>
                  已使用<b>通用问题模板</b>
                  {fallbackReason ? `（${fallbackReason}）` : ''}。开启本地 AI 后可由模型针对你的目标定制问题。
                </span>
              </div>
            )}

            {questions.map((q, index) => (
              <div key={q.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {index + 1}. {q.question}
                  </label>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {q.dimension}
                  </span>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2.5 flex items-start">
                  <FaQuestionCircle className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />
                  为什么问这个：{q.why}
                </p>

                {q.kind === 'single' && q.options && (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((opt) => {
                      const active = answers[q.id] === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => onAnswer(q.id, active ? '' : opt)}
                          className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                            active
                              ? 'bg-primary-500 border-primary-500 text-white'
                              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-primary-400'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {q.kind === 'multi' && q.options && (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((opt) => {
                      const current = (answers[q.id] ?? '').split('、').filter(Boolean);
                      const active = current.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            const next = active
                              ? current.filter((c) => c !== opt)
                              : [...current, opt];
                            onAnswer(q.id, next.join('、'));
                          }}
                          className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                            active
                              ? 'bg-primary-500 border-primary-500 text-white'
                              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-primary-400'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {(q.kind === 'text' || q.kind === 'number') && (
                  <input
                    type={q.kind === 'number' ? 'number' : 'text'}
                    value={answers[q.id] ?? ''}
                    placeholder={q.placeholder ?? '请输入…'}
                    onChange={(e) => onAnswer(q.id, e.target.value)}
                    className={INPUT_CLS}
                  />
                )}
              </div>
            ))}

            <p className="text-xs text-gray-400">
              已填写 {answeredCount}/{questions.length}（至少填写 {Math.min(2, questions.length)} 项即可继续）
            </p>
          </>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={onBack}
            className="inline-flex items-center px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <FaArrowLeft className="w-3 h-3 mr-1.5" />
            返回目标设置
          </button>
          <div className="flex items-center gap-2">
            {!loading && questions.length > 0 && (
              <button
                onClick={onRetry}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <FaRobot className="w-3 h-3 inline mr-1" />
                重新生成问题
              </button>
            )}
            <button
              onClick={onNext}
              disabled={loading || !canProceed}
              className="inline-flex items-center px-5 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步：检索资源
              <FaArrowRight className="w-3 h-3 ml-2" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
