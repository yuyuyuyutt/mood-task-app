# 技术债与待办

按"先修正确性，再修体验，最后补工程化"排序。每条都给出**位置**与**建议做法**，可直接当排期清单用。

状态：✅ 已修 · ⬜ 未修
> 本轮（2026-09-14 第 2 次）已按清单把 P0/P1/P2 **全部处理完毕**（含 P2-1 ESLint）。
> 每条的"修法"都记录了**实际落地的方案**，便于回滚或二次判断。

---

## P0 — 正确性与一致性

### ✅ P0-1 `completed_at` 列从不被写入

- **原现象**：历史列表显示"完成于 {日期}"，实际取的是 `created_at`（任务**创建**日），
  `Task.completed_at` 在前端永远是 `undefined`。
- **落地修法**：
  - `database.rs` → `struct CreateTask` 增加 `completed_at: Option<String>`；
  - `commands.rs` → `create_task` 的 INSERT 列表补上该列；
  - 新增 `patch_task`（见 P1-9）统一承接 `completed_at` 的写入与清空；
  - `src/api/index.ts` → `toCreatePayload` 带上 `completed_at`，`TaskPatch` 允许 `completed_at: string | null`；
  - `TaskList.tsx` → 取消完成时改为 `updateTask(id, { status: 'pending', completed_at: null })`（不再需要 `as unknown as` 强转），
    **语义决定：取消完成即清空**，保持"completed_at 有值 ⇔ 状态为 completed"。
- **验证**：`src/api/__tests__/index.test.ts` 覆盖"创建时写入 / 透传读回 / 置空清列"三条。

### ✅ P0-2 Rust 命令注册存在"两个入口"，`lib.rs` 是模板残留

- **落地修法**（采用建议中的方案 a）：
  - `src-tauri/src/lib.rs` 成为**唯一入口**：`mod commands; mod database;`、数据库初始化、
    全部命令注册都在这里，`pub fn run()`；
  - `src-tauri/src/main.rs` 缩成 4 行：`fn main() { sophotask::run() }`，
    并补上 release 下的 `windows_subsystem = "windows"`；
  - `Cargo.toml` 显式声明 `[lib] name = "sophotask"`；
  - 顺带挂载 `tauri_plugin_opener::init()`（同时修掉 P1-1）。
- **注意**：要支持移动端还需给 `[lib] crate-type` 加 `staticlib`/`cdylib`，当前桌面端不需要，故未加。
- **验证**：`cd src-tauri && cargo check --message-format=short` → 0 warning / 0 error。

### ✅ P0-3 版本号三处不一致

- **落地修法**：以 `src-tauri/tauri.conf.json` 为唯一真源（= `0.1.3`），
  新增 `scripts/sync-version.mjs`：默认把真源版本写回 `package.json` 与 `src-tauri/Cargo.toml`，
  带 `--check` 时只校验（不一致退出码 1）。
  - `npm run version:sync` / `npm run version:check`
  - CI 里已接入 `version:check`（见 P2-2）

---

## P1 — 体验与健壮性

### ✅ P1-1 桌面端"资源跳转"按钮点不开

- **落地修法**：
  - `lib.rs` 挂载 `tauri_plugin_opener::init()`；
  - `capabilities/default.json` 增加 `opener:default` 与 `opener:allow-open-url`；
  - 新增 `src/utils/openExternal.ts`：Tauri 下走 `openUrl()`（动态 import，不进主包），
    浏览器下回退 `window.open`，并**只放行 http(s)**；
  - 四处 `<a target="_blank">` 统一挂 `onClick={(e) => handleExternalLink(e, url)}`
    （`ResourceLibraryPanel` / `ResourceStep` ×2 / `PlanStep`），保留 `href` 便于右键复制。
- **未变**：仍没有做"打开失败"的用户可见提示，失败只在 console 里回退。

### ✅ P1-2 没有数据导出 / 导入

- **落地修法**：新增 `src/features/backup/`：
  - `backupService.ts`：`createBackup()` / `parseBackup()` / `restoreBackup()`；
  - `components/DataBackupCard.tsx`：挂在设置页，"下载备份 / 复制为 JSON / 从备份恢复"；
  - Rust 新增 `plugin_data_dump`（全量导出 `plugin_data`，因为 `plugin_data_list` 必须显式给 collection，
    无法枚举按日期分 collection 的时段面板数据）；浏览器下 `PluginDataStore.dumpAll()` 扫 localStorage。
- **覆盖范围**：任务（SQLite）、插件命名空间数据（心情 / 时段面板）、计划生成器 IndexedDB（kv / plans / resources）、
  应用设置、用户昵称。
- **恢复策略是"合并"而不是"清库重建"**：任务按 `标题+创建时间` 去重追加；同 key 覆盖；
  应用设置字段级合并；任务表不会被清空。
- **已知限制**：头像图片文件不进备份（仅记录文件名，恢复时保留本机现有头像）。

### ✅ P1-3 插件签名校验是空实现

