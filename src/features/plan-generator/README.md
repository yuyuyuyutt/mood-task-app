# 个性化计划生成器（三阶段向导 + Agent 增强层）

目标 → **澄清问题** → **资源检索（三层）** → **计划生成（含策略与引用）** → 按日期写入任务表。
在固定管线之上叠加了一层 **Agent 能力**（模型网关 / 轨迹 / 记忆 / 工具 / 向量与正文检索 / 多角色协作），
每一层都能独立降级；另有一套**离线评测**跑真实链路并把指标卡在门禁上。

## 模块结构

```
src/features/plan-generator/
├─ components/
│  ├─ PlanGeneratorWorkspace.tsx      # 向导编排（表单 / 三步 / 已生成计划 / 落库）
│  ├─ PlanAdjustPanel.tsx             # 对话式调整（工具 diff 预览 + 确认闸门）
│  ├─ NetworkingSettingsCard.tsx      # 设置页「资源与联网」
│  ├─ ResourceLibraryPanel.tsx        # 我的资源库（手动添加）
│  ├─ UserTypeCard.tsx                # 设置页「个人画像」
│  ├─ MemoryCard.tsx                  # 设置页「记忆」：查看 / 删除 / 清空 / 总开关
│  ├─ EmbeddingSettingsCard.tsx       # 设置页「语义检索」：开关 / 模型 / 连通性 / 索引与正文缓存管理
│  ├─ AgentRunPanel.tsx               # Agent 模式运行报告：级别 / 角色 / 假设 / 校验与修正
│  ├─ TracePanel.tsx                  # 设置页「运行轨迹」：逐步耗时与成败 / 工具裁决 / 降级原因
│  └─ wizard/{WizardProgress,ClarifyStep,ResourceStep,PlanStep}.tsx
├─ services/
│  ├─ llm/
│  │  ├─ chatClient.ts      # 模型网关：/api/chat（system/user 分离）、JSON Schema、schema 被拒自动降级
│  │  └─ schemas.ts         # 三阶段 + 工具调用的输出契约（保守 JSON Schema）
│  ├─ agent/
│  │  ├─ trace.ts           # run 级轨迹：步骤 / 工具调用 / 降级原因 / 耗时（内存环形缓冲 + 防抖落盘）
│  │  ├─ promptGuard.ts     # 提示注入隔离：清洗外部文本 + 包成"不可信数据"块 + system 声明
│  │  ├─ adjustPlan.ts      # 对话式调整的单步 run（决策 → 闸门 → 确认 → 应用）
│  │  ├─ agents/            # 多角色协作（P5）
│  │  │  ├─ protocol.ts     # 结构化消息契约（zod）+ 能力级别定义
│  │  │  ├─ critic.ts       # 确定性约束校验 + 安全修正 + 计划差异
│  │  │  ├─ roles.ts        # Clarifier / Researcher / Planner 薄封装 + 澄清自答
│  │  │  ├─ orchestrator.ts # 确定性编排（不调 LLM）：顺序、降级、级别判定
│  │  │  └─ index.ts        # 统一出口
│  │  └─ tools/
│  │     ├─ types.ts        # Skill 契约：scope 权限、读写分级、diff 预览
│  │     ├─ registry.ts     # 白名单注册表（唯一真源，prompt 清单由它生成）
│  │     ├─ gate.ts         # 权限门 + 确认闸门（一次性令牌，5 分钟过期）
│  │     └─ builtin/{planQueryTools,planEditTools,index}.ts
│  ├─ memory/
│  │  ├─ memoryWriter.ts    # 记忆写入 / 合并 / 衰减（纯函数）
│  │  ├─ memoryRetriever.ts # 召回打分（类别 + 词面 + 置信度 + 时效）+ 相关性闸门（纯函数）
│  │  └─ memoryStore.ts     # 持久化与门面（IndexedDB memory store）
│  ├─ rag/
│  │  ├─ embedding.ts       # 本地 embedding：/api/embed 批量 + 内容哈希缓存 + 老接口兼容 + 探测
│  │  ├─ vectorStore.ts     # 向量存储：Tauri（Rust SQLite）/ 浏览器（IndexedDB）/ 内存（评测）
│  │  ├─ inMemoryVectorBackend.ts # 进程内后端：离线评测在没有 IndexedDB 的环境里跑真实检索
│  │  ├─ hybridRetriever.ts # RRF 融合语义序与启发式序 + 语义重排 + 永不放出的降级编排
│  │  ├─ chunking.ts        # 正文分块（句子边界优先 + 重叠 + 单页上限）
│  │  ├─ contentCache.ts    # 正文临时缓存（独立 store / 7 天 TTL / 不进备份 / 可清除）
│  │  ├─ contentFetcher.ts  # 白名单 + 超时 + 字数上限；桌面端走 Rust 代理，浏览器直连降级
│  │  └─ evidence.ts        # 证据编排：抓正文 → 分块 → 增量嵌入 → 召回 Top-N → E1..En
│  ├─ eval/                 # 离线评测（P6）：metrics 指标口径 / replay 回放桩 / cases 用例集
│  │                        #   / runner 跑真实链路 + 门禁 / report 文本与 Markdown 报告
│  ├─ prompts.ts            # 所有 LLM 提示词集中管理（system/user 分离 + PROMPT_VERSION）
│  ├─ llmClient.ts          # Ollama 传输层（探测 / 单条 generate / 超时 / keep_alive）
│  ├─ llmTaskManager.ts     # LLM 生命周期管理（串行、去重、取消、空闲调度）
│  ├─ jsonExtract.ts        # 容错 JSON 解析（代码块 / 尾随逗号 / 字段夹紧）
│  ├─ clarificationService.ts   # 阶段 1
│  ├─ resourceService.ts        # 阶段 2 编排：关键词 + 打分 + 去重 + 分组 + 截断
│  ├─ resources/{jumpLinks,bilibiliSource,searxngSource}.ts   # B 站 / SearXNG：桌面端走 Rust 代理
│  ├─ planComposer.ts           # 阶段 3（引用校验 + 策略补齐 + 记忆注入 + 规则回退）
│  ├─ planGenerator.ts / templates.ts   # 规则生成器（兜底）
│  ├─ planQueue.ts                      # 计划任务的"逐条解锁"队列（任务栏只展示下一条）
│  └─ planToTaskPayloads.ts / taskMaterializer.ts  # 写入任务表
├─ hooks/{useHabitProfile,useNetworkingSettings,useResourceLibrary,usePlans,useMemory,useEmbeddingSettings,useTraces}.ts
└─ db/plannerDB.ts          # IndexedDB v5（kv / plans / resources / memory / embeddings / contentCache）
```

