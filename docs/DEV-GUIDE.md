# 开发指南

## 1. 环境准备

| 依赖 | 版本 | 备注 |
|---|---|---|
| Node.js | ≥ 20（实测 22.x 可用） | Vite 7 要求 Node ≥ 20.19 |
| Rust | stable + `cargo` | 仅桌面模式需要 |
| Windows | MSVC Build Tools（C++ 工作负载） | `rusqlite` 用 `bundled` 特性编译 SQLite，需要 C 编译器 |
| WebView2 Runtime | 随 Windows 10/11 预装 | Tauri 2 的运行时 |

## 2. 命令

```bash
npm install            # 前端依赖
npm run dev            # 前端 dev server，http://localhost:1420（strictPort，被占用会直接失败）
npm run tauri dev      # 桌面应用（会先跑 npm run dev，再编译 Rust 并启动窗口）

npm run build          # tsc && vite build → dist/
npm run tauri build    # 打包安装包
npm test               # vitest run（一次性）
npm run test:watch     # vitest（监听模式）
```

> `npm run dev` 的端口在 `vite.config.ts` 里写死为 **1420 且 `strictPort: true`**。
> 启动失败先查端口占用：`netstat -ano | findstr :1420`。

## 3. 两种运行模式的能力差异（重要）

| 能力 | `npm run dev`（浏览器） | `npm run tauri dev`（桌面） |
|---|---|---|
| 任务 CRUD | ✅ localStorage（`mood-task:tasks-browser:v1`，见 `api/browserTaskStore.ts`） | ✅ SQLite `tasks` 表 |
| 时段面板 | ✅ 落在 localStorage | ✅ 落在 SQLite `plugin_data` |
| 插件命名空间数据 | ✅ localStorage | ✅ SQLite |
| 插件注册表 | ✅ 只有 localStorage | ✅ localStorage 镜像 + AppData 文件（文件为真源） |
| 用户资料 / 头像 | ✅ localStorage（`mood-task:user-profile:v1` / `mood-task:user-avatar:v1`） | ✅ AppData（`user_profile.json` + `avatars/`） |
| 计划生成器（IndexedDB + Ollama） | ✅ | ✅ |
| 资源检索第一层（B 站） | ⚠️ 直连必被 CORS 拦，降级到跳转按钮 | ✅ 经 Rust 侧代理 `search_bilibili` |
| 资源检索第二层（SearXNG） | ⚠️ 直连被 CORS 拦，静默跳过 | ✅ 经 Rust 侧代理 `search_searxng` |
| 计划写入任务表 | ❌ 有意阻止（`taskMaterializer` 判定非桌面环境即直接返回失败） | ✅ |

**因此：两种模式的数据互不相通**（浏览器 localStorage ↔ 桌面 SQLite）。浏览器模式现在足以调样式、
调纯前端逻辑，并走通任务 CRUD 与计划生成器；但凡是涉及 SQLite 落库、Rust 命令、文件系统（AppData）
的改动，仍必须用 `npm run tauri dev` 验证。

## 4. 计划生成器的联网资源（Rust 侧代理）

第一层（B 站）与第二层（SearXNG）的网络请求**全部走 Rust 侧**，不从前端 fetch：

```
前端 bilibiliSource / searxngSource
  └─ isTauriRuntime() ?
       ├─ 是 → invoke('search_bilibili' | 'search_searxng')
       │        └─ Rust http::fetch_json（reqwest + native-tls，不受同源策略约束）
       └─ 否 → 直连 fetch（浏览器必被 CORS 拦，静默降级，属预期）
```

**为什么必须在 Rust 侧**：浏览器 / WebView 的同源策略无法绕过——B 站不返回
`Access-Control-Allow-Origin`，且 `Origin`/`Referer` 属受保护头，JS 改不了。
Rust 侧没有这个概念，还能自由设置请求头。

### 关键实现点

