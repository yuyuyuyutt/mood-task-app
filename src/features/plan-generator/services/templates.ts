// src/features/plan-generator/services/templates.ts
// 目标模板与用户类型时段预设：纯本地规则，确定性输出（无随机数）。
import type {
  Availability,
  GoalCategory,
  PlanEvent,
  PlanTask,
  UserType,
} from '../types';

// ---------------- 类别识别 ----------------

const KEYWORD_RULES: Array<{ category: GoalCategory; keywords: string[] }> = [
  {
    category: '健身',
    keywords: [
      '健身', '锻炼', '跑步', '慢跑', '瑜伽', '运动', '俯卧撑', '深蹲', '哑铃',
      '跳绳', '游泳', '骑行', 'hiit', '减脂', '增肌', '减肥', '体能', '拉伸',
    ],
  },
  {
    category: '工作',
    keywords: [
      '工作', '项目', '报告', '文档', '方案', '会议', '汇报', 'ppt', '演示',
      '客户', '交付', '需求', '上线', '办公', '代码评审', '简历',
    ],
  },
  {
    category: '学习',
    keywords: [
      '学习', '学', '读', '书', '课', '考试', '备考', '背', '单词', '语法',
      '英语', '日语', '韩语', '外语', '语言', 'python', 'java', 'rust',
      'go', 'js', '编程', '代码', '算法', '数学', '物理', '化学', '历史',
      '证书', '教程', '网课', '练习', '刷题',
    ],
  },
  {
    category: '创作',
    keywords: [
      '写作', '写', '创作', '画', '插画', '设计', '视频', '剪辑', '音乐',
      '谱曲', '公众号', '博客', '小说', '剧本', '摄影', 'vlog',
    ],
  },
];

export function detectGoalCategory(goal: string): GoalCategory {
  const g = goal.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((k) => g.includes(k))) return rule.category;
  }
  return '通用';
}

/** 各类别默认每日投入（分钟） */
export const CATEGORY_MINUTES: Record<GoalCategory, number> = {
  学习: 90,
  健身: 45,
  工作: 120,
  创作: 90,
  通用: 60,
};

// ---------------- 用户类型时段预设（用于安排任务/事件的"最佳时段"） ----------------

export interface TimeBlock {
  start: number; // 自 00:00 起的分钟数
  end: number;
}

/**
 * 各用户类型建议投入的时段（相对一个可用的"日窗口"）。分钟制，
 * 由 planGenerator 与可用时段取交集后使用。
 */
export function preferredBlocks(userType: UserType, avail: Availability): TimeBlock[] {
  const aStart = toMinutes(avail.start);
  const aEnd = toMinutes(avail.end);
  if (!Number.isFinite(aStart) || !Number.isFinite(aEnd) || aEnd <= aStart) {
    return [{ start: 8 * 60, end: 22 * 60 }];
  }
  const clamp = (s: number, e: number): TimeBlock | null => {
    const ns = Math.max(s, aStart);
    const ne = Math.min(e, aEnd);
    return ne - ns >= 25 ? { start: ns, end: ne } : null;
  };
  const m = 60;
  switch (userType) {
    case 'morning_person':
      // 重要任务安排在 8:00–10:00（回退到窗口起点）
      return [clamp(8 * m, 10 * m) ?? { start: aStart, end: Math.min(aStart + 2 * m, aEnd) }];
    case 'night_owl':
      // 20:00–22:00（若窗口太早结束则用窗口末尾 2 小时）
      return [clamp(20 * m, 22 * m) ?? { start: Math.max(aEnd - 2 * m, aStart), end: aEnd }];
    case 'fragmented':
      // 整个窗口内均匀切分（小块）
      return [clamp(aStart, aEnd) ?? { start: aStart, end: aEnd }];
    case 'long_focus':
      // 两个 90–120 分钟长块
      return [
        clamp(aStart, aStart + 2 * m) ?? { start: aStart, end: Math.min(aStart + 2 * m, aEnd) },
        clamp(aStart + 3 * m, Math.min(aStart + 5 * m, aEnd)) ?? {
          start: Math.max(aStart, aEnd - 2 * m),
          end: aEnd,
        },
      ];
    default:
      // balanced / regular / weekend_worker：上下午两段
      return [
        clamp(9 * m, 11 * m) ?? { start: aStart, end: Math.min(aStart + 2 * m, aEnd) },
        clamp(14 * m, 17 * m) ?? { start: Math.max(aStart, aEnd - 3 * m), end: aEnd },
      ];
  }
}

/** 各用户类型的显示元信息（UI 配色与文案） */
export const USER_TYPE_META: Record<
  UserType,
  { label: string; description: string; color: string; badge: string; dot: string }