## 1. 配置 SearXNG（第二层，可选）

```bash
# 1) 运行实例（容器内监听 8080，映射到宿主机 8888）
docker run -d --name searxng -p 8888:8080 \
  -v "$(pwd)/searxng:/etc/searxng" \
  -e "BASE_URL=http://localhost:8888/" \
  -e "INSTANCE_NAME=sophotask" \
  searxng/searxng:latest
```

**必须开启 JSON 输出**：编辑 `./searxng/settings.yml`
（SearXNG 新版默认只输出 html，`format=json` 未加白名单会直接 403）

```yaml
use_default_settings: true

server:
  secret_key: "改成随机字符串"   # 必填
  limiter: false                # 本地实例关掉限流（limiter 会导致 403 / 无 CORS 头）

search:
  formats:
    - html
    - json      # ← 本功能依赖此行

# 必须调引擎：默认启用的通用引擎在国内几乎全废（见下表）
engines:
  - name: 360search
    disabled: false
  # 其余全部显式 disabled: true —— 见下方实测结论
```

**国内引擎实测结论（2026-09-16，本机 8888 实例）**：

| 引擎 | 结果 | 说明 |
|---|---|---|
| `360search` | ✅ **稳定可用** | 每次检索稳定返回 4 条，质量高（菜鸟教程 / 慕课网 / 脚本之家） |
| `quark` | ⚠️ 间歇可用 | 有时 8 条，有时无响应；不稳定，建议关闭 |
| `duckduckgo` / `brave` / `wikipedia` / `wikidata` / `google cse` / `lingva` | ❌ 被墙 | 默认启用，但每个请求都白等 3s 超时 |
| `baidu` | ❌ CAPTCHA | 首次查询即触发验证码，被暂停 1 小时 |
| `bing` | ❌ 静默空结果 | 被重定向到 cn.bing 变体，解析器扑空（HTTP 200 但 0 条） |
| `sogou` | ❌ 引擎 bug | `AttributeError: resp.next_request`，该版本代码问题 |

