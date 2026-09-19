// src/pages/SchedulePlanner.tsx
// 时段面板（独立模块 · 周视图）
// - 与"任务列表"完全解耦：本页的每一条时段任务是面板自己的实体
//   （标题 / 开始时间 / 完成状态），存于 scheduleStore（Tauri SQLite /
//   localStorage 双写），不影响任务 API 与 due_date。
// - 一张图展示一周：左侧时段轴（清晨→深夜）× 7 天 = 42 个方块；
//   点方块 = 选中某「日期 × 时段」，在右侧添加/勾选/改名/移除/微调任务。
// - 时间可手动输入，也可拖动吸附条（自动吸附 0/5 结尾的分钟）。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FaChevronLeft,
  FaChevronRight,
  FaPlus,
  FaTimes,
  FaCheck,
  FaSpinner,
  FaPencilAlt,
} from 'react-icons/fa';
import { usePluginHost } from '../plugins/runtime';
import {
  loadDaySchedule,
  putScheduleItem,
  removeScheduleItem,
  type DaySchedule,
  type ScheduleItem,
} from '../api/scheduleStore';
import {
  TIME_BANDS,
  addDaysStr,
  bandForMinutes,
  formatDateCn,
  minutesToTime,
  snapToFiveMinutes,
  timeToMinutes,
  todayStr,
  weekStartStr,
  type TimeBand,
} from '../utils/timeSlots';

type Entry = { id: string; item: ScheduleItem };
type CellSel = { date: string; band: TimeBand };

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_LABEL = (date: string) => {
  const dt = new Date(`${date}T00:00:00`);
  return `周${WEEKDAY_CN[dt.getDay()]}`;
};

/** 生成本地唯一 id（纯前端，无需后端） */
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- 时间编辑器：手动输入 + 吸附(0/5结尾)拖动条 ---------------- */
const TimeEditor: React.FC<{
  band: TimeBand;
  value: string;
  onCommit: (time: string) => void;
  onCancel: () => void;
}> = ({ band, value, onCommit, onCancel }) => {
  const initial = snapToFiveMinutes(timeToMinutes(value) ?? band.startMin);
  const [draftMin, setDraftMin] = useState(initial);
  const draftTime = minutesToTime(draftMin);

  return (
    <div className="flex flex-wrap items-center gap-3 px-2 py-2 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
      <input
        type="time"
        value={draftTime === '24:00' ? '23:59' : draftTime}
        onChange={(e) => {
          const m = timeToMinutes(e.target.value);
          if (m != null) setDraftMin(Math.min(1435, snapToFiveMinutes(m)));
        }}
        className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />
      <input
        type="range"
        min={0}
        max={1435}
        step={5}
        value={Math.min(1435, draftMin)}
        onChange={(e) => setDraftMin(snapToFiveMinutes(Number(e.target.value)))}
        className="flex-1 min-w-[120px] accent-[var(--brand)]"
        aria-label="开始时间（吸附到 0/5 结尾）"
      />
      <span className="text-xs text-gray-500 dark:text-gray-400 w-24 text-right tabular-nums">
        {draftTime}
        <span className="ml-1 text-gray-300 dark:text-gray-600">吸附5分钟</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onCommit(draftTime)}
          className="px-2.5 py-1 text-xs rounded bg-brand text-white hover:opacity-80"
        >
          确定
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          取消
        </button>
      </div>
    </div>
  );
};