- **落地修法**（采用建议中的"删掉"方案）：`src/utils/security.ts` 整个文件都是死代码
  （`calculateChecksum` / `verifySignature` / `generatePluginId` / `isValidPluginId` / `isValidVersion` 全局零引用），
  直接删除；`crypto-js` 仍被 `plan-generator/services/resources/bilibiliWbi.ts` 使用，故依赖保留。
- **口径**：安全模型只有两层——**声明式能力 + 沙箱 + 数据权限门（已补测试）**，与签名无关。
  任何对外材料**不得**声称"插件已签名验证"。

### ✅ P1-4 沙箱消息缺少来源校验

- **落地修法**：`sandbox.ts` 的 `handleMessage` 把 `event.source` 透传给 `route()`，
  校验 `source === rec.iframe.contentWindow`，不匹配即丢弃并告警
  （跨域 iframe 的 WindowProxy 身份比较是允许的）。`dispatch()`（测试/内部投递）不带 source，行为不变。
- **未做**：远程 `url` 插件仍没有 token 握手（其页面直接加载，无法注入 SDK），
  但来源校验已覆盖它——伪造消息必须先从该 iframe 内部发出。

### ✅ P1-5 `minCoreVersion` 不做运行时校验

- **落地修法**：`host.ts` 新增 `checkCoreCompatibility()`，在 `installPlugin()` 最前面执行，
  不满足 `minCoreVersion ≤ CORE_VERSION ≤ maxCoreVersion` 时**直接抛错拒绝安装**；
  错误信息会经 `installFromManifest` 的 catch 变成安装弹窗里的 `errors`。
- 顺带消除重复：`compareVersions` 原本有 3 份副本（`parser/validator.ts`、`builtin/index.ts`、
  `PluginListItem.tsx`），统一到 `src/utils/version.ts`。

### ✅ P1-6 设置页部分选项不持久化

- **落地修法**：新增 `src/utils/appSettings.ts`（localStorage 键 `sophotask:app-settings:v1`，
  损坏/缺字段逐项回退默认值，带 `useAppSettings()` Hook），设置页改用它；
  顺手删掉从未被渲染的死字段（`emailNotifications` / `fontSize` / `compactMode` /
  `privacyMode` / `showMoodPublicly` / `autoSave` / `backupFrequency`）。
- **口径**：通知类开关目前**只保存偏好、未接入系统通知**，UI 已明确标注。

### ✅ P1-7 统计页的情绪趋势是占位数据

- **落地修法**：删掉写死的 `calculateTrend()`，改为与**上一个等长周期**真实对比：
  任务数变化用百分比，完成率变化用百分点（`pp`），心情记录数用百分比；
  新增 `TrendBadge` 组件按正负自动换箭头方向与颜色（负值不再显示绿色向上箭头）。
- 顺带修掉一个未列进 TODO 的问题：**"本周/本月/今年"按钮此前完全无效**（`timeRange`
  只参与按钮高亮）。现在它真的会筛数据（任务按 `created_at`、心情按 `date`，窗口 7/30/365 天）。

### ✅ P1-8 心情数据存在两份，语义易混

- **唯一真源**：`plugin_data(namespace='mood', collection='entries')`（插件 `mood-diary` 的声明命名空间）。
- **落地修法**：
  - 前端：删除 `src/api/index.ts` 里基于 SQLite `moods` 表的全部通道
    （`getMoods` / `getMoodsByMonth` / `saveMood` / `deleteMood`）以及同批死代码
    （`getStatistics` / `updateTaskStatus` / `updateHabitCompletion` / `getHabitStats` /
    `checkTodayHabits` / `getTodayHabitStatus` / `getHabitTasks`）。**`api` 从 417 行缩到 127 行**；
  - Rust：删除 `Mood` / `CreateMood` 结构与 `get_moods` / `save_mood` / `delete_mood` /
    `update_habit_completion` 命令；
  - 一次性迁移：`database.rs` 的 v2 迁移把 `moods` 表数据搬进 `plugin_data`
    （值结构与 `moodData.ts` 的 `MoodEntryValue` 对齐，`INSERT OR IGNORE` 不覆盖新数据）；
  - `moods` 表**保留但不再读写**，只作为迁移源，注释已标注"后续版本可删除"。

### ✅ P1-9 读-改-写式更新

- **落地修法**：新增 Rust 命令 `patch_task(id, patch: serde_json::Value)`：
  按**列白名单**（`PATCHABLE_COLUMNS`）动态拼 `UPDATE`，键名只作查表用、值全部走占位符，
  从结构上排除注入；JSON `null` 语义 = 置空该列；同时刷新 `updated_at`。
  前端 `api.updateTask(id, patch)` 变成**一次 IPC 调用**，不再先 `getTasks()` 再全量覆盖。
  `update_task` 命令随之删除（已无调用方）。
- **未做**：乐观锁（`updated_at` 只写不校验）。当前单用户桌面场景下收益不足以抵消复杂度。

### ✅ P1-10 `BrowserRouter` 在桌面端的深链/刷新行为