> 结论：**只启用 `360search`**。把失效引擎开着不会报错，但每次搜索都要白等它们的超时，
> 是「接口通但没结果 / 结果很慢」的典型原因。

重启后验证（必须看到结果条数 > 0，而不只是 HTTP 200）：

```bash
curl "http://localhost:8888/search?q=python&format=json"
```

然后在「系统设置 → 资源与联网」打开 **第二层**，填入 `http://localhost:8888`，点「测试连接」。
引擎白名单**留空即可**（留空 = 用实例里启用的引擎，即 360search）；若要限定，
建议只填 `360search`（`douban / zhihu / juejin / github / wikipedia / bing` 这些在国内基本不通）。

## 2. 三层资源在设置页如何开关

「系统设置 → 资源与联网」：

| 层 | 开关 | 默认 | 说明 |
|---|---|---|---|
| 第一层 | B 站搜索 API | **关** | 桌面端经 Rust 侧代理（`search_bilibili` command，无 CORS 限制）；浏览器直连会因 CORS 失败而自动降级 |
| 第二层 | SearXNG | **关** | 桌面端经 Rust 侧代理（`search_searxng` command）；填地址 + 可选引擎白名单；未配置/失败自动跳过 |
| 第三层 | 平台跳转按钮 | **开** | 纯链接（B 站/豆瓣/小红书/抖音/知乎/掘金），不联网 |

同页可设置：请求超时（默认 5000ms）、偏好难度（影响排序）、以及「我的资源库」。
顶部徽标会显示当前是「纯本地模式」还是「已开启联网检索」。

## 3. 降级逻辑的触发条件

| 环节 | 触发条件 | 降级行为 |
|---|---|---|
| 澄清问题 | AI 未开启 / 未选模型 / 请求失败 / JSON 解析失败 / 少于 3 个问题 | 使用**通用问题模板**（覆盖五个维度），并在 UI 标注原因 |
| 检索关键词 | 同上（JSON 解析失败 / 少于 2 个关键词） | 使用**模板关键词**（入门/路线/练习/避坑） |
| 第一层 B 站 | Rust 代理失败（超时 / 风控）；浏览器环境直连被 CORS 拦 | 记录层状态为「已降级」，继续第二层 + 跳转按钮 |
| 第二层 SearXNG | 未配置、未开启、HTTP 非 200、超时（默认 5s） | 静默跳过，继续 B 站 + 跳转按钮 |
| 第一 + 第二层全失败 | 两者均不可用 | 仅**跳转按钮**，并提示"计划仍会正常生成" |
| 计划生成 | AI 未开启 / 请求失败 / JSON 不可解析 / 无有效日程 | 回退**规则生成器**（仍带策略、理由、资源引用） |
| 引用校验 | 模型给出不在资源列表中的 `resourceIds` | 丢弃该引用并提示"防止编造链接" |
| 策略校验 | 风险提示少于 2 条 | 从规则模板补齐（保证 ≥2 条） |
| JSON Schema | 服务端拒绝 schema（老版本 Ollama / 不支持的模型） | 去掉约束、以 `format:'json'` 重试一次，降级原因写进 trace |
| 记忆召回 | 记忆关闭 / 无相关历史 / IndexedDB 不可用 | 不注入"历史参考"段落，生成照常（可用性优先于个性化） |
| 对话式调整 | 模型未开启 / 决策解析失败 | 退化为**本地指令解析**（顺延 / 压缩 / 删除）；仍无法解析则提示可用指令，计划不变 |
| 工具调用越界 | 未注册工具 / 缺权限 / 参数非法 / 无变更预览 | 一律拒绝执行，原因写入 trace，计划零变化 |
| 语义检索 | 未开启 / 未配模型 / embedding 超时或 5xx / 索引读取失败 / 候选不足 2 条 | `enabled:false + degradedReason`，排序退回纯关键词，并在警告里写明原因 |
| embedding 接口差异 | 服务端没有 `/api/embed`（老版本 Ollama） | 自动逐条退回 `/api/embeddings`；超时与 5xx **不**退（换端点也一样，白等一轮） |
| 正文证据 | 未开启 / 无白名单域名 / 抓取失败 / 无 embedding | 不注入证据（`enabled:false + degradedReason`），计划照常生成；个别页面失败只跳过它 |
| 正文证据（软降级） | embedding 可用但检索失败 | 退化为"按资源顺序取前 N 块"，仍是真实正文，`note` 里写明 |
| 多角色协作 | 任一角色抛错 / 契约校验失败 | 该角色记 `fallback` 并降级：澄清→模板问题、检索→无资源、规划→规则生成器、校验→跳过校验；级别写入 trace 与运行报告 |
| Critic 修正 | 违规属"结构类"或修正轮失败 | 不做猜测性删改：报告问题并保留当前版本，把未解决的问题写进警告 |
| 澄清自答 | 画像/记忆里没有依据 | 明确标为「默认假设」，在运行报告里单独提示用户核对（不冒充事实） |
| 任意请求 | 超过 `timeoutMs`（默认 5000ms） | `AbortController` 立即中止 → 走上述降级，不阻塞向导 |

