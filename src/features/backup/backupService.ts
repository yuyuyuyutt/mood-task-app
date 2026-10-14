// src/features/backup/backupService.ts
// 本地数据备份 / 恢复。
// 数据分散在四处，本模块负责把它们聚合成**一个 JSON 文件**：
//   1) SQLite `tasks` 表          —— api.getTasks / api.createTask
//   2) 插件命名空间 `plugin_data` —— PluginDataStore.dumpAll / restoreRows
//      （含心情、调度面板 `__schedule`、**学习工作区 `__study`**：会话 / 笔记 / 资源进度 / 辅导记录）
//   3) IndexedDB `mood-task-planner` —— kv / plans / resources / memory（Agent 记忆）
//   4) AppData `user_profile.json` —— 仅 Tauri 环境
// 说明：头像图片文件不纳入备份（体积大且可重新上传），恢复时保留本机现有头像；
//      正文临时缓存（contentCache）同样不备份 —— 它是可重新抓取的派生数据。
import { api } from '../../api';
import { STUDY_NS } from '../../api/studyStore';
import type { PluginDataDumpRow } from '../../plugins/runtime/dataStore';
import type { Task } from '../../types';
import { loadAppSettings, saveAppSettings, type AppSettings } from '../../utils/appSettings';
import { isTauriRuntime } from '../../utils/runtime';
import {
  dumpMemoryNotes,
  getAllKv,
  getAllManualResources,
  getAllPlans,
  kvSet,
  putManualResource,
  putPlan,
  restoreMemoryNotes,
} from '../plan-generator/db/plannerDB';

export const BACKUP_FORMAT = 'mood-task-backup';
export const BACKUP_VERSION = 1;

const PROFILE_FILE = 'user_profile.json';

export interface UserProfileBackup {
  name: string;
  /** 仅作记录：头像文件本身不在备份内 */
  avatarFilename: string | null;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  data: {
    tasks: Task[];
    pluginData: PluginDataDumpRow[];
    appSettings: AppSettings;
    userProfile: UserProfileBackup | null;
    planner: {
      kv: Array<{ key: string; value: unknown }>;
      plans: unknown[];
      resources: unknown[];
      /** Agent 记忆条目（v3 新增；旧备份里没有这个字段，恢复时按空数组处理） */
      memory: unknown[];
    };
  };
}

/** 由调用方（设置页）注入插件数据存储，避免本模块依赖 React 上下文 */
export interface BackupHost {
  dumpPluginData: () => Promise<PluginDataDumpRow[]>;
  restorePluginData: (rows: PluginDataDumpRow[]) => Promise<number>;
}

export interface RestoreReport {
  tasksAdded: number;
  tasksSkipped: number;
  pluginRows: number;
  plannerKv: number;
  plannerPlans: number;
  plannerResources: number;
  plannerMemory: number;
  /** 学习工作区的行数（会话 / 笔记 / 资源进度 / 辅导记录） */
  studyRows: number;
  appSettingsRestored: boolean;
  userProfileRestored: boolean;
}

/**
 * 备份里属于学习工作区的行数。
 *
 * 为什么只是"数一数"而不是单独导出：学习工作区落在宿主保留命名空间 `__study`，
 * 而 `dumpAll()` 是**按命名空间全量导出**的，所以它天然已经在 `pluginData` 里了。
 * 单独计数是为了让用户在界面上能核对"我的会话与笔记确实备进去了"，
 * 而不是只能相信文档 —— 备份这种功能，"看得见"比"写在说明书里"重要。
 */
export function countStudyRows(rows: readonly PluginDataDumpRow[] | undefined): number {
  return (rows ?? []).filter((row) => row.namespace === STUDY_NS).length;
}

async function readUserProfile(): Promise<UserProfileBackup | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs');
    if (!(await exists(PROFILE_FILE, { baseDir: BaseDirectory.AppData }))) return null;
    const raw = await readTextFile(PROFILE_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as { name?: string; avatarFilename?: string | null };
    return { name: parsed.name ?? '', avatarFilename: parsed.avatarFilename ?? null };
  } catch (err) {
    console.warn('[backup] 读取用户画像失败:', err);
    return null;
  }
}

/** 恢复用户画像：只写回昵称，保留本机已有头像，避免指向一个不存在的文件 */
async function writeUserProfileName(name: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { BaseDirectory, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const current = await readUserProfile();
    await writeTextFile(
      PROFILE_FILE,
      JSON.stringify({ name, avatarFilename: current?.avatarFilename ?? null }, null, 2),
      { baseDir: BaseDirectory.AppData },
    );
    return true;
  } catch (err) {
    console.warn('[backup] 写入用户画像失败:', err);
    return false;
  }
}

