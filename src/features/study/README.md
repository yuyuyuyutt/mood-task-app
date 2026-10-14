# 学习工作区（`src/features/study` + `src/pages/StudyWorkspace.tsx`）

任务列表负责"生成计划"，这里负责**执行计划**：一次只聚焦一条任务 → 读它引用的内容 → 计时 → 收工 → 安排复习。

完整的设计方案、分期与边界见 [docs/STUDY-WORKSPACE.md](../../../docs/STUDY-WORKSPACE.md)。
本文件只写**当前代码里真实存在的实现**。

## 模块结构

```
src/
├─ pages/StudyWorkspace.tsx          # 页面：聚焦 + 阅读 + 计时 + 辅导 + 复习的组合编排
├─ api/studyStore.ts                 # 独立数据域（PluginDataStore + `__study` 命名空间）
└─ features/study/
   ├─ types.ts                       # 领域类型（会话 / 笔记 / 资源进度 / 辅导消息）
   ├─ pomodoro.ts                    # 番茄钟纯状态机（tick 用真实时间差）
   ├─ reading.ts                     # 阅读模式编排（白名单闸门 + 可解释原因 + 段落切分）
   ├─ markdown.ts                    # Markdown 子集解析（块级 + 行内 → 结构化节点，纯函数）
   ├─ planLink.ts                    # 任务 -> 计划资源/证据 的还原（精确路径 + 兜底路径）
   ├─ review.ts                      # 间隔重复（1/3/7/16 天）+ 复习任务载荷
   ├─ tutor.ts                       # 辅导员：先检索再回答，无依据就不调模型
   ├─ sessionMemory.ts               # 会话回流：预估 vs 实际写进长期记忆
   ├─ id.ts                          # 本地 id（带可读前缀）
   ├─ hooks/{usePomodoro,useStudyData}.ts
   └─ components/
      ├─ StudyFocusCard.tsx          # 聚焦：当前一条任务 + 推荐内容 + 开始/结束学习
      ├─ ReadingView.tsx             # 阅读优先正文视图（Markdown 还原 + 专注阅读 + 白名单引导）
      ├─ MarkdownText.tsx            # Markdown → React 元素（不走 innerHTML，无注入面）
      ├─ TutorPanel.tsx              # 辅导员对话（流式 + 引用核对）
      ├─ PomodoroCard.tsx            # 侧栏计时
      ├─ StudyNotesCard.tsx          # 侧栏速记
      └─ StudyReviewCard.tsx         # 侧栏复习安排
```

## 三个决定（对应产品而非实现细节）

| 决定 | 实现 |
|---|---|
| **应用内阅读只做白名单域名**，并引导用户配置 | `reading.ts`：`disabled` / `blocked` 都给出可执行原因；`ReadingView` 提供"把 example.com 加入白名单"一键操作（`useEmbeddingSettings().update`），以及设置页路径指引 |
| **会话与笔记纳入备份** | 数据落在 `PluginDataStore` 的 `__study` 命名空间，而 `dumpAll()` 是按命名空间全量导出的，因此天然随备份导出/恢复；`backupService.countStudyRows` 额外统计并在界面上显示条数（**看得见**比写在说明里重要） |
| **辅导员默认禁止无依据回答** | `tutor.ts`：`没有正文` / `检索不到相关片段` / `检索不可用` / `未开启模型` 四种情况都会**直接返回而不调用模型**，并把原因与下一步展示给用户 |

## 复用而不是重写

| 能力 | 落点 |
|---|---|
| 聚焦"下一条待做" | `plan-generator/services/planQueue.ts`（与任务栏同一套语义） |
| 分块 / 向量 / 检索 | `rag/chunking.ts`、`rag/vectorStore.ts`（命名空间 `study:resource`）、`rag/embedding.ts`、`hybridRetriever.buildRagRuntime` |
| 外部内容隔离 | `agent/promptGuard.ts`（`wrapUntrustedData` + `UNTRUSTED_SYSTEM_RULE`） |
| 模型传输（**流式**） | `llm/chatClient.ts` 的 `streamChat`（NDJSON / SSE，处理跨 chunk 半行） |
| 串行调度 / 取消 | `llmTaskManager.ts`（`kind: 'study'`，同一资源连续提问串行） |
| 轨迹回看 | `agent/trace.ts`（`TraceKind` 新增 `'study'`，在设置页「运行轨迹」里可见） |
| 记忆回流 | `memory/memoryStore.rememberNote` + `sessionMemory.buildStudySessionNote` |
| 正文抓取 / 缓存 | `rag/contentFetcher.ts`、`rag/contentCache.ts`（7 天 / 20 页 / 单页 6000 字） |
| 外链打开 | `utils/openExternal.ts` |