> 所有 LLM 调用都经 `llmTaskManager`（串行 + 空闲调度 + 单 key 去重 + 离开向导即 `cancelAll`），
> 且 Ollama 请求带 `keep_alive: '30s'`，模型空闲 30 秒后自动卸载，不常驻占用 CPU。

## 4. 隐私要点

- 默认**不联网**（只启用第三层跳转按钮）；开启联网层时 UI 明确提示会发送"检索关键词"。
- 不存储任何抓取到的网页正文，只保存标题 / URL / 作者 / 时长 / 播放量 / 发布时间等元数据。
- 计划、画像、反馈、资源库全部保存在本机 IndexedDB（`sophotask-planner`）。
- 写入"任务表"的是本地 SQLite 任务（Tauri 桌面端；浏览器环境会提示无法写入）。

## 5. Agent 增强层（模型网关 / 轨迹 / 记忆 / 工具）

> 设计总纲、分阶段计划与面试答题稿见 [docs/AGENT-ARCHITECTURE.md](../../../docs/AGENT-ARCHITECTURE.md)。
> 本节只写**当前代码里已经存在**的行为。

| 能力 | 落点 | 关键约束 |
|---|---|---|
| 模型网关 | `services/llm/chatClient.ts` | 走 `/api/chat`，system 放角色与硬性约束、user 放数据；`format` 传 JSON Schema；服务端拒绝 schema 时自动退化为 `format:'json'` 重试一次 |
| 输出契约 | `services/llm/schemas.ts` | 只使用保守关键字（object/array/string/integer/enum/required），有单测锁住，防止后续加入本地模型不支持的花哨语法 |
| 提示词版本 | `services/prompts.ts` → `PROMPT_VERSION` | 写进 trace 与 `plan.generation.promptVersion`，作为效果对比与回滚的锚点 |
| 运行轨迹 | `services/agent/trace.ts` | 记录能力级别、每步耗时与成败、工具调用、记忆命中、降级原因、prompt 版本；内存保留最近 20 条并防抖落盘，落盘失败静默忽略 |
| 记忆（情景） | `services/memory/*` + `db/plannerDB.ts` 的 `memory` store | 写入的是"结论 + 证据引用 + 置信度 + 统计事实"，不囤对话；同主题**合并**；长期未召回按 30 天/0.9 衰减，低于 0.15 归档（不召回也不删除） |
| 记忆召回 | `services/memory/memoryRetriever.ts` | 四项可解释打分（类别 0.3 / 词面 0.3 / 置信度 0.25 / 时效 0.15）+ **相关性闸门**（词面重合 < 0.1 直接排除），避免"新且自信但无关"的记忆污染上下文 |
| 记忆控制 | 设置页 `MemoryCard` | 可查看每条记忆的结论/证据/置信度/命中次数，可单条删除、一键清空、整体关闭；数据随"数据备份"导出 |
| 本地 embedding | `services/rag/embedding.ts` | 走 Ollama `/api/embed`（批量）；**内容哈希寻址缓存**（只重算变化的内容）；接口不支持时退回逐条 `/api/embeddings`；超时/5xx 不重试；失败即抛由上层降级 |
| 向量存储 | `services/rag/vectorStore.ts` | 桌面端 → Rust `agent_embeddings` 表（**余弦 Top-K 在 Rust 侧算，向量不过 IPC**）；浏览器 → IndexedDB。对上层同一套接口 |
| 混合检索 | `services/rag/hybridRetriever.ts` | 启发式名次 ⊕ 语义名次 → **RRF 融合**（k=60，绕开量纲不可比）；余弦写入 `scoreDetail.semantic` 作为第 5 维（仅记录，不改写原四维权重）；**永不抛出**，失败即回退关键词排序 |
| 语义检索设置 | 设置页 `EmbeddingSettingsCard` | 开关 / embedding 模型 / 连通性测试（报向量维度）/ 已索引条数与维度 / 一键清空索引（索引是派生数据，不进备份） |
| 正文分块 | `services/rag/chunking.ts` | 窗口 + 重叠，**优先在句子边界断开**（窗口 60% 之后才允许提前断）；单页上限 40 块；`chunkRefId` 作为稳定 id |
| 正文临时缓存 | `services/rag/contentCache.ts` | 独立 IndexedDB store，**7 天 TTL、最多 20 页、不进数据备份、可一键清除**；维护函数是纯函数 |
| 正文抓取 | `services/rag/contentFetcher.ts` | 域名白名单（**留空 = 不抓**）+ 超时 + 字数上限 + 缓存；桌面端走 Rust `fetch_page_text`（含 SSRF 防护），浏览器直连失败即降级 |
| 证据编排 | `services/rag/evidence.ts` | 白名单筛选 → 抓正文 → 分块 → 内容寻址增量嵌入 → 按 query 召回 Top-N → 生成 `E1..En` 与不可信数据块；**永不抛出** |
| 注入隔离 | `services/agent/promptGuard.ts` | 清洗控制字符与伪造的 `system:` / `<\|im_start\|>` 标记；外部内容只能以 `wrapUntrustedData` 的显式数据块进 prompt |
| 多角色协作 | `services/agent/agents/*` | Orchestrator（确定性调度，不调 LLM）+ Clarifier / Researcher / Planner / Critic；每跳 payload 过 zod；澄清由编排器用画像与记忆**自问自答并标注依据**；Critic 校验硬约束、安全类自动修、结构类最多回喂模型 2 轮；四级降级 `multi → single → pipeline → rule` |
| Agent 模式 UI | 向导表单「Agent 一键生成」+ `AgentRunPanel` | 一次跑完四角色并展示：级别 / 参与角色 / 哪些澄清是默认假设 / 校验发现与修正内容 |
| 轨迹可视化 | 设置页 `TracePanel` + `hooks/useTraces` | 最近 20 条 run 的可展开列表：能力级别 / 每步耗时与成败 / 工具调用与拒绝原因 / 降级路径与原因 / prompt 版本与 schemaApplied；可清空 |
| 离线评测 | `services/eval/*` + `npm run eval` | 7 条脚本化用例（含 2 条对抗用例）跑**生产同一套代码**（只替换模型层），产出 9 项指标并按门禁判定；已接入 CI。**边界**：衡量链路与护栏，不衡量生成质量 |
| 工具（Skill） | `services/agent/tools/*` | 显式注册才可用；scope 权限门；zod 参数校验；写工具只能产出 **diff 预览**，用户确认后经一次性令牌（5 分钟过期）提交 |
| 内置工具 | `builtin/planQueryTools.ts`（3 个只读）、`builtin/planEditTools.ts`（5 个写） | 读：`get_plan_summary` / `get_plan_resources` / `recall_memory`；写：`shift_plan_days` / `compress_daily_minutes` / `remove_task` / `rename_task` / `move_task_to_day` |
| 对话式调整 | `services/agent/adjustPlan.ts` + `components/PlanAdjustPanel.tsx` | 宿主先执行只读工具备上下文 → 模型只做"选工具 + 参数"的决策 → 过闸门 → diff 预览 → 用户确认 → 应用到**计划草稿**；模型不可用时退化为本地指令解析 |