- **落地修法**：`App.tsx` 改用 `HashRouter`（打包后 WebView 走 Tauri 自定义协议，
  Browser 式路径在刷新/深链时会 404）。开发模式不受影响。

---

## P2 — 工程化

### ✅ P2-1 没有 Lint / 格式化

- **落地修法**：`eslint.config.js`（ESLint 9 flat config）+ devDeps
  `eslint` / `@eslint/js` / `typescript-eslint` / `eslint-plugin-react-hooks`；
  脚本 `npm run lint` / `npm run lint:fix`，CI 已接入。
- **规则口径**（决定它是不是"能用的门"）：
  - **error 级只有两条**：`react-hooks/rules-of-hooks`（hooks 顺序写错必崩）；
  - **warn 级**：`react-hooks/exhaustive-deps`、`@typescript-eslint/no-explicit-any`、
    `@typescript-eslint/no-unused-vars`；
  - react-hooks v7 的 `recommended-latest` 里那批实验性规则（`set-state-in-effect` /
    `use-memo` / `immutability` …）对存量代码噪声过大（实测 32 个 error），**明确不启用**。
- **当前基线**：`0 error / 25 warning`，集中在 `components/` 与 `plugins/parser/` 的历史 `any`。
  警告不阻塞 CI，作为"下次动这些文件时顺手清理"的提示。
- **仍未做**：Prettier。格式化不在 lint 里争论，交给编辑器与 review。

### ✅ P2-2 没有 CI

- **落地修法**：`.github/workflows/ci.yml`，单 job 跑
  `npm ci` → `version:check` → `typecheck` → `test` → `build`。
- **明确不放进 CI**：Rust 的 `cargo check`。它需要 runner 预装 WebKitGTK 等系统依赖、首次编译慢，
  与"快速稳定"的定位冲突；改为在本机执行（命令已写进 workflow 注释与 `docs/DEV-GUIDE.md`）。

### ✅ P2-3 未使用的依赖

- **落地修法**：移除 10 个零引用依赖并同步 `package-lock.json`：
  `axios`、`jszip`、`lodash-es`、`immer`、`react-hook-form`、`react-markdown`、`recharts`、
  `rollup-plugin-polyfill-node`、`@esbuild-plugins/node-globals-polyfill`、
  `@esbuild-plugins/node-modules-polyfill`。
- 保留但需注意：`date-fns`、`zod`、`toml`、`react-icons`、
  `tailwindcss-filters`（`tailwind.config.js` 里用）均仍有引用。
- `crypto-js` 已随 wbi 签名逻辑一并移除（2026-09-16：B 站搜索改走 Rust 侧代理，
  `wbi/search/type` 实测无需签名，见 `src-tauri/src/commands.rs` 的 `search_bilibili`）。

### ✅ P2-4 测试基础设施不完整

- **落地修法**：新增 `vitest.config.ts`（`environment: 'node'`、显式 `include`、`restoreMocks`；
  不引入 jsdom，依赖 DOM 的模块由测试自注入桩对象）；
  按 TODO 的建议优先补上两块**安全/数据咽喉**的测试：
  - `src/plugins/runtime/__tests__/dataStore.test.ts`：权限门全部拒绝分支 + core 身份 + `bind()` 失效 + dump/restore 往返；
  - `src/api/__tests__/index.test.ts`：JSON 字段映射、降级、增量 patch 语义（含 `completed_at` 三条路径）；
  - 另加 `src/utils/__tests__/version.test.ts`、`src/features/backup/__tests__/backupService.test.ts`。
- **仍未做**：覆盖率统计（需要 `@vitest/coverage-v8`）与组件测试。

### ✅ P2-5 没有数据库迁移机制

- **落地修法**：`database.rs` 引入 PRAGMA `user_version` 驱动的**顺序迁移表** `MIGRATIONS`：
  只允许在末尾追加条目；每条可用 `guard: (表, 列)` 声明"新库建表时已包含该列"，
  命中则跳过执行（避免 `ALTER TABLE` 重复加列报错），`user_version` 仍会推进。
  当前两条：`v1` 给 `tasks` 加 `updated_at`；`v2` 把 `moods` 搬进 `plugin_data`。
- **正确姿势**：加字段 = 在 `MIGRATIONS` 末尾追加一条 `ALTER TABLE` + 同步 `CREATE TABLE`（新库直接是最新结构），
  **不再需要删库重建**。

### ✅ P2-6 仓库里的垃圾文件

- **落地修法**：删除 `src-tauri/2`（内容为 `npm install` 输出日志的普通文件）。

---

## 建议的下一步顺序

1. **Prettier / 格式化统一**（ESLint 已就位；格式交给编辑器或 Prettier，避免风格争论）
2. **清理 25 条 lint warning**（集中在历史 `any` 与 `exhaustive-deps`，动到哪个文件就顺手清哪个）
3. **覆盖率统计 + `PluginDataStore` 的墓碑/保留期测试**（清理逻辑目前靠人肉验证）
4. **远程代码插件的 token 握手**（P1-4 的收敛项）
5. **备份的增量/自动周期**（现在是手动全量，数据量长大后体验会变差）
