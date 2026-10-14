// src/pages/StudyWorkspace.tsx
// 学习工作区：**执行**计划的地方（任务列表负责"生成"，这里负责"学"）。
//
// 页面只回答三个问题，多一个都不回答：
//   1) 现在该学哪一条？（复用任务栏的计划队列语义 —— 只给"下一条待做"）
//   2) 这条内容在哪、能不能在这里读？（白名单阅读模式；读不到就一键加白名单或去浏览器）
//   3) 学完了怎么收尾？（计时 → 三行总结 → 写会话与记忆 → 安排复习）
//
// 三个刻意的产品决定（都在代码里有对应实现，不是文案）：
//   - 辅导员**默认禁止无依据回答**：没有正文或检索不到就直说，不调模型；
//   - 会话与笔记进 `__study` 命名空间，**随备份导出**（正文缓存不进备份）；
//   - 复习任务走既有任务表与写通道，不打计划标签（不被逐条解锁隐藏）。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaInfoCircle, FaTimes } from 'react-icons/fa';
import { api } from '../api';
import { loadTutorThread, putTutorThread } from '../api/studyStore';
import { usePluginHost } from '../plugins/runtime';
import { usePlans } from '../features/plan-generator/hooks/usePlans';
import { useEmbeddingSettings } from '../features/plan-generator/hooks/useEmbeddingSettings';
import { KV_LLM_CONFIG, kvGet } from '../features/plan-generator/db/plannerDB';
import { DEFAULT_LLM_CONFIG, type LLMConfig } from '../features/plan-generator/services/llmClient';
import { buildRagRuntime } from '../features/plan-generator/services/rag/hybridRetriever';
import { createVectorStore } from '../features/plan-generator/services/rag/vectorStore';
import { buildPlanQueue } from '../features/plan-generator/services/planQueue';
import { StudyFocusCard, type StudyQueuePosition } from '../features/study/components/StudyFocusCard';
import { ReadingView } from '../features/study/components/ReadingView';
import { TutorPanel } from '../features/study/components/TutorPanel';
import { PomodoroCard } from '../features/study/components/PomodoroCard';
import { StudyNotesCard } from '../features/study/components/StudyNotesCard';
import { StudyReviewCard } from '../features/study/components/StudyReviewCard';
import { usePomodoro } from '../features/study/hooks/usePomodoro';
import { useStudyData } from '../features/study/hooks/useStudyData';
import { linkTaskToPlan } from '../features/study/planLink';
import { openReading } from '../features/study/reading';
import { buildReviewPlan, reviewTaskPayloads } from '../features/study/review';
import { askTutor, type TutorAnswer } from '../features/study/tutor';
import { rememberStudySession } from '../features/study/sessionMemory';
import { newId } from '../features/study/id';
import type { StudyNote, StudyResourceView, StudySession, TutorMessage } from '../features/study/types';
import type { Task } from '../types';

