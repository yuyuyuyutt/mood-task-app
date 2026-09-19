# 数据模型与持久化

本应用有 **4 处持久化介质**，分布在 3 个不同的技术栈里。改数据相关代码前，先在这张表里
找到你关心的那一层。

## 0. 全景

| # | 介质 | 位置 | 管理者 | 存什么 | 浏览器开发模式下 |
|---|---|---|---|---|---|
| 1 | **SQLite** | `app_local_data_dir/data.db` | `src/api/*.ts` → Rust 命令 | 任务、心情、插件命名空间数据、时段面板 | ❌ 不可用 |
| 2 | **AppData 文件** | `AppData/plugins/installed.json`、`user_profile.json`、`avatars/*.jpg` | `plugins/runtime/storage.ts`、`hooks/useUserProfileTauri.ts` | 插件注册表、用户资料与头像 | ❌ 不可用（有降级/兜底） |
| 3 | **localStorage** | 见 §4 | 插件宿主的同步镜像 + 数据降级通道 | 插件注册表镜像、主题偏好、插件数据、墓碑 | ✅ **主存储** |
| 4 | **IndexedDB** | 库 `mood-task-planner` | `features/plan-generator/db/plannerDB.ts` | 习惯画像、计划、资源库、LLM 配置 | ✅ 完全一致 |

环境判定统一用 `'__TAURI_INTERNALS__' in window`（`storage.ts`、`dataStore.ts`、`taskMaterializer.ts`）。

> **Windows 上的实际路径**（应用标识符 `com.moodtask.app`）：
> - SQLite：`%LOCALAPPDATA%\com.moodtask.app\data.db`（`app_local_data_dir`）
> - AppData 文件：`%APPDATA%\com.moodtask.app\...`（`BaseDirectory.AppData`，即 roaming）
>
> 注意这两个目录**不是同一个**。SQLite 在 Local，plugin-fs 写在 Roaming。

---

## 1. SQLite（`src-tauri/src/database.rs`）

连接池：`r2d2` + `r2d2_sqlite`，`rusqlite` 使用 `bundled` 特性（自带 SQLite，无需系统安装）。
建表在 `init_tables()`（全部 `CREATE TABLE IF NOT EXISTS`），随后由 `migrate()` 按
`PRAGMA user_version` **顺序执行增量迁移**——加字段请见 §5，**不再需要删库重建**。

### 表 `tasks`

| 列 | 类型 | 约束 | 对应 TS 字段 |
|---|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT | `id: number` |
| `title` | TEXT | NOT NULL | `title: string` |
| `description` | TEXT | | `description?: string` |
| `status` | TEXT | DEFAULT `'pending'`，CHECK ∈ pending/in_progress/completed | `status` |
| `priority` | INTEGER | DEFAULT 2，CHECK 1–3 | `priority: 1 \| 2 \| 3` |
| `energy_cost` | INTEGER | CHECK 1–10 | `energy_cost?: number` |
| `estimated_time` | INTEGER | 分钟 | `estimated_time?: number` |
| `actual_time` | INTEGER | 分钟 | `actual_time?: number` |
| `due_date` | TEXT | `YYYY-MM-DD` | `due_date?: string` |
| `completed_at` | TEXT | | `completed_at?: string` |
| `tags` | TEXT | **JSON 数组字符串** | `tags?: string[]` |
| `created_at` | TEXT | DEFAULT `CURRENT_TIMESTAMP` | `created_at: string` |
| `is_habit` | BOOLEAN | DEFAULT 0 | `is_habit?: boolean` |
| `habit_period` | TEXT | CHECK ∈ daily/weekdays/weekends/custom | `habit_period?: HabitPeriod` |
| `habit_completions` | TEXT | **JSON 数组字符串** | `habit_completions?: HabitCompletion[]` |
| `habit_start_date` | TEXT | | `habit_start_date?: string` |
| `habit_end_date` | TEXT | | `habit_end_date?: string` |
| `updated_at` | TEXT | 由 `patch_task` 写 `datetime('now')` | 不在 TS 类型里（仅用于排查/排查式比对） |

索引：`idx_tasks_status(status)`、`idx_tasks_is_habit(is_habit)`。

> `updated_at` 是通过迁移引入的：新库由 `CREATE TABLE` 直接建出，旧库由 v1 迁移补列（见 §5）。

**`habit_completions` 的元素结构**（`src/types/index.ts` ←→ `src-tauri/.../HabitCompletion`）：

```json
[{ "date": "2026-09-14", "completed_at": "2026-09-14T10:00:00+08:00", "status": "completed", "note": null }]
```

写入由前端完成：`TaskList` 读出 `habit_completions` → 按 `date` 找已有项 → 替换或追加 →
整体通过 `api.updateTask(id, { habit_completions })` 提交（Rust 侧只是 JSON 字符串的搬运工）。
**同一天重复打卡是"覆盖"而不是"追加"**。

### 表 `moods`（⛔ 已废弃，只读一次）