> = {
  morning_person: {
    label: '晨型高效',
    description: '清晨 6–10 点完成最多任务，适合把重要工作放在上午',
    color: '#f59e0b',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  night_owl: {
    label: '夜猫子',
    description: '晚间 20–24 点是高产出时段，早上状态相对低迷',
    color: '#8b5cf6',
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  fragmented: {
    label: '碎片时间利用者',
    description: '习惯 30 分钟内的短任务，建议拆成小块穿插全天',
    color: '#06b6d4',
    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    dot: 'bg-cyan-500',
  },
  long_focus: {
    label: '长块专注者',
    description: '单次专注超过 90 分钟，建议安排连续时间块',
    color: '#3b82f6',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  weekend_worker: {
    label: '周末工作者',
    description: '周末产出与工作日相当，不必把计划塞满工作周',
    color: '#10b981',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  regular: {
    label: '规律执行者',
    description: '完成率高、固定时段产出稳定，计划可适度加量',
    color: '#ef4444',
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  balanced: {
    label: '均衡型',
    description: '时段分布均匀，采用通用日程安排',
    color: '#6b7280',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    dot: 'bg-gray-500',
  },
};

// ---------------- 时间工具 ----------------

export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? h * 60 + min : NaN;
}

export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function clampMinutes(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ---------------- 单日任务/事件构建 ----------------

function splitChunks(total: number, maxChunk: number): number[] {
  if (total <= 0) return [];
  const n = Math.max(1, Math.ceil(total / maxChunk));
  const base = Math.floor(total / n);
  const chunks: number[] = [];
  let left = total;
  for (let i = 0; i < n; i++) {
    const size = i < total % n ? base + 1 : base;
    chunks.push(left > 0 ? Math.min(size, left) : 0);
    left -= size;
  }
  return chunks.filter((c) => c > 0);
}

const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

export function dayLabel(dayIndex: number, days: number): string {
  return `第${dayIndex + 1}/${days}天（周${DAY_NAMES[(new Date().getDay() + dayIndex) % 7]}）`;
}

/** 拆分策略：根据用户类型/风格把总分钟拆成若干小任务分钟 */
function chunkStyle(
  userType: UserType,
  style: 'auto' | 'fragmented' | 'long_focus',
): { maxChunk: number; eventCount: number } {
  if (style === 'fragmented' || userType === 'fragmented') return { maxChunk: 30, eventCount: 4 };
  if (style === 'long_focus' || userType === 'long_focus') return { maxChunk: 120, eventCount: 2 };
  if (userType === 'morning_person') return { maxChunk: 45, eventCount: 3 };
  if (userType === 'night_owl') return { maxChunk: 45, eventCount: 3 };
  return { maxChunk: 60, eventCount: 3 };
}

const TASK_PHRASES: Record<GoalCategory, string[]> = {
  学习: ['回顾上次要点', '学习新内容', '练习与自测', '整理笔记'],
  健身: ['热身与激活', '主训练动作', '放松拉伸'],
  工作: ['梳理今日目标', '推进核心工作', '收尾与明日准备'],
  创作: ['素材与灵感收集', '专注创作', '回顾打磨'],
  通用: ['准备与规划', '执行核心事项', '复盘记录'],
};

export function buildDayTasks(opts: {
  goal: string;
  category: GoalCategory;
  dayIndex: number;
  totalDays: number;
  userType: UserType;
  style: 'auto' | 'fragmented' | 'long_focus';
  minutesPerDay: number;
  blocks: TimeBlock[];
}): PlanTask[] {
  const { category, dayIndex, totalDays, minutesPerDay, blocks } = opts;
  const cfg = chunkStyle(opts.userType, opts.style);
  const chunks = splitChunks(minutesPerDay, cfg.maxChunk);
  const phrases = TASK_PHRASES[category];
  const block = blocks[0] ?? { start: 8 * 60, end: 22 * 60 };
  const bestTime = `${toHHMM(block.start)}-${toHHMM(block.end)}`;

  // 第 1 天引入目标本身；中间穿插"复习/总结"，避免每日完全相同
  return chunks.map((minutes, i) => {
    const phrase = phrases[i % phrases.length];
    let title: string;
    if (i === 0) {
      title = `开始：${opts.goal} · ${phrase}`;
    } else if (i === chunks.length - 1 && dayIndex === totalDays - 1) {
      title = `收官总结：${phrase}（目标收尾）`;
    } else if (i === 1) {
      title = `${phrase}（第 ${dayIndex + 1} 天进度）`;
    } else {
      title = phrase;
    }
    return {
      title: title.slice(0, 60),
      category,
      estimatedMinutes: minutes,
      bestTime,
    };
  });
}

export function buildDayEvents(opts: {
  goal: string;
  category: GoalCategory;
  dayIndex: number;
  userType: UserType;
  style: 'auto' | 'fragmented' | 'long_focus';
  minutesPerDay: number;
  blocks: TimeBlock[];
}): PlanEvent[] {
  const { category, minutesPerDay, blocks } = opts;
  const cfg = chunkStyle(opts.userType, opts.style);
  const chunks = splitChunks(minutesPerDay, cfg.maxChunk);
  const phrases = TASK_PHRASES[category];
  const availBlock = blocks[0] ?? { start: 8 * 60, end: 22 * 60 };
  const span = Math.max(availBlock.end - availBlock.start, minutesPerDay);
  const events: PlanEvent[] = [];
  let cursor = availBlock.start;

  chunks.forEach((minutes, i) => {
    const slotLen = Math.max(minutes, Math.floor(span / Math.max(chunks.length, 1)));
    const start = Math.min(cursor, availBlock.end - minutes);
    const end = start + minutes;
    events.push({
      title: `${opts.goal.slice(0, 40)} · ${phrases[i % phrases.length]}`,
      category,
      startTime: toHHMM(start),
      endTime: toHHMM(end),
    });
    cursor = Math.min(end + Math.max(20, slotLen - minutes), availBlock.end);
  });

  return events;
}