**边界（写清楚比含糊更有用）**：

- 写工具作用在**计划草稿**上，`commit` 只是把 diff 贴回草稿；真正落库仍走用户点击"接受"后的
  `taskMaterializer → api.createTask`。也就是说 **Agent 没有新增任何写通道**。
- 资源级索引只嵌入**元数据**（标题 / 类型 / 作者 / 难度 / 摘要）；正文只以**证据分块**形式存在，
  且正文缓存在独立 store、7 天过期、可一键清除、**不进数据备份**。
- 正文抓取只对**白名单域名**生效；请求仍带浏览器 UA，站点可识别为普通访问 ——
  保证的是"不长期留存正文"，不是"匿名抓取"。
- Critic 的自动修正只覆盖**安全类**（时长超限）；项数不合理等结构问题只报告或交模型修正轮，
  **不会自动删用户的任务项**。
- 多角色是**单进程内的四个函数角色**，不是分布式 agent，也不做断点续跑；
  澄清是自问自答，`default` 依据的结论是**假设**，必须让用户核对。
- **评测的覆盖面**：`npm run eval` 的"模型"是脚本回放，因此它证明的是"链路与护栏没坏"，
  不能证明"模型换版本后效果更好"；离线向量是确定性伪向量。这条边界写在评测报告头部。