**不要再往这张表写数据，也不要再读它。** 心情数据的唯一真源是
`plugin_data(namespace='mood', collection='entries')`（见 §3）。

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | INTEGER | PK AUTOINCREMENT |
| `date` | TEXT | **NOT NULL UNIQUE** ← 决定"一天一条" |
| `mood_score` | INTEGER | NOT NULL，CHECK 1–5 |
| `mood_emoji` | TEXT | NOT NULL |
| `content` | TEXT | NOT NULL |
| `tags` | TEXT | JSON 数组字符串 |
| `created_at` | TEXT | DEFAULT `CURRENT_TIMESTAMP` |

它的**唯一用途**是 `MIGRATIONS` 的 v2 条目：老库里的历史心情会被一次性搬进 `plugin_data`
（`INSERT OR IGNORE`，不覆盖新数据；值结构与 `plugins/pages/moodData.ts` 的 `MoodEntryValue` 对齐）。
搬迁后这张表保持原样不动，确认无回滚需要时可整体删除。

### 表 `plugin_data`（插件与时段面板共用）

| 列 | 类型 | 说明 |
|---|---|---|
| `namespace` | TEXT | 隔离域；插件用自己的命名空间，宿主用 `__schedule` |
| `collection` | TEXT | 集合名；时段面板把**日期**当 collection |
| `key` | TEXT | 记录键 |
| `value` | TEXT | JSON 字符串 |
| `updated_at` | TEXT | DEFAULT `CURRENT_TIMESTAMP`，UPSERT 时刷新 |

主键：`(namespace, collection, key)`。

---

## 2. IndexedDB — 计划生成器（`features/plan-generator/db/plannerDB.ts`）

数据库名 `mood-task-planner`，**版本 2**。三个 object store：

| store | keyPath | 存什么 |
|---|---|---|
| `kv` | `key` | 单值配置（见下表） |
| `plans` | `id` | 生成过的计划（历史记录） |
| `resources` | 自增/自定义 | 用户手动添加的资源库条目 |

`kv` 里的键常量（`plannerDB.ts` 导出，**改名会丢用户数据**）：

| 常量 | 值 | 用途 | 读写方 |
|---|---|---|---|
| `KV_PROFILE` | `habitProfile` | 习惯画像 | `hooks/useHabitProfile.ts` |
| `KV_LLM_CONFIG` | `llmConfig` | Ollama 地址 / 模型 / 超时 | `PlanGeneratorWorkspace.tsx` 直接读写 |
| `KV_PLAN_PREFS` | `planPrefs` | 计划偏好 | `hooks/usePlans.ts` / 向导 |
| `KV_NETWORKING` | `networkingSettings` | 三层检索开关与参数 | `hooks/useNetworkingSettings.ts` |
| `KV_RESOURCE_CLICKS` | `resourceClicks` | 资源点击统计（用于偏好打分） | `PlanGeneratorWorkspace.tsx` |

对外 API：`kvGet/kvSet/kvDelete`、`putPlan/getAllPlans/deletePlan/clearAllPlans`、
`putManualResource/getAllManualResources/deleteManualResource`。

> 升级 store 结构时必须递增版本号，并在 `onupgradeneeded` 里处理旧数据。

---

## 3. 插件命名空间数据（`PluginDataStore`）

**同一套 API，两种后端**：

| 环境 | 后端 |
|---|---|
| Tauri | `invoke('plugin_data_*')` → SQLite 表 `plugin_data` |
| 浏览器 | `localStorage`，键格式见 §4 |

API 签名都以 **identity（身份）** 打头：

```ts
list(identity, namespace, collection) : Promise<DataRecord[]>
get(identity, namespace, collection, key) : Promise<unknown>
put(identity, namespace, collection, key, value) : Promise<void>
remove(identity, namespace, collection, key) : Promise<void>
clear(identity, namespace, collection) : Promise<void>
clearNamespace(namespace) : Promise<void>   // 仅供保留期到期/回收站
bind(pluginId) : PluginDataAccess           // 页面组件用，权限每次调用实时校验
dumpAll() : Promise<PluginDataDumpRow[]>    // 备份用：扁平导出全部命名空间（Tauri 走 plugin_data_dump，浏览器扫 localStorage）
restoreRows(rows) : Promise<number>         // 备份恢复：core 身份逐行 upsert，返回写入条数
```

**权限门（`authorize()`，在 store 内部强制）**：

1. `identity === 'core'` → 完全放行（宿主的身份，如时段面板、统计页）。
2. 否则查注册表拿到该插件清单；**未声明 `capabilities.data`** → 抛错。
3. `cap.namespace !== namespace` → 抛错（不能跨插件读写）。
4. 操作不在 `cap.operations` 白名单 → 抛错（默认只有 `read`）。
5. 集合不在 `cap.collections` → 抛错。

**已知的三处数据访问者**：

