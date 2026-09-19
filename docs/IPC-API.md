# 前后端契约（Tauri 命令 + 前端 API 层）

前端通过 `@tauri-apps/api/core` 的 `invoke(name, args)` 调用 Rust。

> **命令注册在 `src-tauri/src/lib.rs` 的 `invoke_handler` 里**，实现全部在 `src-tauri/src/commands.rs`。
> 桌面端 `src-tauri/src/main.rs` 只是 `mood_task_app::run()` 的薄封装——**桌面与移动端共用同一份注册**。

## 1. 命名与参数规则（最容易踩的地方）

| 规则 | 说明 |
|---|---|
| 命令名 | Rust 用 `snake_case`（`get_tasks`），前端字符串**原样照抄**，不要转 camelCase |
| 参数名 | Rust 侧 `snake_case` 参数，**前端用 camelCase 传**：`task_id` ← `{ taskId }`。Tauri 默认做这个映射。单词参数（`id`/`date`/`status`/`key`/`value`）两端同名 |
| 结构化参数 | Rust 接收 `struct`（如 `task: CreateTask`）时，前端传一个**普通对象**，字段名与 struct 字段一致（`snake_case`） |
| `serde_json::Value` 参数 | 原样透传对象（`patch_task` 用），**键名由后端白名单决定**，不做大小写转换 |
| 返回 | 直接返回 `Result<T, String>`；**错误是字符串**，前端用 try/catch 拿 `error` |
| 空值 | Rust 用 `Option<T>`，前端传 `null`（不要传 `undefined`，序列化后行为不一致） |

> `#[tauri::command]` 的**参数名就是协议的一部分**。重命名 Rust 参数或前端传的键名，
> 会得到运行时错误 "invalid args"，且 `tsc` 帮不了你——请同时更新本文档。

## 2. 命令清单（当前 11 个）

### 任务

| 命令 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `get_tasks` | — | `Task[]` | `SELECT * FROM tasks ORDER BY created_at DESC` |
| `create_task` | `task: CreateTask` | `Task` | INSERT 后回查新行返回完整对象；`completed_at` 由前端传入 |
| `patch_task` | `id: i64`, `patch: object` | `Task` | **增量更新**，只写 `patch` 里出现的字段；`null` = 置空该列；自动刷新 `updated_at` |
| `delete_task` | `id: i64` | `usize` | 物理删除，无软删除 |

`patch_task` 的可写列白名单（`commands.rs` 的 `PATCHABLE_COLUMNS`，键名 ↔ 列名一一对应）：

```
title · description · status · priority · energy_cost · estimated_time · actual_time
due_date · completed_at · tags · is_habit · habit_period · habit_completions
habit_start_date · habit_end_date
```

- 白名单外的键**被静默忽略**（例如前端整体传一个 `Task` 时带的 `id` / `created_at`）。
- `patch` 为空对象时不发 UPDATE，直接回查返回当前行。
- 值类型映射：`null` → `NULL`，boolean → `0/1`，number → INTEGER，string → TEXT，其他 → 字符串化。

### 插件命名空间数据

| 命令 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `plugin_data_list` | `namespace`, `collection` | `PluginDataRecord[]` | 按 `updated_at DESC` |
| `plugin_data_get` | `namespace`, `collection`, `key` | `PluginDataRecord \| null` | 查无此行返回 `Ok(None)`，**不报错** |
| `plugin_data_put` | `namespace`, `collection`, `key`, `value` | `()` | UPSERT，`updated_at = datetime('now')` |
| `plugin_data_delete` | `namespace`, `collection`, `key` | `usize` | |
| `plugin_data_clear` | `namespace`, `collection` | `usize` | 清空集合（回收站/保留期到期用） |
| `plugin_data_clear_namespace` | `namespace` | `usize` | 清空整个命名空间 |
| `plugin_data_dump` | — | `PluginDataDumpRow[]` | **全量导出**（`namespace/collection/key/value/updated_at`），只服务应用自身的备份功能 |

`PluginDataRecord` = `{ key: string, value: string, updated_at: string }`，
其中 **`value` 是 JSON 字符串**，`PluginDataStore` 负责 `JSON.parse` / `JSON.stringify`。