- `src-tauri/src/http.rs`：全局 `OnceLock<reqwest::Client>` 复用连接池与 TLS 会话。
- `Cargo.toml` 里 **必须显式声明 reqwest 并开启 TLS**：
  ```toml
  reqwest = { version = "0.12", default-features = false, features = ["json", "native-tls"] }
  ```
  tauri 会传递引入 reqwest，但**一个 TLS feature 都不开**——直接用它请求 `https://` 会失败，
  而且这个坑很隐蔽（编译能过，运行才报错）。
- B 站用 `wbi/search/type`（实测**无需 wbi 签名**即返回 `code:0`）。
  旧接口 `/search/all/v2` 与 `/nav` 对无 Cookie 请求返回 403，故不再使用。
- 失败一律返回 `Err(String)`，前端静默降级并写入 `ResourceBundle.warnings`，不阻断向导。

### SearXNG 部署（本机实例）

配置在 `D:\daima\searxng\settings.yml`（宿主机目录绑定，非 named volume）：

```bash
docker run -d --name searxng -p 8888:8080 -v D:/daima/searxng:/etc/searxng searxng/searxng
```

改配置后 `docker restart searxng` 生效。三处**必须**正确：

```yaml
use_default_settings: true
server:
  secret_key: "随机字符串"   # 必填，否则启动报错
  limiter: false            # 关限流，否则 403 / 响应无 CORS 头
search:
  formats: [html, json]     # ← 不写 json 则 /search?format=json 永远 403
engines:                    # ← 引擎是关键，见下表
  - name: 360search
    disabled: false
```

**国内引擎实测（2026-09-16）**：SearXNG 默认启用的通用引擎在国内几乎全废。
「HTTP 200 但 0 结果」基本都是引擎问题，不是配置格式问题。

| 引擎 | 结论 |
|---|---|
| `360search` | ✅ **唯一稳定可用**，每次 4 条，质量高 |
| `quark` | ⚠️ 间歇无响应，建议关 |
| `baidu` | ❌ 首查即 CAPTCHA，暂停 1 小时 |
| `bing` | ❌ 200 但 0 条（重定向到 cn.bing，解析器扑空） |
| `sogou` | ❌ 引擎代码 bug（`AttributeError: resp.next_request`） |
| `duckduckgo`/`brave`/`wikipedia`/`wikidata`/`google cse`/`lingva` | ❌ 被墙，白等 3s 超时 |

排查手法：
```bash
docker logs searxng 2>&1 | grep -i "engine\|timeout\|error"    # 看引擎级报错
curl "http://localhost:8888/config"                            # 看哪些引擎 enabled
curl "http://localhost:8888/search?q=test&format=json&engines=360search"  # 单引擎隔离
```

### 本地 Ollama（可选，默认关闭）

`llmClient.ts` 默认指向 `http://127.0.0.1:11434`。没启动 Ollama 时控制台会出现
`ERR_CONNECTION_REFUSED`，属预期（`DEFAULT_LLM_CONFIG.enabled = false`，且 `probeOllama`
把失败转成 `{ok:false}` 返回给 UI，无未捕获异常）。要用就 `ollama serve`。

## 5. 调试