| 访问者 | identity | namespace | collection | 说明 |
|---|---|---|---|---|
| 心情日记页 `plugins/pages/MoodDiaryPage.tsx` | `mood-diary` | `mood` | `entries` | 以插件身份走完整权限校验 |
| 统计页 `pages/Statistics.tsx` | `core` | `mood` | `entries` | 以宿主身份读同一份数据，**仅当 `mood-diary` 插件启用时**读取 |
| 时段面板 `api/scheduleStore.ts` | `core` | `__schedule` | 日期字符串 | 命名空间带 `__` 前缀，插件无法声明（校验器拒绝） |

> 因此：**卸载 `mood-diary` 插件会让统计页的心情区块变空**，这不是 bug，是插件化的预期行为。

**保留期（墓碑）**：卸载带 `data` 能力的插件时写入墓碑，数据不动；保留期内重装自动恢复；
到期（默认 3 天，最长 90 天）或用户在回收站点"立即清除"时按 namespace 删除。
宿主每 6 小时跑一次 `purgeExpired()`。

---

## 4. localStorage 键清单

| 键 | 常量定义处 | 内容 |
|---|---|---|
| `mood-task:plugins:v1` | `plugins/runtime/types.ts` `STORAGE_KEY` | 插件注册表**同步镜像**（JSON：`{version:1, plugins:[{manifest, enabled, installedAt, source}]}`） |
| `mood-task:theme:preference` | `THEME_PREF_KEY` | `'light'` \| `'dark'`，记录最近一次主题模式 |
| `mood-task:plugin-data:v1:<ns>:<collection>:<key>` | `runtime/dataStore.ts` `DATA_PREFIX` | 浏览器模式下的插件数据（含时段面板） |
| `mood-task:plugin-tombstones:v1` | `runtime/dataStore.ts` `TOMBSTONE_KEY` | 墓碑表 `Record<pluginId, Tombstone>` |
| `mood-task:app-settings:v1` | `utils/appSettings.ts` `STORAGE_KEY` | 应用偏好（通知开关、提醒时间、语言），**已纳入备份** |

**清空这些键 = 重置插件状态**（`mood-task:plugins:v1` 删掉后，下次启动只保留内置插件待安装状态）。
插件注册表在两个环境都写 localStorage，Tauri 下额外写 AppData 文件，**文件是真源**，
读到文件后会回写镜像。

---

## 5. 常见维护任务

### 给任务表加一个字段

必须同步改 **6 处**，漏一处就出现"前端有、后端丢"或"类型对不上"：

1. `src-tauri/src/database.rs` → `CREATE TABLE IF NOT EXISTS tasks` 加列（新库）
2. `src-tauri/src/database.rs` → `MIGRATIONS` **末尾追加**一条 `ALTER TABLE ... ADD COLUMN`（旧库）。
   只允许追加、不要改历史条目；若新库建表已含该列，加 `guard: Some(("tasks", "列名"))`
3. `src-tauri/src/database.rs` → `struct Task` + `impl Task::from_row`（**列顺序必须与 SELECT 一致，新列加在末尾**）
4. `src-tauri/src/database.rs` → `struct CreateTask`（若需要在创建时写入）
5. `src-tauri/src/commands.rs` → `create_task` 的 INSERT 语句与 `params!`；
   若该列支持增量修改，还要加进 `PATCHABLE_COLUMNS`（`patch_task` 的白名单）
6. `src/types/index.ts` → `interface Task`，以及 `src/api/index.ts` 的 `toTask` / `toCreatePayload` 映射
   （数组类字段务必在边界 parse/stringify）

**已有库文件的迁移**：`init_tables` 只建表不迁移。开发期最简单的做法是删掉
`%LOCALAPPDATA%\com.moodtask.app\data.db` 让程序重建（**会丢数据**）；要保数据请手写
`ALTER TABLE tasks ADD COLUMN ...`（SQLite 对已存在列没有 `IF NOT EXISTS`，需先查 `PRAGMA table_info(tasks)`）。

### JSON 字段为什么来回转字符串

SQLite 没有数组类型，所以 `tags` / `habit_completions` 以 JSON 字符串落库。
**转换发生在 `src/api/index.ts` 的边界上**：读时 `JSON.parse`（失败退化为 `[]`，不抛错），
写时 `JSON.stringify`，传 `null` 表示"无值"。**Rust 侧完全不解析 JSON**，只把字符串搬进搬出
（`patch_task` 同样如此）——解析逻辑只有一处，不会出现"后端也在改 JSON"的双头维护。

> 新增 JSON 字段时，务必在 `getTasks` 映射里补齐 `JSON.parse`，否则组件拿到的是字符串。

### 导出/备份用户数据

目前**没有**导出功能。要手工备份，需要同时复制：
`%LOCALAPPDATA%\com.moodtask.app\data.db`（任务/心情/插件数据）、
`%APPDATA%\com.moodtask.app\`（插件注册表、用户资料、头像）、
以及浏览器 profile 里的 IndexedDB（计划生成器）。这是本项目的明显短板，已记入 docs/TODO.md。