> **为什么需要 `plugin_data_dump`**：`plugin_data_list` 必须显式给出 `namespace + collection`，
> 而宿主把**日期当作 collection**（时段面板），无法枚举。备份场景只能全量拉取。

### 已移除的命令（迁移记录）

| 旧命令 | 现状 |
|---|---|
| `update_task` | 删除，由 `patch_task` 替代（去掉读-改-写） |
| `update_habit_completion` | 删除，打卡改走 `patch_task` 写 `habit_completions`（纯前端 JSON 操作） |
| `get_moods` / `save_mood` / `delete_mood` | 删除，心情数据统一在 `plugin_data('mood','entries')`；旧表数据由 `user_version` v2 迁移一次性搬走 |
| `greet` | 删除（模板残留） |

## 3. 前端 API 层（`src/api/index.ts`）

`api` 只保留 **4 个**任务方法，是访问 SQLite 的**唯一入口**（插件数据层走 `PluginDataStore`，是另一个入口）：

```ts
api.getTasks()                                 // Rust 行 -> 前端 Task：JSON.parse、null -> undefined
api.createTask(task)                           // Omit<Task,'id'|'created_at'> -> 新建任务 id
api.updateTask(id, patch: TaskPatch)           // 增量更新，返回更新后的 Task
api.deleteTask(id)

// 类型
type TaskPatch = Partial<Omit<Task, 'id' | 'created_at' | 'completed_at'>> & {
  completed_at?: string | null;                // null = 清空（取消完成）
};
```

约定：

- **数组字段只在边界转换**：`tags` / `habit_completions` 读时 `JSON.parse`、写时 `JSON.stringify`；
  解析失败退化为 `[]`（不抛错），Rust 侧只管搬运字符串。
- **未提供的字段不参与更新**：`toPatchPayload` 会丢弃 `undefined`，因此"只改状态"不会顺带覆盖别的列。
- **`getTasks` 失败时降级为空列表**（浏览器里没有 IPC），其余方法把错误抛给调用方。
- 组件**不要直接 `invoke`**（插件数据层是唯一例外）。

## 4. 加一个新命令的完整步骤

以"给任务加 `sort_order` 字段并支持批量重排"为例：

1. **建表/迁移**：`database.rs` 的 `CREATE TABLE` 加列（新库），并在 `MIGRATIONS` **末尾追加**
   `ALTER TABLE tasks ADD COLUMN sort_order INTEGER`（旧库），不要改历史迁移条目。
2. **Rust 结构体**：`Task` / `CreateTask` 加字段，`from_row` 补 `row.get(N)`（**列顺序必须与 SELECT 一致**）。
3. **Rust 实现**：`commands.rs` 写 `#[tauri::command] pub fn reorder_tasks(state: State<AppState>, ids: Vec<i64>) -> Result<(), String>`。
4. **注册**：`lib.rs` 的 `use commands::{...}` 加名字，`generate_handler![...]` 加名字。
5. **前端封装**：`src/api/index.ts` 加方法，内部完成 JSON 字段的转换与类型标注。
6. **类型**：`src/types/index.ts`（或对应的领域类型文件）同步。
7. **验证**：`cd src-tauri && cargo check --message-format=short`；`npm run typecheck`；`npm test`；
   最后 `npm run tauri dev` 实操一次。

## 5. 已知的契约约束与坑

| 项 | 说明 | 位置 |
|---|---|---|
| `get_tasks` 用 `SELECT *` + 位置索引映射 | 调整表列顺序会静默错位（`from_row` 按 0..17 取值）；加列**必须加在末尾** | `database.rs` |
| `patch_task` 无乐观锁 | `updated_at` 只写不校验；单用户桌面场景可接受 | `commands.rs` |
| `Task.tags` 前端是数组、Rust 是字符串 | 忘记在 `api` 边界 parse/stringify 会静默拿到字符串 | `src/api/index.ts` |
| `plugin_data` 无 `DELETE` 级联 | 卸载插件的数据靠墓碑 + 保留期清理，不是立即删除 | `plugins/runtime/dataStore.ts` |
