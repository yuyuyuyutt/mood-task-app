// src/features/plan-generator/components/PlanGeneratorWorkspace.tsx
// 个性化计划生成器（任务列表页内嵌）—— 三阶段向导式交互：
//   第 0 步：目标 / 天数 / 可用时段 / 偏好（表单）
//   第 1 步：澄清问题（LLM 生成，失败回退通用模板）
//   第 2 步：资源检索（关键词 → B 站 / SearXNG / 跳转按钮三层，失败静默降级）
//   第 3 步：计划生成（LLM 结合真实资源，失败回退规则生成器）→ 可接受并写入任务表
// 隐私：分析与存储全部本地；联网层默认关闭；所有 LLM 调用经 llmTasks 生命周期管理器串行执行。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaMagic,
  FaShieldAlt,
  FaRobot,
  FaExclamationTriangle,
  FaTrash,
  FaEye,
  FaCheckSquare,
  FaRegClock,
  FaServer,
  FaSyncAlt,
  FaDatabase,
  FaUndo,
} from 'react-icons/fa';
import type { Task } from '../../../types';
import { tasksToSamples } from '../services/adapters';
import { generateClarifyingQuestions } from '../services/clarificationService';
import { collectResources, extractKeywords } from '../services/resourceService';
import { composePlan, indexResources } from '../services/planComposer';
import {
  DEFAULT_LLM_CONFIG,
  isLocalEndpoint,
  probeOllama,
  type LLMConfig,
} from '../services/localLLM';
import { llmTasks, type LlmManagerStats } from '../services/llmTaskManager';
import {
  isDesktopRuntime,
  materializePlan,
  plannedItemCount,
  rollbackMaterialized,
} from '../services/taskMaterializer';
import { USER_TYPE_META, detectGoalCategory } from '../services/templates';
import { useHabitProfile } from '../hooks/useHabitProfile';
import { usePlans } from '../hooks/usePlans';
import { useNetworkingSettings } from '../hooks/useNetworkingSettings';
import { useResourceLibrary } from '../hooks/useResourceLibrary';
import { KV_LLM_CONFIG, KV_RESOURCE_CLICKS, kvGet, kvSet } from '../db/plannerDB';
import { WizardProgress } from './wizard/WizardProgress';
import { ClarifyStep } from './wizard/ClarifyStep';
import { ResourceStep } from './wizard/ResourceStep';
import { PlanStep } from './wizard/PlanStep';
import type {
  Availability,
  ClarifyAnswers,
  ClarifyResult,
  GeneratedPlan,
  KeywordResult,
  PlanType,
  ResourceBundle,
  UserType,
} from '../types';

interface Props {
  tasks: Task[];
  /** 写入任务表成功后通知外层刷新任务列表 */
  onTasksChanged?: () => void;
}

type Stage = 'form' | 'clarify' | 'resources' | 'plan';

interface FormState {
  goal: string;
  days: number;
  planType: PlanType;
  availStart: string;
  availEnd: string;
  minutesPerDay: number;
  style: 'auto' | 'fragmented' | 'long_focus';
  includeWeekend: boolean;
}

const DEFAULT_FORM: FormState = {
  goal: '',
  days: 7,
  planType: 'tasks',
  availStart: '08:00',
  availEnd: '22:00',
  minutesPerDay: 0,
  style: 'auto',
  includeWeekend: true,
};