/** 汇总当前全部本地数据 */
export async function createBackup(host: BackupHost): Promise<BackupFile> {
  const [tasks, pluginData, kv, plans, resources, memory, userProfile] = await Promise.all([
    api.getTasks(),
    host.dumpPluginData().catch((err) => {
      console.warn('[backup] 导出插件数据失败:', err);
      return [] as PluginDataDumpRow[];
    }),
    getAllKv().catch(() => [] as Array<{ key: string; value: unknown }>),
    getAllPlans().catch(() => [] as unknown[]),
    getAllManualResources().catch(() => [] as unknown[]),
    dumpMemoryNotes().catch(() => [] as unknown[]),
    readUserProfile(),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      tasks,
      pluginData,
      appSettings: loadAppSettings(),
      userProfile,
      planner: { kv, plans, resources, memory },
    },
  };
}

/** 校验并解析备份文本 */
export function parseBackup(text: string): { ok: true; backup: BackupFile } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是合法的 JSON' };
  }
  const backup = parsed as Partial<BackupFile>;
  if (!backup || typeof backup !== 'object' || backup.format !== BACKUP_FORMAT) {
    return { ok: false, error: '这不是本应用的备份文件' };
  }
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    return { ok: false, error: `备份版本 ${String(backup.version)} 高于当前支持的 ${BACKUP_VERSION}` };
  }
  if (!backup.data || typeof backup.data !== 'object') {
    return { ok: false, error: '备份内容为空' };
  }
  return { ok: true, backup: backup as BackupFile };
}

/**
 * 恢复备份。策略（全部为"合并/覆盖"而非清库重建，避免误操作导致不可逆丢失）：
 * - 任务：按 `标题 + 创建时间` 去重，只追加缺失的；
 * - 插件命名空间数据：同 namespace/collection/key 覆盖；
 * - IndexedDB：kv 覆盖、plans/resources/memory 按 id 覆盖；
 * - 应用设置：字段级合并（备份里有值才覆盖）。
 */
export async function restoreBackup(backup: BackupFile, host: BackupHost): Promise<RestoreReport> {
  const report: RestoreReport = {
    tasksAdded: 0,
    tasksSkipped: 0,
    pluginRows: 0,
    plannerKv: 0,
    plannerPlans: 0,
    plannerResources: 0,
    plannerMemory: 0,
    studyRows: 0,
    appSettingsRestored: false,
    userProfileRestored: false,
  };

  const existing = await api.getTasks();
  const seen = new Set(existing.map((t) => `${t.title}@${t.created_at}`));
  for (const task of backup.data.tasks ?? []) {
    const signature = `${task.title}@${task.created_at}`;
    if (seen.has(signature)) {
      report.tasksSkipped += 1;
      continue;
    }
    const { id: _id, created_at: _createdAt, ...payload } = task;
    await api.createTask(payload);
    seen.add(signature);
    report.tasksAdded += 1;
  }

  report.pluginRows = await host.restorePluginData(backup.data.pluginData ?? []);
  // 学习工作区的数据就在 pluginData 里，这里单独点清条数（用户能核对"笔记真的回来了"）
  report.studyRows = countStudyRows(backup.data.pluginData);

  for (const row of backup.data.planner?.kv ?? []) {
    await kvSet(row.key, row.value);
    report.plannerKv += 1;
  }
  for (const plan of backup.data.planner?.plans ?? []) {
    await putPlan(plan as Parameters<typeof putPlan>[0]);
    report.plannerPlans += 1;
  }
  for (const resource of backup.data.planner?.resources ?? []) {
    await putManualResource(resource as Parameters<typeof putManualResource>[0]);
    report.plannerResources += 1;
  }
  // 记忆：按 id 覆盖（旧版备份没有 memory 字段时自然跳过）
  report.plannerMemory = await restoreMemoryNotes(
    (backup.data.planner?.memory ?? []) as Parameters<typeof restoreMemoryNotes>[0],
  );

  if (backup.data.appSettings) {
    saveAppSettings({ ...loadAppSettings(), ...backup.data.appSettings });
    report.appSettingsRestored = true;
  }
  if (backup.data.userProfile) {
    report.userProfileRestored = await writeUserProfileName(backup.data.userProfile.name);
  }

  return report;
}

/** 备份文件名：mood-task-backup-YYYY-MM-DD.json */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `mood-task-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