| 想查什么 | 怎么做 |
|---|---|
| 前端日志 | 桌面模式下右键窗口 → 检查元素（devtools）；或看启动终端 |
| Rust 日志 | `println!` / `eprintln!` 输出到 `npm run tauri dev` 的终端 |
| 数据库内容 | 用 [DB Browser for SQLite](https://sqlitebrowser.org/) 打开 `%LOCALAPPDATA%\com.moodtask.app\data.db` |
| 插件注册表 | `%APPDATA%\com.moodtask.app\plugins\installed.json`；浏览器模式看 localStorage 的 `mood-task:plugins:v1` |
| 插件数据 | SQLite 表 `plugin_data`；浏览器模式看 `mood-task:plugin-data:v1:*` |
| 计划生成器数据 | devtools → Application → IndexedDB → `mood-task-planner` |
| 主题为什么没生效 | devtools 看 `<html>` 上的 class / data 属性，以及 `<head>` 里的 `<style data-plugin-theme>` |

**重置到干净状态**：

```text
删 %LOCALAPPDATA%\com.moodtask.app\data.db      ← 任务 / 心情 / 插件数据（不可恢复）
删 %APPDATA%\com.moodtask.app\plugins\           ← 插件注册表
删 %APPDATA%\com.moodtask.app\user_profile.json  ← 用户资料
devtools 里清 localStorage 与 IndexedDB          ← 插件镜像 / 任务(浏览器模式) / 用户资料 / 计划生成器
```

## 6. 测试

现状：`package.json` 有 `vitest` 依赖和脚本，但**没有 vitest 配置文件**，`vite.config.ts`
里也没有 `test` 字段。这没问题——`vitest` 会自动复用 `vite.config.ts`（拿到 `@` 别名），
且现有测试**不依赖 DOM**，跑在默认 node 环境。

```bash
npm test                        # 8 个文件 / 91 个用例，约 1.4s
```

已有覆盖（全部在 `src/features/plan-generator/__tests__/`）：

| 文件 | 覆盖内容 |
|---|---|
| `planGenerator.test.ts` | 规则生成器（兜底路径） |
| `habitAnalyzer.test.ts` | 习惯画像推断 |
| `localLLM.test.ts` | LLM 响应解析与合并 |
| `planToTaskPayloads.test.ts` | 计划 → 任务载荷映射 |
| `clarificationService.test.ts` | 澄清问题 + 降级 + JSON 容错 |
| `resourceService.test.ts` | 三层资源检索、打分、去重、降级 |
| `planComposer.test.ts` | 计划合成、引用校验、回退 |
| `llmTaskManager.test.ts` | 并发、去重、取消 |

**实践约定**：新逻辑优先写成纯函数（放 `services/` 或 `utils/`），在 `__tests__/` 里加用例。
测试配置在 `vitest.config.ts`（`environment: 'node'`，**不引 jsdom**）——依赖 DOM / IndexedDB /
Tauri IPC 的模块请在用例内**自己注入桩对象**，参考：

- `plugins/runtime/__tests__/dataStore.test.ts`：内存版 `localStorage`（配合 `vi.stubGlobal`）
- `api/__tests__/index.test.ts`：`vi.hoisted` + `vi.mock('@tauri-apps/api/core')` 替掉 IPC；
  并用 `declareTauriRuntime()` / `declareBrowserRuntime()` 显式声明 `window.__TAURI_INTERNALS__`，
  分别覆盖"桌面 IPC"与"浏览器 localStorage 兜底"两条分支。**不声明就默认走浏览器分支**，mock 的 `invoke` 不会被调用——写 api 层用例时容易踩。

要做真正的组件测试，需要另加 `jsdom` + `@testing-library/react` 并覆盖 `environment`。

## 7. 代码规范（当前约定，非强制工具）

- **TypeScript 严格模式**：`strict` + `noUnusedLocals` + `noUnusedParameters`，
  `npm run build` 会因任何类型错误中断。**提交前至少跑一次 `npx tsc --noEmit`。**
- **路径别名**：`@/*` → `src/*`（`vite.config.ts` 与 `tsconfig.json` 两处都有，改一处要同步）。
- **注释风格**：每个模块文件顶部有一段块注释，说明"这个文件负责什么 + 关键设计约束"；
  中文注释为主。**新增文件请沿用这个习惯**，它是本仓库的主要文档来源。
- **组件**：函数组件 + `React.FC<Props>`；长列表用 `React.memo` + 稳定引用。
- **存储访问**：不要在新代码里直接 `localStorage.setItem`，走 `PluginDataStore`
  （它同时处理 Tauri/浏览器两条路径与权限校验）。
- **不引入新的全局状态库**：现状是"自定义类 + Context"，插件宿主已经是这个模式的事实标准。

**尚未建立（改进项）**：ESLint、Prettier、commit 规范、CI。见 `docs/TODO.md`。

## 8. 常见故障排查

| 症状 | 原因 / 处理 |
|---|---|
| `npm run dev` 起不来 | 1420 被占用；`strictPort: true` 不会自动换端口 |
| 浏览器里建的任务在桌面版看不到 | 两种模式存储不同（localStorage ↔ SQLite），数据不互通，属预期 |
| 控制台报 `Cannot read properties of undefined (reading 'invoke')` | 有代码在浏览器里直接调 Tauri API。必须先用 `isTauriRuntime()`（`src/utils/runtime.ts`）守卫，并在分支内**动态** `await import('@tauri-apps/plugin-fs')`，参考 `hooks/useUserProfileTauri.ts` |
| 改了 Rust 命令没生效 | 检查是否注册到 `lib.rs` 的 `generate_handler![]`（`main.rs` 只是薄封装，没有注册表） |
| 改完字段前端拿到 `undefined` | 忘了同步 `api/index.ts` 的映射，或 Rust 侧 `from_row` 漏了列 |
| 插件安装报"数据能力被拒绝" | 清单 `collections` / `operations` 与代码实际访问的不一致 |
| 插件安装报"要求核心版本 >= x" | `minCoreVersion` / `maxCoreVersion` 与 `CORE_VERSION`（`plugins/runtime/types.ts`）不匹配，`PluginHost.installPlugin()` 会**拒绝安装**。改清单或升核心版本 |
| 任务"完成于"显示的日期像是创建日 | `completed_at` 为空时会回退显示 `created_at`。检查 `TaskList` 完成流程是否写入了 ISO 时间；取消完成会主动清空该列 |
| 导入备份后"没看到变化" | 恢复是**合并**不是重建：任务按 `标题+创建时间` 去重、同 key 覆盖。已存在的重复任务不会新增，重新进入页面即可看到新增项 |
| 心情记录突然全空 | 心情真源是插件命名空间 `mood/entries`；`mood-diary` 插件被停用/卸载时统计页会刻意降级为空 |
| 主题出现残留样式 | 卸载插件会撤销痕迹；若仍有残留，检查 `<head>` 里 `style[data-plugin-theme]`，宿主每次应用都会自愈清理 |
| 头像不显示 | 文件必须在 `%APPDATA%\com.moodtask.app\avatars\`；且 `capabilities/default.json` 要包含 `fs:allow-appdata-read-recursive` 等权限 |

## 9. 附：本机（Windows + 自动化助手）踩坑记录

这些是在本机实际遇到的工具链问题，用脚本/命令批量改代码时务必注意。

| 现象 | 说明与对策 |
|---|---|
| Git Bash 不可用 | `dirname` / `ls` / `head` / `cat` 等 coreutils 缺失，`cd` 失败。不要用 shell 做目录遍历，改用 Read / Glob / Grep 工具 |
| PowerShell 工具 stdout 不回传 | 命令会执行（退出码正常）但拿不到输出；只有"简单 cmdlet 链 + `Out-File` 到文件"可靠 |
| **Glob 工具返回值不可靠** | 实测 `capabilities/**`、`build.rs`、`icons/*` 这类模式会误报"No files found"（文件其实存在）。**判断目录是否存在，请用 `readdirSync` 或直接 Read 目标文件** |
| 同一文件多次 Edit 会静默丢失 | 对同一文件连续发多条 Edit，可能只有部分生效且全部报 success。**同一文件多处改动请用 Write 重写，或写补丁脚本一次改完**（改完必须回读校验） |
| CRLF / LF 混用 | 仓库里 `.rs` / `.vue` 类文件可能是 CRLF，markdown 多为 LF。写补丁脚本时先探测换行符，否则锚点命中 0 次却不报错 |
| 中文路径 | 项目路径含中文时，shell 间传参易被编码破坏；脚本里用绝对路径，并让 Node 负责引号与转义 |

**推荐的验证姿势**（不依赖 shell 输出）：

```js
// 用一个临时 .cjs 跑构建/测试，把输出写进日志文件，再用 Read 工具读日志
const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], {
  cwd: 'D:/daima/mood-task-app', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
require('fs').writeFileSync('D:/daima/mood-task-app/.tmp.log',
  `EXIT ${r.status}\n${r.stdout}\n--STDERR--\n${r.stderr}`);
```
