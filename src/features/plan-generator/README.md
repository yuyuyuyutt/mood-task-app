# 个性化计划生成器（三阶段向导）

目标 → **澄清问题** → **资源检索（三层）** → **计划生成（含策略与引用）** → 按日期写入任务表。

## 模块结构

```
src/features/plan-generator/
├─ components/
│  ├─ PlanGeneratorWorkspace.tsx      # 向导编排（表单 / 三步 / 已生成计划 / 落库）
│  ├─ NetworkingSettingsCard.tsx      # 设置页「资源与联网」
│  ├─ ResourceLibraryPanel.tsx        # 我的资源库（手动添加）
│  ├─ UserTypeCard.tsx                # 设置页「个人画像」
│  └─ wizard/{WizardProgress,ClarifyStep,ResourceStep,PlanStep}.tsx
├─ services/
│  ├─ prompts.ts            # 所有 LLM 提示词集中管理
│  ├─ llmClient.ts          # Ollama 传输层（探测 / 生成 / 超时 / keep_alive）
│  ├─ llmTaskManager.ts     # LLM 生命周期管理（串行、去重、取消、空闲调度）
│  ├─ jsonExtract.ts        # 容错 JSON 解析（代码块 / 尾随逗号 / 字段夹紧）
│  ├─ clarificationService.ts   # 阶段 1
│  ├─ resourceService.ts        # 阶段 2 编排：关键词 + 打分 + 去重 + 分组 + 截断
│  ├─ resources/{jumpLinks,bilibiliSource,searxngSource}.ts   # B 站 / SearXNG：桌面端走 Rust 代理
│  ├─ planComposer.ts           # 阶段 3（引用校验 + 策略补齐 + 规则回退）
│  ├─ planGenerator.ts / templates.ts   # 规则生成器（兜底）
│  └─ planToTaskPayloads.ts / taskMaterializer.ts  # 写入任务表
├─ hooks/{useHabitProfile,useNetworkingSettings,useResourceLibrary,usePlans}.ts
└─ db/plannerDB.ts          # IndexedDB（kv / plans / resources）
```

## 1. 配置 SearXNG（第二层，可选）

```bash
# 1) 运行实例（容器内监听 8080，映射到宿主机 8888）
docker run -d --name searxng -p 8888:8080 \
  -v "$(pwd)/searxng:/etc/searxng" \
  -e "BASE_URL=http://localhost:8888/" \
  -e "INSTANCE_NAME=moodtask" \
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
| 任意请求 | 超过 `timeoutMs`（默认 5000ms） | `AbortController` 立即中止 → 走上述降级，不阻塞向导 |

> 所有 LLM 调用都经 `llmTaskManager`（串行 + 空闲调度 + 单 key 去重 + 离开向导即 `cancelAll`），
> 且 Ollama 请求带 `keep_alive: '30s'`，模型空闲 30 秒后自动卸载，不常驻占用 CPU。

## 4. 隐私要点

- 默认**不联网**（只启用第三层跳转按钮）；开启联网层时 UI 明确提示会发送"检索关键词"。
- 不存储任何抓取到的网页正文，只保存标题 / URL / 作者 / 时长 / 播放量 / 发布时间等元数据。
- 计划、画像、反馈、资源库全部保存在本机 IndexedDB（`mood-task-planner`）。
- 写入"任务表"的是本地 SQLite 任务（Tauri 桌面端；浏览器环境会提示无法写入）。

## 5. 测试

```bash
npm test        # vitest run
```

覆盖：`habitAnalyzer` / `planGenerator` / `localLLM` / `planToTaskPayloads` /
`clarificationService`（含降级与 JSON 容错）/ `resourceService`（三层编排与降级）/
`planComposer`（引用校验与回退）/ `llmTaskManager`（并发、取消）。