/* ---------------- 一条时段任务行 ---------------- */
const ScheduleRow: React.FC<{
  entry: Entry;
  band: TimeBand;
  onToggleDone: (entry: Entry) => void;
  onRemove: (entry: Entry) => void;
  onTimeChange: (entry: Entry, time: string) => void;
  onRename: (entry: Entry, title: string) => void;
}> = ({ entry, band, onToggleDone, onRemove, onTimeChange, onRename }) => {
  const [editingTime, setEditingTime] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(entry.item.title);
  const { item } = entry;
  const done = !!item.done;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={() => onToggleDone(entry)}
          title={done ? '标记为未完成' : '标记为完成'}
          className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
            done
              ? 'bg-brand border-brand text-white'
              : 'border-gray-300 dark:border-gray-500 text-transparent hover:border-gray-900 dark:hover:border-white'
          }`}
        >
          <FaCheck className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={() => setEditingTime((v) => !v)}
          title="修改时间（可拖动吸附条）"
          className="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 tabular-nums"
        >
          {item.start}
        </button>

        {renaming ? (
          <form
            className="flex-1 min-w-0 flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (titleDraft.trim()) onRename(entry, titleDraft.trim());
              setRenaming(false);
            }}
          >
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="flex-1 min-w-0 px-1.5 py-0.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <button type="submit" className="text-xs px-2 py-1 rounded bg-brand text-white">
              保存
            </button>
          </form>
        ) : (
          <span
            onDoubleClick={() => {
              setTitleDraft(item.title);
              setRenaming(true);
            }}
            title="双击改名"
            className={`flex-1 min-w-0 truncate text-sm cursor-text ${done ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}
          >
            {item.title}
          </span>
        )}

        <button
          onClick={() => {
            setTitleDraft(item.title);
            setRenaming(true);
          }}
          title="改名"
          className="p-1 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-300"
        >
          <FaPencilAlt className="w-3 h-3" />
        </button>
        <button
          onClick={() => onRemove(entry)}
          title="删除这条时段任务"
          className="p-1 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
        >
          <FaTimes className="w-3.5 h-3.5" />
        </button>
      </div>
      {editingTime && (
        <div className="px-2 pb-2">
          <TimeEditor
            band={band}
            value={item.start}
            onCommit={(time) => {
              setEditingTime(false);
              onTimeChange(entry, time);
            }}
            onCancel={() => setEditingTime(false)}
          />
        </div>
      )}
    </div>
  );
};