export const PlanGeneratorWorkspace: React.FC<Props> = ({ tasks, onTasksChanged }) => {
  const { effectiveUserType, analyze } = useHabitProfile();
  const plansApi = usePlans();
  const { settings: netSettings, networkEnabled } = useNetworkingSettings();
  const library = useResourceLibrary();

  const [stage, setStage] = useState<Stage>('form');
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [notice, setNotice] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiStats, setAiStats] = useState<LlmManagerStats>(llmTasks.getStats());

  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [showLlmOpt, setShowLlmOpt] = useState(false);
  const [probe, setProbe] = useState<{ loading: boolean; ok: boolean; error?: string }>({ loading: false, ok: false });
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  // 阶段 1
  const [clarify, setClarify] = useState<ClarifyResult | null>(null);
  const [answers, setAnswers] = useState<ClarifyAnswers>({});
  // 阶段 2
  const [keywords, setKeywords] = useState<KeywordResult | null>(null);
  const [bundle, setBundle] = useState<ResourceBundle | null>(null);
  // 阶段 3
  const [draft, setDraft] = useState<GeneratedPlan | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [writeToDb, setWriteToDb] = useState(true);
  const [writeProgress, setWriteProgress] = useState<{ done: number; total: number } | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const revealTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const samples = useMemo(() => tasksToSamples(tasks), [tasks]);
  const autoAnalyzed = useRef(false);

  // 生命周期：订阅 AI 任务状态（UI 显示"AI 正在处理…"）
  useEffect(() => {
    const unsub = llmTasks.subscribe(setAiStats);
    return () => {
      unsub();
      // 卸载时取消全部在途 LLM 请求，避免 CPU 常驻占用
      llmTasks.cancelAll();
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (autoAnalyzed.current || samples.length < 3) return;
    autoAnalyzed.current = true;
    void analyze(samples, []).catch(() => undefined);
  }, [samples, analyze]);

  useEffect(() => {
    kvGet<LLMConfig>(KV_LLM_CONFIG)
      .then((c) => setLlmConfig({ ...DEFAULT_LLM_CONFIG, ...(c ?? {}) }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (revealTimer.current != null) window.clearInterval(revealTimer.current);
    };
  }, []);

  const patchLlm = useCallback(
    async (patch: Partial<LLMConfig>) => {
      const next = { ...llmConfig, ...patch };
      setLlmConfig(next);
      await kvSet(KV_LLM_CONFIG, next);
    },
    [llmConfig],
  );

  const detectOllama = useCallback(async () => {
    setProbe({ loading: true, ok: false });
    const res = await probeOllama(llmConfig.baseUrl);
    setProbe({ loading: false, ok: res.ok, error: res.error });
    if (res.ok) {
      setModelOptions(res.models);
      const model = llmConfig.model && res.models.includes(llmConfig.model) ? llmConfig.model : res.models[0] ?? '';
      await patchLlm({ model });
      setNotice(
        res.models.length > 0
          ? `已连接本地 Ollama，发现 ${res.models.length} 个模型${model ? `，已选择 ${model}` : ''}`
          : '已连接 Ollama，但没有已安装模型（请先 ollama pull <模型>）',
      );
    } else {
      setNotice(res.error ?? '无法连接 Ollama');
    }
  }, [llmConfig.baseUrl, llmConfig.model, patchLlm]);

  const updateForm = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  /** 记录资源点击（用于"用户历史偏好"打分，仅本地计数） */
  const recordResourceClick = useCallback(async (source: string) => {
    try {
      const clicks = (await kvGet<Record<string, number>>(KV_RESOURCE_CLICKS)) ?? {};
      clicks[source] = (clicks[source] ?? 0) + 1;
      await kvSet(KV_RESOURCE_CLICKS, clicks);
    } catch {
      /* 忽略统计失败 */
    }
  }, []);

  // ---------------- 阶段 1 ----------------

  const startClarify = useCallback(async () => {
    const goal = form.goal.trim();
    if (goal.length < 2) {
      setNotice('请先输入一个目标（至少 2 个字）');
      return;
    }
    setNotice(null);
    setStepError(null);
    setAnswers({});
    setKeywords(null);
    setBundle(null);
    setDraft(null);
    setStage('clarify');
    setBusy(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const profile = await analyze(samples, []);
      const userType: UserType = profile.userTypeOverride ?? profile.userType;
      const result = await generateClarifyingQuestions({
        goal,
        days: form.days,
        userType,
        config: llmConfig,
        signal: abortRef.current.signal,
      });
      setClarify(result);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [form.goal, form.days, samples, analyze, llmConfig]);

  // ---------------- 阶段 2 ----------------

  const runResourceSearch = useCallback(async () => {
    setStepError(null);
    setBusy(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const userType = effectiveUserType ?? 'balanced';
      const answerList = (clarify?.questions ?? []).map((q) => ({
        id: q.id,
        question: q.question,
        answer: (answers[q.id] ?? '').trim() || '（未填写）',
      }));

      const kw = await extractKeywords({
        goal: form.goal.trim(),
        days: form.days,
        answers: answerList,
        userType,
        config: llmConfig,
        signal,
      });
      setKeywords(kw);

      const clicks = (await kvGet<Record<string, number>>(KV_RESOURCE_CLICKS)) ?? {};
      const totalClicks = Object.values(clicks).reduce((s, n) => s + n, 0);
      const sourcePreference: Record<string, number> = {};
      for (const [src, n] of Object.entries(clicks)) {
        if (totalClicks > 0) sourcePreference[src] = n / totalClicks;
      }

      const joined = answerList.map((a) => a.answer).join(' ');
      const bundleResult = await collectResources({
        keywords: kw.keywords,
        settings: netSettings,
        manualResources: library.resources,
        signal,
        scoreContext: {
          preferredDifficulty: netSettings.preferredDifficulty,
          preferVideo: /视频/.test(joined),
          preferReading: /(读书|文档|看书)/.test(joined),
          preferHandsOn: /(动手|练习|实践|项目)/.test(joined),
          sourcePreference,
        },
      });
      setBundle(bundleResult);
      setStage('resources');
    } catch (err) {
      setStepError(err instanceof Error ? err.message : String(err));
      setStage('resources');
    } finally {
      setBusy(false);
    }
  }, [clarify, answers, form.goal, form.days, effectiveUserType, llmConfig, netSettings, library.resources]);

  // ---------------- 阶段 3 ----------------

  const runPlanCompose = useCallback(async () => {
    if (!bundle) return;
    setStepError(null);
    setBusy(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const userType = effectiveUserType ?? 'balanced';
      const availability: Availability = { start: form.availStart, end: form.availEnd };
      const profile = await analyze(samples, []);
      const answerList = (clarify?.questions ?? []).map((q) => ({
        id: q.id,
        question: q.question,
        answer: (answers[q.id] ?? '').trim() || '（未填写）',
      }));

      const result = await composePlan({
        input: {
          goal: form.goal.trim(),
          days: form.days,
          planType: form.planType,
          userType,
          preferences: {
            style: form.style,
            availability,
            minutesPerDay: form.minutesPerDay > 0 ? form.minutesPerDay : undefined,
            includeWeekend: form.includeWeekend,
          },
        },
        answers: answerList,
        profile,
        resources: bundle,
        config: llmConfig,
        signal: abortRef.current.signal,
      });

      setDraft(result.plan);
      setFeedback('');
      setRejecting(false);
      setStage('plan');
      setRevealed(0);
      setNotice(
        result.source === 'llm'
          ? `已由本地模型生成计划（${result.plan.days.length} 天，引用资源 ${result.plan.resources?.length ?? 0} 条）`
          : 'AI 未启用/失败，已用规则生成器生成计划（含策略与资源引用）',
      );
    } catch (err) {
      setStepError(err instanceof Error ? err.message : String(err));
      setStage('plan');
    } finally {
      setBusy(false);
    }
  }, [bundle, effectiveUserType, form, samples, analyze, clarify, answers, llmConfig]);

  // 流式揭示
  useEffect(() => {
    if (stage !== 'plan' || !draft) return;
    setRevealed(0);
    revealTimer.current = window.setInterval(() => {
      setRevealed((r) => {
        if (r >= draft.days.length) {
          if (revealTimer.current != null) window.clearInterval(revealTimer.current);
          return r;
        }
        return r + 1;
      });
    }, 240);
    return () => {
      if (revealTimer.current != null) window.clearInterval(revealTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, draft?.id]);

  const skipReveal = () => {
    if (draft) setRevealed(draft.days.length);
  };

  const patchTask = (dayIdx: number, taskIdx: number, patch: { title?: string; estimatedMinutes?: number }) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            days: d.days.map((day, di) =>
              di === dayIdx && day.tasks
                ? { ...day, tasks: day.tasks.map((t, ti) => (ti === taskIdx ? { ...t, ...patch } : t)) }
                : day,
            ),
          }
        : d,
    );
  };

  const patchEvent = (
    dayIdx: number,
    evIdx: number,
    patch: { startTime?: string; endTime?: string; title?: string },
  ) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            days: d.days.map((day, di) =>
              di === dayIdx && day.events
                ? { ...day, events: day.events.map((ev, ei) => (ei === evIdx ? { ...ev, ...patch } : ev)) }
                : day,
            ),
          }
        : d,
    );
  };

  // ---------------- 落库与保存 ----------------

  const writePlanToDatabase = useCallback(
    async (plan: GeneratedPlan): Promise<GeneratedPlan> => {
      const total = plannedItemCount(plan);
      setWriteProgress({ done: 0, total });
      const res = await materializePlan(plan, (done, t) => setWriteProgress({ done, total: t }));
      setWriteProgress(null);
      const next: GeneratedPlan =
        res.created > 0
          ? {
              ...plan,
              materializedTaskIds: [...(plan.materializedTaskIds ?? []), ...res.taskIds],
              materializedAt: new Date().toISOString(),
            }
          : plan;

      if (res.created > 0) onTasksChanged?.();
      if (res.failed === 0) {
        setNotice(
          res.created > 0
            ? `已按日期写入任务表：新建 ${res.created} 条任务（可在任务列表中按到期日查看）`
            : '没有可写入的任务项',
        );
      } else if (res.created === 0) {
        setNotice(`写入任务表失败：${res.errors[0] ?? '未知错误'}`);
      } else {
        setNotice(`已写入 ${res.created} 条任务，${res.failed} 条失败`);
      }
      return next;
    },
    [onTasksChanged],
  );

  const acceptDraft = async () => {
    if (!draft) return;
    let plan: GeneratedPlan = { ...draft, accepted: true, feedback: null };
    await plansApi.savePlan(plan);
    if (writeToDb) {
      plan = await writePlanToDatabase(plan);
      await plansApi.savePlan(plan);
    } else {
      setNotice('计划已保存在本机（未写入任务表）');
    }
    setStage('form');
    setDraft(null);
    setShowSaved(true);
  };

  const doReject = async () => {
    if (!draft) return;
    await plansApi.rejectPlan(draft, feedback);
    setStage('form');
    setDraft(null);
    setShowSaved(true);
    setNotice('已记录你的反馈，谢谢');
  };

  const materializeSaved = useCallback(
    async (plan: GeneratedPlan) => {
      setBusyPlanId(plan.id);
      const next = await writePlanToDatabase(plan);
      await plansApi.savePlan(next);
      setBusyPlanId(null);
    },
    [writePlanToDatabase, plansApi],
  );

  const rollbackSaved = useCallback(
    async (plan: GeneratedPlan) => {
      const ids = plan.materializedTaskIds ?? [];
      if (ids.length === 0) return;
      if (!window.confirm(`撤回已写入的 ${ids.length} 条任务？这些任务将从任务表中删除。`)) return;
      setBusyPlanId(plan.id);
      const res = await rollbackMaterialized(ids);
      await plansApi.savePlan({ ...plan, materializedTaskIds: [], materializedAt: null });
      setBusyPlanId(null);
      onTasksChanged?.();
      setNotice(`已撤回 ${res.deleted} 条任务${res.failed ? `（${res.failed} 条失败）` : ''}`);
    },
    [plansApi, onTasksChanged],
  );

  const resetToForm = () => {
    llmTasks.cancelAll();
    abortRef.current?.abort();
    setStage('form');
    setStepError(null);
    setBusy(false);
  };

  const typeMeta = effectiveUserType ? USER_TYPE_META[effectiveUserType] : null;
  const resourceIndex = useMemo(() => indexResources(draft?.resources ?? []), [draft]);
  const stageIndex = stage === 'clarify' ? 0 : stage === 'resources' ? 1 : stage === 'plan' ? 2 : 0;
  const reachable = stage === 'form' ? -1 : stageIndex;

  return (
    <div className="space-y-4">
      {/* 步骤指示器 */}
      {stage !== 'form' && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <WizardProgress
            current={stageIndex}
            reachable={reachable}
            onJump={(index) => {
              if (index === 0) setStage('clarify');
              else if (index === 1 && bundle) setStage('resources');
              else if (index === 2 && draft) setStage('plan');
            }}
          />
          <div className="flex items-center gap-3">
            {aiStats.running > 0 && (
              <span className="text-xs text-violet-600 dark:text-violet-400 flex items-center">
                <FaRobot className="w-3 h-3 mr-1" />
                AI 正在处理{aiStats.lastKind ? `（${kindLabel(aiStats.lastKind)}）` : ''}
              </span>
            )}
            <button
              onClick={resetToForm}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <FaUndo className="w-3 h-3 inline mr-1" />
              重新开始
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded-lg">
          {notice}
        </p>
      )}

      {/* ============ 第 0 步：表单 ============ */}
      {stage === 'form' && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-[11px] text-brand">
                <FaMagic />
              </span>
              <h3 className="truncate text-sm font-semibold text-ink">个性化计划生成器</h3>

              {/* 状态标签替代整条隐私横幅：细节保留在 AI 设置面板内 */}
              <span
                className="chip cursor-default"
                title="分析与存储均在本机完成（IndexedDB + 本地数据库）；默认不联网，仅使用平台跳转按钮"
              >
                <FaShieldAlt className="text-[9px]" />
                本地运行
              </span>
              {typeMeta && (
                <span
                  className="chip hidden cursor-default sm:inline-flex"
                  title={`当前画像：${typeMeta.label}（可在「系统设置 → 个人画像」中修正）`}
                >
                  {typeMeta.label}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowSaved(!showSaved)}
              className="chip shrink-0 border-line bg-surface"
            >
              <FaEye className="text-[9px]" />
              {showSaved ? '隐藏已生成计划' : `已生成计划 ${plansApi.plans.length}`}
            </button>
          </div>

          <div className="p-5 space-y-4">
            {showSaved && (
              <SavedPlans
                plans={plansApi.plans}
                busyPlanId={busyPlanId}
                onDelete={(id) => {
                  if (window.confirm('确定删除这份计划？删除后不可恢复（已写入任务表的任务不会被删除）。')) {
                    void plansApi.removePlan(id);
                  }
                }}
                onMaterialize={(plan) => void materializeSaved(plan)}
                onRollback={(plan) => void rollbackSaved(plan)}
              />
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">目标</label>
              <input
                value={form.goal}
                onChange={(e) => updateForm({ goal: e.target.value })}
                placeholder="例如：学习 Python 基础 / 每周健身三次 / 完成产品方案"
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
              {form.goal.trim() && (
                <p className="mt-1 text-xs text-gray-400">
                  识别类别：
                  <span className="font-medium text-gray-500 dark:text-gray-400">{detectGoalCategory(form.goal)}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">天数</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={form.days}
                  onChange={(e) => updateForm({ days: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">每天投入（分钟）</label>
                <input
                  type="number"
                  min={15}
                  max={480}
                  value={form.minutesPerDay || ''}
                  placeholder="自动"
                  onChange={(e) => updateForm({ minutesPerDay: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">可用开始</label>
                <input
                  type="time"
                  value={form.availStart}
                  onChange={(e) => updateForm({ availStart: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">可用结束</label>
                <input
                  type="time"
                  value={form.availEnd}
                  onChange={(e) => updateForm({ availEnd: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">计划类型</span>
              <Segmented
                value={form.planType}
                options={[
                  { value: 'tasks', label: '任务列表', icon: <FaCheckSquare className="w-3.5 h-3.5" /> },
                  { value: 'events', label: '事件时段表', icon: <FaRegClock className="w-3.5 h-3.5" /> },
                ]}
                onChange={(v) => updateForm({ planType: v as PlanType })}
              />
              <label className="flex items-center text-sm text-gray-600 dark:text-gray-300 ml-auto">
                <input
                  type="checkbox"
                  checked={form.includeWeekend}
                  onChange={(e) => updateForm({ includeWeekend: e.target.checked })}
                  className="mr-1.5 w-4 h-4 rounded"
                />
                包含周末
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">计划风格</label>
              <select
                value={form.style}
                onChange={(e) => updateForm({ style: e.target.value as FormState['style'] })}
                className="w-full sm:w-64 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              >
                <option value="auto">跟随我的画像（推荐）</option>
                <option value="fragmented">碎片小任务优先（20-30 分钟）</option>
                <option value="long_focus">长块专注优先（1-2 小时）</option>
              </select>
            </div>

            {/* 联网状态提示 */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 text-xs">
              <span className="text-gray-500 dark:text-gray-400">资源检索：</span>
              <span className={networkEnabled ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                {networkEnabled
                  ? `已开启联网（${[netSettings.bilibili ? 'B 站' : '', netSettings.searxng ? 'SearXNG' : ''].filter(Boolean).join(' + ')}）`
                  : '纯本地（仅平台跳转按钮）'}
              </span>
              <span className="text-gray-400"> · 可在"系统设置 → 资源与联网"中调整</span>
            </div>

            {/* LLM 可选（默认关闭） */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowLlmOpt(!showLlmOpt)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800/70 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
              >
                <span className="flex items-center text-gray-600 dark:text-gray-300">
                  <FaRobot className="w-3.5 h-3.5 mr-2 text-gray-400" />
                  可选：本地 Ollama（澄清问题 + 关键词 + 计划生成）
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    {llmConfig.enabled ? '已开启' : '默认关闭'}
                  </span>
                </span>
                <span className="text-xs text-gray-400">{showLlmOpt ? '收起' : '展开'}</span>
              </button>
              {showLlmOpt && (
                <div className="px-4 py-3 space-y-3">
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={llmConfig.enabled}
                      onChange={(e) => void patchLlm({ enabled: e.target.checked })}
                      className="mt-0.5 mr-2 w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      启用本地 AI（关闭时：澄清问题用通用模板、关键词用模板、计划用规则生成器）
                    </span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Ollama 地址</label>
                      <input
                        value={llmConfig.baseUrl}
                        onChange={(e) => void patchLlm({ baseUrl: e.target.value })}
                        placeholder="http://127.0.0.1:11434"
                        className="w-full px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs font-mono text-gray-800 dark:text-gray-200"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">模型</label>
                      <div className="flex gap-2">
                        <input
                          value={llmConfig.model}
                          onChange={(e) => void patchLlm({ model: e.target.value })}
                          placeholder="qwen2.5:7b"
                          list="ollama-models"
                          className="flex-1 min-w-0 px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-xs font-mono text-gray-800 dark:text-gray-200"
                        />
                        <button
                          type="button"
                          onClick={() => void detectOllama()}
                          disabled={probe.loading}
                          className="px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-600 text-white text-xs whitespace-nowrap inline-flex items-center disabled:opacity-60"
                        >
                          {probe.loading ? <FaSyncAlt className="w-3 h-3 mr-1 animate-spin" /> : <FaServer className="w-3 h-3 mr-1" />}
                          检测
                        </button>
                      </div>
                    </div>
                  </div>
                  <datalist id="ollama-models">
                    {modelOptions.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>

                  {probe.loading && <p className="text-xs text-gray-400">正在连接 Ollama…</p>}
                  {!probe.loading && probe.error && <p className="text-xs text-red-500">{probe.error}</p>}
                  {!probe.loading && probe.ok && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      已连接 Ollama{modelOptions.length > 0 ? `，可用模型：${modelOptions.join('、')}` : ''}
                    </p>
                  )}

                  {llmConfig.enabled && (
                    <div
                      className={`flex items-start p-2.5 rounded-lg border ${
                        isLocalEndpoint(llmConfig.baseUrl)
                          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      }`}
                    >
                      <FaExclamationTriangle
                        className={`w-4 h-4 mr-2 mt-0.5 flex-shrink-0 ${
                          isLocalEndpoint(llmConfig.baseUrl) ? 'text-amber-500' : 'text-red-500'
                        }`}
                      />
                      <div className="text-xs leading-relaxed">
                        <p className={isLocalEndpoint(llmConfig.baseUrl) ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'}>
                          会把<b>目标、澄清回答、画像摘要、关键词与候选资源元数据</b>发送给该模型端点：
                          <span className="font-mono"> {llmConfig.baseUrl}</span>
                        </p>
                        <p className={`mt-1 ${isLocalEndpoint(llmConfig.baseUrl) ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400 font-medium'}`}>
                          {isLocalEndpoint(llmConfig.baseUrl)
                            ? '当前为本机端点，数据不会离开本机；模型空闲 30 秒后自动卸载，不常驻占用 CPU。'
                            : '⚠ 当前端点不是本机地址，数据将离开本机，请确认你信任该服务。'}
                        </p>
                        <p className="mt-1 text-gray-500 dark:text-gray-400">
                          连接失败（CORS）时请设置环境变量 <span className="font-mono">OLLAMA_ORIGINS="*"</span> 后重启 Ollama。
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => void startClarify()}
              disabled={busy}
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 rounded-xl bg-primary-500 hover:bg-primary-600 text-white font-semibold transition-colors disabled:opacity-60 text-sm"
            >
              {busy ? '正在准备…' : `开始 3 步生成（${form.days} 天）`}
            </button>
          </div>
        </div>
      )}

      {/* ============ 第 1 步：澄清 ============ */}
      {stage === 'clarify' && (
        <ClarifyStep
          goal={form.goal.trim()}
          days={form.days}
          questions={clarify?.questions ?? []}
          answers={answers}
          loading={busy}
          error={stepError}
          source={clarify?.source ?? null}
          fallbackReason={clarify?.fallbackReason}
          onAnswer={(id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))}
          onNext={() => void runResourceSearch()}
          onBack={resetToForm}
          onRetry={() => void startClarify()}
        />
      )}

      {/* ============ 第 2 步：资源 ============ */}
      {stage === 'resources' && (
        <ResourceStep
          keywords={keywords}
          bundle={bundle}
          loading={busy}
          error={stepError}
          settings={netSettings}
          manualResources={library.resources}
          networkEnabled={networkEnabled}
          onBack={() => setStage('clarify')}
          onNext={() => void runPlanCompose()}
          onRetry={() => void runResourceSearch()}
          onOpenSettings={() => {
            setNotice('可在「系统设置 → 资源与联网」中管理三层资源开关与 SearXNG 地址');
          }}
          onManualChanged={() => void library.refresh()}
        />
      )}

      {/* ============ 第 3 步：计划 ============ */}
      {stage === 'plan' && draft && (
        <PlanStep
          plan={draft}
          revealed={revealed}
          resources={resourceIndex}
          onSkip={skipReveal}
          onPatchTask={patchTask}
          onPatchEvent={patchEvent}
          onAccept={() => void acceptDraft()}
          onRejectView={() => setRejecting(true)}
          rejecting={rejecting}
          feedback={feedback}
          onFeedback={setFeedback}
          onDoReject={() => void doReject()}
          onCancelReject={() => setRejecting(false)}
          writeToDb={writeToDb}
          onWriteToDbChange={setWriteToDb}
          writeProgress={writeProgress}
          desktop={isDesktopRuntime()}
          onBack={() => setStage('resources')}
          onResourceOpen={(source) => void recordResourceClick(source)}
        />
      )}

    </div>
  );
};

// ---------------- 小部件 ----------------

function kindLabel(kind: LlmManagerStats['lastKind']): string {
  if (kind === 'clarify') return '澄清问题';
  if (kind === 'keywords') return '检索关键词';
  if (kind === 'plan') return '计划生成';
  return '空闲';
}

function Segmented<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1 gap-1">
      {props.options.map((o) => (
        <button
          key={o.value}
          onClick={() => props.onChange(o.value)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            props.value === o.value
              ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 已生成计划列表（可写入任务表 / 撤回 / 一键删除） */
function SavedPlans(props: {
  plans: GeneratedPlan[];
  busyPlanId: string | null;
  onDelete: (id: string) => void;
  onMaterialize: (plan: GeneratedPlan) => void;
  onRollback: (plan: GeneratedPlan) => void;
}) {
  if (props.plans.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 py-2">还没有生成过计划。</p>;
  }
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
      {props.plans.slice(0, 10).map((p) => {
        const meta = USER_TYPE_META[p.userType];
        const written = p.materializedTaskIds?.length ?? 0;
        const busy = props.busyPlanId === p.id;
        return (
          <div key={p.id} className="px-3 py-2.5 flex items-center gap-3">
            <span className={`w-1.5 h-8 rounded-full flex-shrink-0 ${meta.dot}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.goal}</p>
              <p className="text-xs text-gray-400">
                {p.createdAt.slice(0, 10)} · {p.days.length} 天 · {p.planType === 'tasks' ? '任务' : '事件'} ·{' '}
                {meta.label} · {p.generation?.source === 'llm' ? 'AI' : '规则'}
                {p.resources?.length ? ` · 引用 ${p.resources.length} 条资源` : ''}
                {p.accepted ? (
                  <span className="ml-1 text-emerald-500">已接受</span>
                ) : (
                  <span className="ml-1 text-amber-500">已拒绝{p.feedback && `：${p.feedback.slice(0, 16)}…`}</span>
                )}
                {written > 0 && <span className="ml-1 text-primary-500">· 已写入任务表 {written} 项</span>}
              </p>
            </div>
            {busy && <FaSyncAlt className="w-3.5 h-3.5 text-primary-500 animate-spin flex-shrink-0" />}
            {!busy && p.accepted && written === 0 && (
              <button
                onClick={() => props.onMaterialize(p)}
                title="按日期把这份计划写入任务表"
                className="px-2.5 py-1.5 rounded-lg text-xs bg-primary-50 dark:bg-blue-900/30 text-primary-600 dark:text-blue-400 hover:bg-primary-100 dark:hover:bg-blue-900/50 transition-colors inline-flex items-center whitespace-nowrap"
              >
                <FaDatabase className="w-3 h-3 mr-1" />
                写入任务表
              </button>
            )}
            {!busy && written > 0 && (
              <button
                onClick={() => props.onRollback(p)}
                title="撤回已写入的任务"
                className="px-2.5 py-1.5 rounded-lg text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors inline-flex items-center whitespace-nowrap"
              >
                <FaUndo className="w-3 h-3 mr-1" />
                撤回
              </button>
            )}
            <button
              onClick={() => props.onDelete(p.id)}
              title="删除这份计划（不影响已写入的任务）"
              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <FaTrash className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      {props.plans.length > 10 && <p className="px-3 py-2 text-xs text-gray-400">仅显示最近 10 份</p>}
    </div>
  );
}