- 记忆只产出 `episodic` 一类（`semantic` 已在类型里预留）；方法论语料库、原生 function calling
  仍未做，登记在总纲的进度表里。
- **落库后的展示规则**（`planQueue.ts`）：计划任务在任务栏**只放行一条**（下一条待做），
  完成一条才出现下一条；这是"展示层队列"而不是数据裁剪 —— 全部任务都在数据库里，
  在「历史」里同样可见。分组依据是任务标签（目标短标签 + 类别），因此没有新增 `plan_id` 字段；
  代价是同一目标 + 同一类别生成两次计划会被视为同一队列（同一件事的延续，可接受）。

## 6. 测试

```bash
npm test        # vitest run
```

覆盖：`habitAnalyzer` / `planGenerator` / `localLLM` / `planToTaskPayloads` /
`clarificationService`（含降级与 JSON 容错）/ `resourceService`（三层编排与降级）/
`planComposer`（引用校验与回退）/ `llmTaskManager`（并发、取消）/
`chatClient`（/api/chat 契约、schema 透传与被拒降级）/ `agentTrace`（轨迹记录与环形缓冲）/
`memory`（写入 / 合并 / 衰减 / 召回闸门）/ `skills`（白名单、权限门、参数校验、确认令牌、diff 正确性）/
`adjustPlan`（模型路径、白名单拒绝、参数拒绝、降级为本地指令、确认后应用）/
`ragEmbedding`（内容寻址缓存、接口兼容与回退、超时不重试、探测）/
`hybridRetriever`（RRF 融合、语义重排、缓存复用、降级路径，以及 `collectResources` 的端到端接线）/
`ragEvidence`（分块边界与重叠、注入隔离、域名白名单、缓存维护、证据编排的四条降级路径）/
`agentOrchestrator`（消息契约、Critic 六类校验与安全修正、计划差异、澄清自答依据、
以及 Agent run 的"模型可用 / 不可用 / 需要修正 / 开启正文抓取"四种端到端行为）/
`evalHarness`（指标口径与边界、回放路由与未注册请求报错、伪向量确定性、
以及"用例失败不会把整轮评测搞崩"）。

评测另有一个独立入口：`npm run eval`（跑 `evalSuite.test.ts` 并打印指标报告）。

Rust 侧：`cd src-tauri && cargo test --lib`
（向量序列化 / 归一化 / 余弦 / Top-K + HTML 清洗 / 实体解码 / SSRF 判断，共 13 例）。