export const SchedulePlanner: React.FC = () => {
  const { dataStore } = usePluginHost();

  const today = todayStr();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const [weekAnchor, setWeekAnchor] = useState<string>(() => today);
  const weekStart = weekStartStr(weekAnchor);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)),
    [weekStart],
  );

  const [sel, setSel] = useState<CellSel>(() => ({
    date: today,
    band: TIME_BANDS.find((b) => nowMin >= b.startMin && nowMin < b.endMin) ?? TIME_BANDS[1],
  }));

  const [weekData, setWeekData] = useState<Record<string, DaySchedule>>({});
  const [loading, setLoading] = useState(true);
  const [quickTitle, setQuickTitle] = useState('');
  const [adding, setAdding] = useState(false);

  /** 刷新：拉取本周 7 天的面板数据 */
  const refresh = useCallback(async () => {
    setLoading(true);
    const days = await Promise.all(weekDays.map((d) => loadDaySchedule(dataStore, d)));
    const wd: Record<string, DaySchedule> = {};
    weekDays.forEach((d, i) => (wd[d] = days[i]));
    setWeekData(wd);
    setLoading(false);
  }, [dataStore, weekDays]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 全周统计
  const allItems = useMemo(() => {
    const list: Entry[] = [];
    for (const date of weekDays) {
      const dm = weekData[date];
      if (!dm) continue;
      for (const [id, item] of Object.entries(dm)) list.push({ id, item });
    }
    return list;
  }, [weekDays, weekData]);

  const completedCount = allItems.filter((x) => x.item.done).length;

  /** 选中格内的条目（按开始时间排序） */
  const selEntries = useMemo(() => {
    const dm = weekData[sel.date] ?? {};
    const out: Entry[] = [];
    for (const [id, item] of Object.entries(dm)) {
      const m = timeToMinutes(item.start);
      if (m != null && m >= sel.band.startMin && m < sel.band.endMin) out.push({ id, item });
    }
    return out.sort((a, b) => timeToMinutes(a.item.start)! - timeToMinutes(b.item.start)!);
  }, [sel, weekData]);

  const goToWeek = (offset: number) => {
    const newStart = addDaysStr(weekStart, offset * 7);
    const oldIndex = weekDays.indexOf(sel.date);
    const keepDate = addDaysStr(newStart, Math.max(0, oldIndex));
    setWeekAnchor(newStart);
    setSel((s) => ({ ...s, date: keepDate }));
  };

  const goToday = () => {
    setWeekAnchor(today);
    setSel((s) => ({ date: today, band: s.band }));
  };

  // ---------------- 操作（纯面板数据，不触碰任务 API） ----------------

  const quickCreate = useCallback(async () => {
    const title = quickTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      await putScheduleItem(dataStore, sel.date, makeId(), {
        title,
        start: sel.band.startLabel,
        end: sel.band.endLabel,
        done: false,
      });
      setQuickTitle('');
    } catch (err) {
      console.error('创建时段任务失败:', err);
    }
    setAdding(false);
    await refresh();
  }, [dataStore, quickTitle, refresh, sel.band, sel.date]);

  const toggleDone = useCallback(
    async (entry: Entry) => {
      try {
        await putScheduleItem(dataStore, sel.date, entry.id, { ...entry.item, done: !entry.item.done });
      } catch (err) {
        console.error('更新完成状态失败:', err);
      }
      await refresh();
    },
    [dataStore, refresh, sel.date],
  );

  const removeItem = useCallback(
    async (entry: Entry) => {
      try {
        await removeScheduleItem(dataStore, sel.date, entry.id);
      } catch (err) {
        console.error('删除时段任务失败:', err);
      }
      await refresh();
    },
    [dataStore, refresh, sel.date],
  );

  const changeTime = useCallback(
    async (entry: Entry, time: string) => {
      const m = timeToMinutes(time);
      if (m == null) return;
      const band = bandForMinutes(m);
      try {
        await putScheduleItem(dataStore, sel.date, entry.id, {
          ...entry.item,
          start: time,
          end: entry.item.end && timeToMinutes(entry.item.end)! > m ? entry.item.end : band.endLabel,
        });
      } catch (err) {
        console.error('修改时间失败:', err);
      }
      await refresh();
    },
    [dataStore, refresh, sel.date],
  );

  const renameItem = useCallback(
    async (entry: Entry, title: string) => {
      try {
        await putScheduleItem(dataStore, sel.date, entry.id, { ...entry.item, title });
      } catch (err) {
        console.error('改名失败:', err);
      }
      await refresh();
    },
    [dataStore, refresh, sel.date],
  );

  const cellCount = (date: string, band: TimeBand): number => {
    const dm = weekData[date];
    if (!dm) return 0;
    let n = 0;
    for (const item of Object.values(dm)) {
      const m = timeToMinutes(item.start);
      if (m != null && m >= band.startMin && m < band.endMin) n++;
    }
    return n;
  };

  const cellPreview = (date: string, band: TimeBand): { start: string; title: string; done: boolean } | null => {
    const dm = weekData[date];
    if (!dm) return null;
    const first = Object.entries(dm)
      .filter(([, item]) => {
        const m = timeToMinutes(item.start);
        return m != null && m >= band.startMin && m < band.endMin;
      })
      .sort((a, b) => timeToMinutes(a[1].start)! - timeToMinutes(b[1].start)!)[0];
    return first ? { start: first[1].start, title: first[1].title, done: !!first[1].done } : null;
  };

  const monthRange =
    weekDays[0].slice(0, 7) === weekDays[6].slice(0, 7)
      ? `${Number(weekDays[0].slice(5, 7))}月`
      : `${Number(weekDays[0].slice(5, 7))}月 – ${Number(weekDays[6].slice(5, 7))}月`;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        {/* ============ 左：一周网格 ============ */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              <button onClick={() => goToWeek(-1)} className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="上一周">
                <FaChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => goToWeek(1)} className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="下一周">
                <FaChevronRight className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 ml-1">{monthRange}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="tnum hidden items-center gap-1 text-[11px] text-ink-3 sm:flex">
                本周 {allItems.length} 项
                <span aria-hidden className="h-3 w-px bg-line" />
                完成 {completedCount}
              </span>
              <button onClick={goToday} className="btn btn-ghost btn-sm rounded-full">
                回到本周
              </button>
            </div>
          </div>

          <div className="overflow-x-auto pb-1">
            <div className="min-w-[840px]">
              {/* 表头 */}
              <div className="grid" style={{ gridTemplateColumns: '64px repeat(7, minmax(0,1fr))' }}>
                <div />
                {weekDays.map((date) => {
                  const isToday = date === today;
                  const hasSel = sel.date === date;
                  return (
                    <div key={date} className="px-1 pb-2 text-center">
                      <div className={`text-[11px] ${isToday ? 'text-primary-500 font-bold' : 'text-gray-400 dark:text-gray-500'}`}>
                        {DAY_LABEL(date)}
                      </div>
                      <div
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold ${
                          hasSel
                            ? 'bg-brand text-white'
                            : isToday
                              ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                              : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {Number(date.slice(8))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {TIME_BANDS.map((band) => (
                <div
                  key={band.id}
                  className="grid border-t border-line"
                  style={{ gridTemplateColumns: '64px repeat(7, minmax(0,1fr))' }}
                >
                  <div className="flex flex-col items-start justify-center pr-2">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{band.label}</span>
                    <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{band.startLabel}</span>
                  </div>
                  {weekDays.map((date) => {
                    const count = cellCount(date, band);
                    const active = sel.date === date && sel.band.id === band.id;
                    const isToday = date === today;
                    const preview = cellPreview(date, band);
                    return (
                      <button
                        key={`${date}:${band.id}:${active ? 'on' : 'off'}`}
                        onClick={() => setSel({ date, band })}
                        className={`group relative min-h-[62px] m-[1px] rounded-xl border transition-all duration-150 flex flex-col items-start justify-center px-2 py-1 text-left ${
                          active
                            ? 'cell-pop border-primary-500 dark:border-primary-400 bg-primary-50/70 dark:bg-blue-900/20 ring-2 ring-primary-500/60 dark:ring-primary-400/50 shadow-sm -translate-y-0.5'
                            : 'border-line bg-surface-2/50 hover:border-line-strong hover:bg-surface-2 hover:-translate-y-0.5'
                        } ${count === 0 && !isToday ? 'bg-gray-50/60 dark:bg-gray-800/40' : ''}`}
                        title={`${DAY_LABEL(date)} ${Number(date.slice(8))}日 · ${band.label}（点击安排）`}
                      >
                        {count > 0 && preview ? (
                          <>
                            <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                              {count} 项
                              {active && selEntries.some((e) => e.item.done) ? ' · ✓' : ''}
                            </span>
                            <span className={`w-full truncate text-xs ${preview.done ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                              {preview.start} {preview.title}
                            </span>
                          </>
                        ) : (
                          <FaPlus className="w-3 h-3 text-gray-200 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                        {isToday && count > 0 && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary-400" />
                        )}
                        {isToday && !active && (
                          <span className="absolute inset-x-0 bottom-0 h-[2px] bg-primary-400/70 rounded-b-xl" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
            提示：点空白方块选中「日期 × 时段」，再到右侧添加任务；拖动时间条自动吸附 0/5 结尾的分钟。
          </p>
        </div>

        {/* ============ 右：选中格详情 + 快速新建 ============ */}
        <div className="space-y-4 lg:sticky lg:top-6">
          <div
            key={`${sel.date}-${sel.band.id}`}
            className="panel-in bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-4"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {DAY_LABEL(sel.date)} {Number(sel.date.slice(8))}日 · {sel.band.label}
              </h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">{formatDateCn(sel.date)}</span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3 font-mono">
              {sel.band.startLabel}–{sel.band.endLabel} · 点时间可改 · 双击标题可改名
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <FaSpinner className="w-5 h-5 animate-spin mr-2" />
                加载中…
              </div>
            ) : (
              <>
                {selEntries.length > 0 ? (
                  <div className="space-y-1.5 mb-3">
                    {selEntries.map((entry) => (
                      <ScheduleRow
                        key={entry.id}
                        entry={entry}
                        band={sel.band}
                        onToggleDone={toggleDone}
                        onRemove={removeItem}
                        onTimeChange={changeTime}
                        onRename={renameItem}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-5 text-gray-300 dark:text-gray-600 text-sm border border-dashed border-gray-200 dark:border-gray-700 rounded-lg mb-3">
                    该格暂无任务
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void quickCreate();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    placeholder={`在 ${DAY_LABEL(sel.date)}·${sel.band.label} 添加…`}
                    className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="submit"
                    disabled={adding || !quickTitle.trim()}
                    className="px-3 py-2 text-sm rounded-lg bg-brand text-white hover:opacity-85 disabled:opacity-40 flex items-center"
                  >
                    {adding ? <FaSpinner className="w-3.5 h-3.5 animate-spin" /> : <FaPlus className="w-3.5 h-3.5" />}
                  </button>
                </form>
              </>
            )}
          </div>

          <details className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-ink-3 transition-colors hover:text-ink">
              数据说明
            </summary>
            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-3">
              <li>本面板与「任务列表」互相独立，互不读写。</li>
              <li>删除、完成、改名只影响面板自身。</li>
              <li>数据双写：桌面端存本地数据库，浏览器开发环境存 localStorage。</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
};
