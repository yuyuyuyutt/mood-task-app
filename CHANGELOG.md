# 更新日志

本项目遵循「版本号单一真源」原则：`src-tauri/tauri.conf.json` 是唯一版本真源，
`package.json` 与 `src-tauri/Cargo.toml` 由 `npm run version:sync` 同步（CI 会校验一致性）。

## [未发布] — 品牌更名 · Agent 增强层 P0–P6 · 学习工作区

> 工作区当前状态，见 [`docs/AGENT-ARCHITECTURE.md`](docs/AGENT-ARCHITECTURE.md) 与
> [`docs/STUDY-WORKSPACE.md`](docs/STUDY-WORKSPACE.md)。

### 品牌更名：mood-task-app → Sophotask（含旧数据兼容）

中文名「高山仰止」保留，英文名统一为 Sophotask（界面标题为 `Sophotask · 高山仰止`）。

- **包与产物**：`package.json` / `Cargo.toml` / Tauri `productName` 改为 `sophotask`，
  Rust crate 与 lib 名改为 `sophotask`，`main.rs` 调用随之更新。
- **应用标识符**：`com.moodtask.app` → `com.sophotask.app`（决定安装包身份与 AppData 目录）。
- **本地存储键**：`mood-task:*` → `sophotask:*`，IndexedDB `mood-task-planner` → `sophotask-planner`，
  备份标识 `mood-task-backup` → `sophotask-backup`。
- **旧数据兼容（关键）**：
  - 启动时执行 `migrateLegacyLocalStorage()`，把 `mood-task:*` 一次性搬到 `sophotask:*`
    （新键已存在则保留新键，只删旧键），因此枚举型读取点无需双前缀逻辑；
  - 计划生成器首次创建新库时，会把旧库 `mood-task-planner` 的记录整体搬入后删除旧库；
  - Rust 侧 `migrate.rs` 在初始化数据库**之前**把旧标识符目录的数据补进新目录
    （只补缺失、绝不覆盖，失败不阻塞启动）；
  - 备份解析同时接受旧的 `mood-task-backup` 标识，用户改名后仍能导入旧备份。

### Agent 增强层

- **模型网关**：三阶段 LLM 调用切到 `/api/chat`（system/user 分离）+ JSON Schema 约束输出 +
  `PROMPT_VERSION` 版本化；服务端拒绝 schema 时自动退化为 `format:'json'` 重试一次。
- **可观测**：新增 run 级轨迹（步骤 / 工具调用与裁决理由 / 记忆命中 / 降级原因 / 耗时 / prompt 版本）。
- **记忆**：情景记忆（结论 + 证据 + 置信度）写入 / 合并 / 衰减 / 结构化召回 + 相关性闸门；
  设置页新增「记忆」卡片（查看 / 删除 / 清空 / 总开关），并纳入全量备份。
- **Skill 体系**：工具白名单注册 + zod 参数校验 + scope 权限门 + 变更 diff 预览 + 一次性确认令牌；
  向导第 3 步新增「对话式调整」（模型不可用时退化为本地指令解析）。
- **语义检索（RAG）**：本地 embedding（内容哈希寻址缓存 + 老接口兼容）+ 向量落 SQLite
  （**余弦 Top-K 在 Rust 侧算，向量不过 IPC**）+ 与启发式四维排序做 **RRF 融合**；
  设置页新增「语义检索」卡片（开关 / 模型 / 连通性测试 / 索引管理），模型不可用时自动回退纯关键词排序。
- **内容级证据**：白名单域名正文抓取（桌面端经 Rust 代理，含 SSRF 防护与体积上限）→ 句子边界分块
  → 只把最相关的证据块注入 prompt；证据以 `E1..En` 编号参与**引用白名单**校验；
  正文包成「不可信数据」块并在 system 声明其不构成指令；正文仅本机缓存 7 天、可一键清除、**不进备份**。
- **多角色协作**：**Agent 一键生成** 由确定性 Orchestrator 调度 Clarifier / Researcher / Planner / Critic；
  角色间走 zod 校验的结构化消息；澄清问题由编排器用画像与历史记忆自问自答并**标注依据**；
  Critic 以确定性规则校验硬约束并只产出违规清单与变更差异；四级降级
  `multi → single → pipeline → rule` 写进 trace 并在运行报告中展示。
- **可观测与可回归**：设置页新增「运行轨迹」面板；新增**离线评测 harness**
  （`npm run eval`，7 条脚本化用例 + 9 项指标 + 门禁，已接入 CI），跑的是生产同一套代码、
  只替换模型层，因此链路回归一定会被抓到。

### 任务列表体验