## 关键常量（改它就是改产品行为）

| 常量 | 值 | 含义 |
|---|---|---|
| `TUTOR_NAMESPACE` | `study:resource` | 学习语料独立命名空间，不干扰资源排序与生成期证据 |
| `MIN_TUTOR_SCORE` | `0.35` | 低于它的片段不构成"依据"（比资源级 `0.2` 更严） |
| `TUTOR_TOP_K` / `MAX_TUTOR_CHUNKS` / `TUTOR_CHUNK_CHARS` | `6` / `24` / `600` | 检索候选、索引块数、单块注入字数 |
| `REVIEW_INTERVALS_DAYS` | `[1, 3, 7, 16]` | 复习四档间隔（固定间隔，不做完整 SM-2） |
| `MAX_PARSE_CHARS` / `MAX_BLOCKS` / `MAX_LIST_DEPTH` | `20000` / `400` / `3` | Markdown 解析上限（防超大正文把渲染撑爆） |
| `DEFAULT_FOCUS_MINUTES` / `DEFAULT_BREAK_MINUTES` | `25` / `5` | 番茄钟默认与预设（25/5、45/10、15/3） |
| `reviewMinutes()` | 原时长 40%，钳制 10–60 分钟 | 复习不该比第一次学还久 |

## 测试

- `pomodoro.test.ts`：计时准确性、暂停语义、"专注结束不自动开始休息"
- `reading.test.ts`：白名单闸门、缓存/抓取/失败三种来源、原因可解释
- `planLink.test.ts`：精确路径与兜底路径、描述解析
- `markdown.test.ts`：Markdown 子集解析（标题 / 列表 / 代码块原样 / 引用 / 链接白名单 / 未闭合不吞字符）
- `MarkdownText.render.test.tsx`：SSR 冒烟 —— 重点真的渲染成对应标签，且 `<script>` 只能以转义文字出现
- `review.test.ts`：间隔序列、时长收敛、标签纪律（不打计划标签）
- `sessionMemory.test.ts`：偏差描述、与计划记忆不互相覆盖的合并键
- `tutor.test.ts`：**拒绝时不调用模型**（核心用例）、引用白名单、流式回调、注入隔离
- `StudyFocusCard.render.test.tsx`：SSR 渲染冒烟（空态 / 任务态 / 资源状态）

## 边界（写清楚比含糊更有用）

- 正文全文**不长期保存**：只走 7 天临时缓存、不进备份；长期留存的是笔记（用户自己写的）和计划里的 240 字摘要（`plan.evidence`）。
- 阅读模式渲染的是**从 HTML 还原的结构**（标题 / 加粗 / 列表 / 代码块 / 引用 / 链接），
  样式、图片、表格、交互组件都不还原；Markdown 解析是**子集**（不做表格、任务列表、HTML 内联）。
- 正文当**不可信内容**处理：`MarkdownText` 直接产出 React 元素（无 `dangerouslySetInnerHTML`），
  链接只允许 http(s) 且走系统浏览器打开 —— 用例会断言 `<script>` / `<img onerror>` 只以转义文字出现。
- 浏览器直连分支（不经 Rust 代理）拿不到 Markdown：界面会提示"当前是纯文本模式"，
  因为前端不做第二套 HTML→Markdown 转换（避免与 Rust 实现长期漂移）。
- 辅导员**不做通用聊天**：没有 `当前资源的正文` 就不能问；这是产品决定，不是能力不足。
- 复习任务写进既有任务表、带「复习」标签，**不打计划标签**，因此不会被任务栏的逐条解锁隐藏。
- 番茄钟不跨刷新恢复计时（学习时长以会话为单位落库，刷新只丢当前一轮的剩余时间）。
