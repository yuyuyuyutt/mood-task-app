# 高山仰止 · 任务与心情管理（mood-task-app）

一款 **Tauri 2 + React 19 + TypeScript** 的本地优先桌面应用：任务管理、习惯打卡、时段面板、
心情日记、数据统计，以及一个**声明式插件宿主**与**个性化计划生成器**。

> 全部数据留在本机。默认不联网；只有用户显式打开「资源与联网」中的联网层，才会发出检索请求。

---

## 快速开始

```bash
npm install          # 安装前端依赖（首次还需 rust 工具链，见 docs/DEV-GUIDE.md）
npm run dev          # 仅前端：Vite dev server（http://localhost:1420，strictPort）
npm run tauri dev    # 完整桌面应用（前端 dev server + Rust 后端 + SQLite）

npm run build        # 类型检查 + 前端产物到 dist/
npm run tauri build  # 打包桌面安装包
npm test             # 单元测试（vitest run）
```

| 命令 | 作用 | 说明 |
|---|---|---|
| `npm run dev` | 前端热更新 | 浏览器里跑时，存储自动降级为 `localStorage`（无 SQLite） |
| `npm run tauri dev` | 桌面开发 | 唯一能体验 SQLite、文件系统、真实插件落盘的入口 |
| `npm run build` | `tsc && vite build` | 任何类型错误都会中断构建（`strict` + `noUnusedLocals`） |
| `npm run tauri build` | 出安装包 | 依赖 `src-tauri/capabilities/default.json` 的权限声明 |
| `npm run typecheck` | `tsc --noEmit` | 只做类型检查，不产出文件（CI 用这个） |
| `npm test` | `vitest run` | 覆盖计划生成器 + api 映射 + 插件数据权限门 + 版本比较 + 备份校验 |
| `npm run version:check` | 校验版本号 | 真源是 `src-tauri/tauri.conf.json`；`npm run version:sync` 一键同步另两处 |

> Rust 侧没有放进 CI（需要系统级 WebKitGTK 依赖），本地请跑：
> `cd src-tauri && cargo check --message-format=short`。

---

## 顶层结构

```
mood-task-app/
├─ src/                    # 前端源码（React + TS），详见 docs/ARCHITECTURE.md
│  ├─ api/                 # 数据访问层：任务 CRUD（唯一碰 SQLite 的地方）/ 时段面板
│  ├─ components/          # 通用组件（布局、任务、心情、插件）
│  ├─ pages/               # 5 个内置页面（路由终点）
│  ├─ plugins/             # 插件系统：parser（清单解析）/ runtime（宿主）/ builtin / pages
│  ├─ features/plan-generator/  # 个性化计划生成器（独立子域，自带 README 与测试）
│  ├─ hooks/ · utils/ · types/
├─ src-tauri/              # Rust 后端：SQLite、命令、权限
│  ├─ src/lib.rs           # ← 应用唯一入口（模块、插件挂载、全部命令注册、run()）
│  ├─ src/main.rs          # 4 行薄封装：调用 mood_task_app::run()
│  ├─ src/commands.rs      # 全部 #[tauri::command]（11 个）
│  ├─ src/database.rs      # 连接池 + 建表 + user_version 顺序迁移 + 行映射
│  └─ capabilities/default.json  # Tauri 2 ACL 权限声明
├─ scripts/                # sync-version.mjs（版本号唯一真源同步）
├─ .github/workflows/ci.yml  # CI：版本校验 → 类型 → 单测 → 构建
└─ docs/                   # 维护与开发文档（见下表）
```

---

## 文档索引

| 文档 | 什么时候看 | 内容 |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 第一次接触代码 / 想加一个页面 | 分层结构、启动时序、插件宿主内部机制、目录职责速查 |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | 改数据库、加字段、排查"数据去哪了" | SQLite 表结构、IndexedDB、localStorage、AppData 文件、四层存储全景 |
| [docs/IPC-API.md](docs/IPC-API.md) | 加/改一个前后端命令 | 全部命令契约、参数命名规则、返回结构、错误约定 |
| [docs/PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md) | 写插件 / 改内置插件 | 清单字段、四类能力、校验规则、沙箱协议、可直接抄的模板 |
| [docs/DEV-GUIDE.md](docs/DEV-GUIDE.md) | 日常开发、调试、踩坑 | 环境准备、调试手法、本机 Windows 特有的坑、代码规范 |
| [docs/TODO.md](docs/TODO.md) | 排期 / 接手前先读 | 技术债清单、已知缺陷、建议的下一步 |

---

## 三个必须先理解的概念

**1. 双后端存储。** 同一套前端代码跑在两种环境：Tauri 桌面端（SQLite + 文件系统）与浏览器
（`localStorage`）。判定统一走 `src/utils/runtime.ts` 的 `isTauriRuntime()`。
**凡是新增持久化代码，都要同时给出两种实现**，否则浏览器开发模式下会静默失效。

**2. 插件是"声明式"的。** 插件清单（TOML）不携带可执行代码，宿主按清单解释执行四类能力：
`theme`（主题）、`page`（页面）、`data`（命名空间数据）、`code`（沙箱 JS）。因此插件天然不能
触碰主应用 DOM，能力边界由宿主代码定义，而不是靠"信任插件作者"。详见 PLUGIN-GUIDE。

**3. 页面路由由插件参与生成。** 内置 5 个页面是硬编码路由；插件贡献的页面通过
`usePluginRoutes()` 在 `<Routes>` 内展开。**"心情日记"页面本身就是插件化的**——它作为
内置插件 `mood-diary` 存在，卸载它 `/mood` 路由与导航项一起消失。

---

## 质量基线（2026-09-14 实测）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 error |
| Lint | `npm run lint` | ✅ 0 error / 25 warning（存量 `any` 与 hooks 依赖告警） |
| 单元测试 | `npm test` | ✅ 12 个文件 / 120 个用例全部通过，约 0.7s |
| 版本号一致性 | `npm run version:check` | ✅ 三处均为 0.1.3 |
| Rust | `cd src-tauri && cargo check` | ✅ 0 error / 0 warning |
| CI | `.github/workflows/ci.yml` | 前四项在 push / PR 上自动执行 |

**尚未建立**：Prettier（格式交给编辑器）、E2E / 组件测试（需 jsdom + testing-library）、覆盖率统计。

---

## 更新日志

- **0.1**：完成主体框架的架构和设计
- **0.11**：接入本地 **SQLite** 数据库
- **0.15**：完善插件系统，加入包含沙箱的安全机制
- **0.1.2**：新增「时段面板」独立数据域（复用插件数据基础设施）、插件数据保留期（回收站）、
  个性化计划生成器三阶段向导（澄清 → 三层资源检索 → 计划生成并落库）、窗口化列表与
  空闲调度等性能优化
- **0.1.3（当前）**：
  - 正确性：`completed_at` 全链路打通（历史列表不再显示创建日）
  - 架构：Rust 收敛为单一入口（`lib.rs`）；命令精简为 11 个并新增增量 `patch_task`
  - 数据：心情数据收敛到插件命名空间，SQLite `moods` 表废弃并一次性迁移；
    `PRAGMA user_version` 顺序迁移机制上线
  - 安全：沙箱消息来源校验、插件核心版本校验、删除空实现的签名校验（含死代码清理）
  - 体验：设置项持久化、统计页真实趋势且时间范围生效、外链走 opener、路由改 Hash
  - 能力：新增全量数据导出 / 导入备份
  - 工程：ESLint、CI、`vitest.config.ts` 与 29 个新用例、移除 10 个未使用依赖
- **文档**：`docs/` 全套维护与开发文档随代码同步更新