export const StudyWorkspace: React.FC = () => {
  const { dataStore } = usePluginHost();
  const study = useStudyData(dataStore);
  const { plans } = usePlans();
  const { settings: embedding, update: updateEmbedding } = useEmbeddingSettings();

  const [llmConfig, setLlmConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState('');
  const storeRef = useRef(createVectorStore());

  // 阅读
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [reading, setReading] = useState<Awaited<ReturnType<typeof openReading>> | null>(null);
  const [readingBusy, setReadingBusy] = useState(false);

  // 会话
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [achieved, setAchieved] = useState(true);
  const [saving, setSaving] = useState(false);

  // 复习
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewCreated, setReviewCreated] = useState(0);

  // 辅导员
  const [thread, setThread] = useState<TutorMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [asking, setAsking] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<TutorAnswer | undefined>(undefined);

  const reloadTasks = useCallback(async () => {
    try {
      setTasks(await api.getTasks());
    } catch (err) {
      console.error('[study] 读取任务失败:', err);
    }
  }, []);

  useEffect(() => {
    void reloadTasks();
    kvGet<LLMConfig>(KV_LLM_CONFIG)
      .then((config) => setLlmConfig({ ...DEFAULT_LLM_CONFIG, ...(config ?? {}) }))
      .catch(() => undefined);
  }, [reloadTasks]);

  // ---------------- 今天该学哪一条 ----------------
  const queue = useMemo(() => buildPlanQueue(tasks), [tasks]);

  const focus = useMemo(() => {
    const candidates = queue
      .map((group) => group.next)
      .filter((task): task is Task => Boolean(task))
      .sort((a, b) => ((a.due_date ?? '') < (b.due_date ?? '') ? -1 : 1));
    if (candidates[0]) {
      const group = queue.find((g) => g.next?.id === candidates[0].id);
      const position: StudyQueuePosition | undefined = group
        ? {
            label: group.label,
            position: group.position,
            total: group.total,
            remaining: group.remaining,
          }
        : undefined;
      return { task: candidates[0], goal: group?.label ?? candidates[0].tags?.[0], position };
    }
    // 没有计划任务时退化为"第一条未完成的普通任务"，工作区照样可用
    const fallback = tasks.find((task) => task.status !== 'completed' && !task.is_habit);
    return { task: fallback, goal: fallback?.tags?.[0], position: undefined };
  }, [queue, tasks]);

  const link = useMemo(
    () => (focus.task ? linkTaskToPlan(focus.task, plans) : undefined),
    [focus.task, plans],
  );

  const resources = useMemo<StudyResourceView[]>(() => {
    if (!link) return [];
    return link.resources.map((resource) => ({
      resource,
      progress: study.progress[resource.id],
      snippets: (link.evidence ?? [])
        .filter((evidence) => evidence.resourceId === resource.id)
        .map((evidence) => evidence.snippet),
    }));
  }, [link, study.progress]);

  const activeResource = useMemo(
    () => resources.find((view) => view.resource.id === activeResourceId)?.resource,
    [resources, activeResourceId],
  );

  /** 当前任务的第一条资源（换任务时才变化，不受进度更新影响） */
  const firstResourceId = link?.resources[0]?.id ?? null;

  const goalLabel = focus.goal ?? link?.plan?.goal ?? focus.task?.title ?? '';

  // 换任务时把"当前资源"对齐到它的第一条资源（下面的 effect 负责清正文与载入对话）
  useEffect(() => {
    setActiveResourceId(firstResourceId);
  }, [firstResourceId]);

  /**
   * 资源切换：正文、引用与对话都**只属于某一条资源**，必须整体重置。
   *
   * 这里刻意只依赖 `activeResourceId`：如果依赖 `resources`/`progress`，
   * 那么"保存一次会话"引起进度变化时会把刚读到的正文也清掉 —— 那种 bug 只在真机上才会被发现。
   */
  useEffect(() => {
    setReading(null);
    setLastAnswer(undefined);
    setStreaming('');
    if (!activeResourceId) {
      setThread([]);
      return;
    }
    void loadTutorThread(dataStore, activeResourceId).then((saved) => {
      setThread(saved?.messages ?? []);
    });
  }, [activeResourceId, dataStore]);

  // ---------------- 阅读 ----------------
  const handleOpenReading = useCallback(async () => {
    if (!activeResource) return;
    setReadingBusy(true);
    try {
      const outcome = await openReading({
        url: activeResource.url,
        title: activeResource.title,
        settings: embedding,
      });
      setReading(outcome);
      if (outcome.text) {
        await study.markResource({
          resourceId: activeResource.id,
          url: activeResource.url,
          state: 'reading',
        });
      }
    } finally {
      setReadingBusy(false);
    }
  }, [activeResource, embedding, study]);

  const handleWhitelist = useCallback(
    async (domain: string) => {
      const allowedDomains = Array.from(new Set([...embedding.allowedDomains, domain]));
      await updateEmbedding({ contentFetch: true, allowedDomains });
      setNotice(`已把 ${domain} 加入抓取白名单，现在可以点刷新读取正文`);
    },
    [embedding.allowedDomains, updateEmbedding],
  );

  const handleMarkResourceDone = useCallback(
    async (resourceId: string) => {
      const view = resources.find((item) => item.resource.id === resourceId);
      if (!view) return;
      await study.markResource({
        resourceId,
        url: view.resource.url,
        state: 'done',
        minutes: 0,
      });
      setNotice('已标记为读完');
    },
    [resources, study],
  );

  // ---------------- 番茄钟与会话 ----------------
  const pomodoro = usePomodoro({
    onEvent: (event) =>
      event === 'focus-complete'
        ? setNotice('这一轮专注结束：可以休息一下，或者直接「结束学习」收工')
        : setNotice('休息结束，可以继续下一轮'),
  });

  const studying = sessionStartedAt != null;

  const handleStart = useCallback(() => {
    if (!focus.task) return;
    setSessionStartedAt(new Date().toISOString());
    setWrapUpOpen(false);
    setSummaryDraft('');
    setAchieved(true);
    setReviewCreated(0);
    pomodoro.reset();
    pomodoro.start();
    setNotice('开始学习：侧栏番茄钟开始计时');
  }, [focus.task, pomodoro]);

  const handleFinish = useCallback(() => {
    pomodoro.pause();
    setWrapUpOpen(true);
  }, [pomodoro]);

  const handleSaveSession = useCallback(async () => {
    if (!focus.task || !sessionStartedAt) return;
    setSaving(true);
    try {
      const minutes = Math.max(1, pomodoro.focusedMinutes);
      const endedAt = new Date().toISOString();
      const session: StudySession = {
        id: newId('session'),
        startedAt: sessionStartedAt,
        endedAt,
        minutes,
        goal: goalLabel,
        planId: link?.plan?.id,
        taskId: focus.task.id,
        taskTitle: focus.task.title,
        resourceId: activeResource?.id,
        resourceTitle: activeResource?.title,
        predictedMinutes: focus.task.estimated_time,
        summary: summaryDraft.trim() || undefined,
        achieved,
        category: link?.plan?.category,
      };
      await study.saveSession(session);

      // 回流：把"预估 vs 实际"写进记忆（下次生成计划时会被召回）
      const remembered = await rememberStudySession({
        goal: goalLabel,
        minutes,
        predictedMinutes: focus.task.estimated_time,
        sessions: study.summary.sessions + 1,
        summary: summaryDraft.trim() || undefined,
        category: link?.plan?.category,
      }).catch(() => ({ note: null, merged: false }));

      if (activeResource) {
        await study.markResource({
          resourceId: activeResource.id,
          url: activeResource.url,
          minutes,
          state: 'reading',
        });
      }

      if (achieved) {
        await api.updateTask(focus.task.id, { status: 'completed', completed_at: endedAt });
        await reloadTasks();
      }

      pomodoro.reset();
      setSessionStartedAt(null);
      setWrapUpOpen(false);
      setNotice(
        `已记录 ${minutes} 分钟学习${achieved ? '，任务标记完成' : ''}${
          remembered.note ? '，并写入长期记忆' : ''
        }`,
      );
    } catch (err) {
      setNotice(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [
    achieved,
    activeResource,
    focus.task,
    goalLabel,
    link?.plan?.category,
    link?.plan?.id,
    pomodoro,
    reloadTasks,
    sessionStartedAt,
    study,
    summaryDraft,
  ]);

  // ---------------- 复习 ----------------
  const handleCreateReviews = useCallback(async () => {
    if (!focus.task || !goalLabel) return;
    setReviewBusy(true);
    try {
      const plan = buildReviewPlan({
        goal: goalLabel,
        taskTitle: focus.task.title,
        minutes: focus.task.estimated_time,
      });
      for (const payload of reviewTaskPayloads(plan, { category: link?.plan?.category })) {
        await api.createTask(payload);
      }
      setReviewCreated(plan.items.length);
      await reloadTasks();
      setNotice(`已创建 ${plan.items.length} 条复习任务（可在任务列表里看到）`);
    } catch (err) {
      setNotice(`创建复习任务失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReviewBusy(false);
    }
  }, [focus.task, goalLabel, link?.plan?.category, reloadTasks]);

  // ---------------- 辅导员 ----------------
  const blockedReason = !activeResource
    ? '先从左侧选一条资源。'
    : !reading?.text
      ? '先读取正文（右侧「阅读模式」）：辅导员只依据正文回答，没有正文就不猜。'
      : !llmConfig.enabled || !llmConfig.model
        ? '未开启本地模型：设置页 → AI 增强。没有模型就无法做基于依据的辅导。'
        : undefined;

  const handleAsk = useCallback(
    async (question: string) => {
      if (!activeResource || !reading?.text) return;
      const askedAt = new Date().toISOString();
      const userMessage: TutorMessage = {
        id: newId('m'),
        role: 'user',
        content: question,
        createdAt: askedAt,
      };
      setThread((prev) => [...prev, userMessage]);
      setAsking(true);
      setStreaming('');
      setLastAnswer(undefined);

      try {
        const answer = await askTutor({
          question,
          resource: {
            id: activeResource.id,
            title: activeResource.title,
            url: activeResource.url,
          },
          text: reading.text,
          config: llmConfig,
          corpus: buildRagRuntime(
            llmConfig,
            { model: embedding.model, timeoutMs: embedding.timeoutMs },
            storeRef.current,
          ),
          history: thread,
          onDelta: (delta) => setStreaming((prev) => prev + delta),
        });
        setLastAnswer(answer);

        if (answer.status === 'answered') {
          const assistantMessage: TutorMessage = {
            id: newId('m'),
            role: 'assistant',
            content: answer.answer,
            createdAt: new Date().toISOString(),
            citations: answer.citations.map((citation) => citation.id),
          };
          const nextThread = [...thread, userMessage, assistantMessage];
          setThread(nextThread);
          await putTutorThread(dataStore, {
            resourceId: activeResource.id,
            resourceTitle: activeResource.title,
            messages: nextThread,
            updatedAt: assistantMessage.createdAt,
          });
        } else {
          // 拒绝回答时不把这一轮存进历史：下次打开看到"有问无答"只会更困惑
          setThread(thread);
        }
      } finally {
        setStreaming('');
        setAsking(false);
      }
    },
    [activeResource, dataStore, embedding.model, embedding.timeoutMs, llmConfig, reading, thread],
  );

  const handleSaveAnswerAsNote = useCallback(
    async (text: string) => {
      const now = new Date().toISOString();
      const note: StudyNote = {
        id: newId('note'),
        createdAt: now,
        updatedAt: now,
        title: `辅导记录：${text.slice(0, 20)}`,
        body: text,
        tags: ['辅导'],
        resourceId: activeResource?.id,
        resourceTitle: activeResource?.title,
        taskId: focus.task?.id,
      };
      await study.saveNote(note);
      setNotice('已存为笔记');
    },
    [activeResource, focus.task?.id, study],
  );

  const handleClearThread = useCallback(async () => {
    if (!activeResource) return;
    await putTutorThread(dataStore, {
      resourceId: activeResource.id,
      resourceTitle: activeResource.title,
      messages: [],
      updatedAt: new Date().toISOString(),
    });
    setThread([]);
    setLastAnswer(undefined);
  }, [activeResource, dataStore]);

  /**
   * 专注阅读：正文已经读到本机时**自动**把版面让给正文（其它面板退到侧栏或收起）。
   * 用户可以随时退出；退出后不会因为进度更新又被弹回来（依赖的是"有没有正文"这个状态，
   * 而不是每次 `reading` 变化）。
   */
  const [focusMode, setFocusMode] = useState(false);
  const hasReadingText = Boolean(reading?.text);
  useEffect(() => {
    if (hasReadingText) setFocusMode(true);
  }, [hasReadingText]);
  const focusReading = focusMode && hasReadingText;

  // ---------------- 收工面板 ----------------
  const wrapUp = wrapUpOpen ? (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-[13px] font-medium text-ink">
        收工：这次专注 {pomodoro.focusedMinutes} 分钟
      </p>
      <p className="mt-1 text-[11px] text-ink-3">
        任务预估 {focus.task?.estimated_time ?? '未设置'} 分钟 · 偏差会写进记忆，用来校准下次的时长预估
      </p>
      <textarea
        value={summaryDraft}
        onChange={(e) => setSummaryDraft(e.target.value)}
        rows={3}
        placeholder={'三行总结：学到了什么 / 卡在哪里 / 下次从哪继续'}
        className="input mt-2 text-[12px]"
      />
      <label className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={achieved} onChange={(e) => setAchieved(e.target.checked)} />
        今天的成功标准达成了（勾选会同时把这条任务标记完成）
      </label>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void handleSaveSession()}
          disabled={saving}
          className="btn btn-primary btn-sm disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存本次学习'}
        </button>
        <button type="button" onClick={() => setWrapUpOpen(false)} className="btn btn-ghost btn-sm">
          继续学
        </button>
      </div>
    </div>
  ) : null;

  /** 辅导员面板：两种版面共用（专注阅读时它退到侧栏，把主区让给正文） */
  const tutorPanel = (
    <TutorPanel
      resourceTitle={activeResource?.title}
      blockedReason={blockedReason}
      messages={thread}
      streaming={streaming}
      busy={asking}
      lastResult={lastAnswer}
      onAsk={(question) => void handleAsk(question)}
      onSaveAnswer={(text) => void handleSaveAnswerAsNote(text)}
      onClearThread={() => void handleClearThread()}
    />
  );

  return (
    <div className="space-y-3">
      {/* 顶部读数 + 通知 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-ink-3">
          累计学习 {study.summary.minutes} 分钟 · {study.summary.sessions} 次会话 · {study.summary.notes} 条笔记
          {study.summary.resourcesDone > 0 ? ` · 读完 ${study.summary.resourcesDone} 条资源` : ''}
        </p>
        {notice && (
          <p className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2">
            <FaInfoCircle className="text-[9px] text-ink-3" />
            {notice}
            <button type="button" onClick={() => setNotice('')} className="text-ink-3 hover:text-ink">
              <FaTimes className="text-[9px]" />
            </button>
          </p>
        )}
      </div>

      {/* 专注阅读时的一行状态条：会话控制（开始/结束学习）与退出入口都留在这里 */}
      {focusReading && (
        <div className="card flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-ink">
              专注阅读
            </span>
            <span className="truncate text-xs text-ink-3">{activeResource?.title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="tnum text-xs text-ink-2">已专注 {pomodoro.focusedMinutes} 分钟</span>
            {studying ? (
              <button type="button" onClick={handleFinish} className="btn btn-primary btn-sm">
                结束学习
              </button>
            ) : (
              <button type="button" onClick={handleStart} className="btn btn-ghost btn-sm">
                开始学习
              </button>
            )}
            <button type="button" onClick={() => setFocusMode(false)} className="btn btn-ghost btn-sm">
              退出专注阅读
            </button>
          </div>
        </div>
      )}

      {focusReading && wrapUp}

      <div className={`grid gap-4 ${focusReading ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : 'lg:grid-cols-[minmax(0,1fr)_18rem]'}`}>
        {/* 主区 */}
        <div className="min-w-0 space-y-4">
          {focusReading ? (
            /* 专注阅读：正文占满主区，任务卡/复习/速记让位（可从状态条退出） */
            <ReadingView
              resourceTitle={activeResource?.title}
              resourceUrl={activeResource?.url}
              outcome={reading}
              busy={readingBusy}
              focus
              onToggleFocus={setFocusMode}
              onOpen={() => void handleOpenReading()}
              onWhitelist={(domain) => void handleWhitelist(domain)}
            />
          ) : (
            <>
              <StudyFocusCard
                goal={goalLabel}
                queue={focus.position}
                task={focus.task}
                resources={resources}
                activeResourceId={activeResourceId}
                studying={studying}
                onStart={handleStart}
                onFinish={handleFinish}
                onSelectResource={setActiveResourceId}
                onMarkResourceDone={(id) => void handleMarkResourceDone(id)}
                progressOf={(id) => study.progress[id]}
                wrapUp={wrapUp}
              />

              {focus.task && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <ReadingView
                    resourceTitle={activeResource?.title}
                    resourceUrl={activeResource?.url}
                    outcome={reading}
                    busy={readingBusy}
                    focus={false}
                    onToggleFocus={setFocusMode}
                    onOpen={() => void handleOpenReading()}
                    onWhitelist={(domain) => void handleWhitelist(domain)}
                  />
                  {tutorPanel}
                </div>
              )}
            </>
          )}
        </div>

        {/* 侧栏 */}
        <aside className="space-y-4">
          {focusReading && tutorPanel}
          <PomodoroCard
            clock={pomodoro.clock}
            phase={pomodoro.state.phase}
            running={pomodoro.state.running}
            focusRounds={pomodoro.state.focusRounds}
            focusedMinutes={pomodoro.focusedMinutes}
            todayMinutes={study.summary.todayMinutes}
            focusMinutes={pomodoro.state.focusMinutes}
            breakMinutes={pomodoro.state.breakMinutes}
            onChangeDurations={pomodoro.setDurations}
            onToggle={pomodoro.toggle}
            onSkip={pomodoro.skip}
            onReset={pomodoro.reset}
          />
          <StudyReviewCard
            goal={goalLabel}
            taskTitle={focus.task?.title}
            taskMinutes={focus.task?.estimated_time}
            busy={reviewBusy}
            createdCount={reviewCreated}
            onCreate={() => void handleCreateReviews()}
          />
          <StudyNotesCard
            notes={[
              ...study.notes.filter((note) => note.resourceId === activeResource?.id),
              ...study.notes.filter((note) => note.resourceId !== activeResource?.id),
            ].slice(0, 8)}
            context={{
              resourceId: activeResource?.id,
              resourceTitle: activeResource?.title,
              taskId: focus.task?.id,
            }}
            onSave={(note) => void study.saveNote(note)}
            onDelete={(id) => void study.removeNoteById(id)}
            makeId={() => newId('note')}
          />
        </aside>
      </div>
    </div>
  );
};