1. **计划任务逐条解锁**：一份计划在列表里只占一行（“下一条待做”），完成一条才显示下一条，
   行下方给出进度提示（纯函数 `services/planQueue.ts`）。
2. **悬浮看详情**：鼠标停在任务行（或键盘聚焦）浮现详情卡，展示目标 / 进度 / 建议时段 /
   安排理由 / 方法论 / 引用资源 / 建议与完整标签；卡片挂在 body 上按视口定位。
3. **状态改为行上徽标点击切换**：暂缓 → 进行中 → 完成 循环，切换为乐观更新、失败回滚。
4. **「AI 润色」改成标签**：新任务写 `AI 生成 · 模型名` 标签，老数据在展示层迁移成同样的标签徽标，不改动数据库。

### 学习工作区（`/study`）

- **页面**：主导航新增「学习工作区」；主区聚焦**下一条待做**（复用计划队列语义），侧栏是番茄钟 / 复习 / 速记。
- **数据域**：`api/studyStore.ts` —— 宿主保留命名空间 `__study`（会话 / 笔记 / 资源进度 / 辅导记录），
  **随备份导出**，并在导出/恢复报告里单独计数。
- **阅读模式**：只抓白名单域名（桌面经 Rust 代理，含 SSRF 与体积上限），**只渲染纯文本**；
  未配置 / 不在白名单 / 抓取失败都给出可执行原因，并提供**一键加入白名单**。
- **番茄钟**：纯状态机（`tick` 用真实时间差，暂停不计入专注时长），专注结束**不自动开始休息**。
- **学习辅导员**：`features/study/tutor.ts` —— 先在资源正文里做向量检索，
  **没有正文 / 检索不到片段 / embedding 不可用 / 未开模型都不调用模型**，回答带 `E1..En` 引用白名单。
- **传输**：`chatClient` 新增 `streamChat`（Ollama NDJSON / OpenAI SSE，处理跨 chunk 半行），
  本地 7B 模型的首字延迟降到 1 秒内。
- **回流**：收工时把“预估 vs 实际偏差”写进记忆（合并键 `study:` 前缀，与计划记忆互不覆盖）；
  间隔复习（1/3/7/16 天）写入既有任务表、**不打计划标签**。

### 阅读模式升级：以正文为主 + 还原原网站的 Markdown 结构

- **提取器（Rust）**：`content.rs` 新增 `html_to_markdown` —— 在同一次抓取里额外产出结构化正文；
  `html_to_text` 保持不动：**检索与证据继续用纯文本（干净优先），阅读用 Markdown（重点优先）**。
- **缓存与传输**：`fetch_page_text` 与 `CachedContent` 增加 `markdown` 字段（旧缓存没有时自动回退纯文本）。
- **渲染**：`features/study/markdown.ts`（Markdown 子集解析 → 结构化节点）+ `MarkdownText` 组件，
  **不用 `dangerouslySetInnerHTML`**，直接映射成 React 元素；链接只接受 http(s) 并走系统浏览器打开。
- **版面**：正文限宽 ~68 字符、行高 1.9、字号可调；读到正文后**自动进入「专注阅读」**。

### 工程

- 单测 127 → **384**（37 文件，另有 Rust 20 例），`typecheck` / `lint` / `build` / CI 全绿。
- `docs/` 全套维护与开发文档随代码同步更新。

---

## [0.1.3]

- **正确性**：`completed_at` 全链路打通（历史列表不再显示创建日）。
- **架构**：Rust 收敛为单一入口（`lib.rs`）；命令精简为 11 个并新增增量 `patch_task`。
- **数据**：心情数据收敛到插件命名空间，SQLite `moods` 表废弃并一次性迁移；
  `PRAGMA user_version` 顺序迁移机制上线。
- **安全**：沙箱消息来源校验、插件核心版本校验、删除空实现的签名校验（含死代码清理）。
- **体验**：设置项持久化、统计页真实趋势且时间范围生效、外链走 opener、路由改 Hash。
- **能力**：新增全量数据导出 / 导入备份。
- **工程**：ESLint、CI、`vitest.config.ts` 与 29 个新用例、移除 10 个未使用依赖。

## [0.1.2]

- 新增「时段面板」独立数据域（复用插件数据基础设施）、插件数据保留期（回收站）。
- 个性化计划生成器三阶段向导（澄清 → 三层资源检索 → 计划生成并落库）。
- 窗口化列表与空闲调度等性能优化。

## [0.1.1]

- 完善插件系统，加入包含沙箱的安全机制。

## [0.1.0]

- 接入本地 **SQLite** 数据库。

## [0.0.1]

- 完成主体框架的架构和设计。

---

[未发布]: https://github.com/yuyuyuyutt/sophotask/compare/v0.1.3...HEAD
