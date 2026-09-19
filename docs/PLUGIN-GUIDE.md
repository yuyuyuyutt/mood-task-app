# 插件开发指南

> 宿主核心版本 `CORE_VERSION = 1.0.0`，定义在 `src/plugins/runtime/types.ts`。
> 清单解析入口：`src/plugins/parser/`（`parser.ts` 流程 → `validator.ts` 校验）。

## 1. 心智模型：两种插件

| | 声明式能力（推荐） | 沙箱代码插件 |
|---|---|---|
| 能力 | `theme` / `page` / `data` | `code`（当前仅 `kind = 'theme'`） |
| 插件携带 | **只有 TOML 清单**，没有代码 | 一段 JS 源码（`inline` 或 `url`） |
| 执行者 | 宿主解释器（受信任代码） | 插件自己的代码，跑在 sandbox iframe 里 |
| 安全边界 | 清单**无法**注入脚本/HTML，能力完全由宿主定义 | opaque-origin iframe，无法访问主应用 DOM / storage / cookie |
| 适用 | 99% 的场景：换主题、加页面、存数据 | 需要"用代码动态生成样式"的艺术型主题 |

**关键结论**：你**不能**通过插件往主应用里塞组件。`capabilities.page` 只声明"我要一个 `/mood` 页面"，
真正渲染什么由宿主 `runtime/pages.tsx` 的注册表决定——未登记的 `pageId` 会渲染安全占位页。
想加一个新页面组件，必须改主应用代码（见 §7）。

## 2. 最小可用插件

```toml
[metadata]
id = "my-plugin"                  # 1–32 字符，仅小写字母/数字/-/_
name = "我的插件"                  # ≤ 64
version = "1.0.0"                 # 必须 semver
author = "你的名字"                # ≤ 64
description = "这一行至少要有十个字符，否则校验不通过"   # 10–2000
createdAt = "2026-01-01T00:00:00Z"                     # 必须是 ISO datetime

[metadata.compatibility]
minCoreVersion = "1.0.0"

[frontend]
entry = "capability://theme"      # 声明式插件的约定写法；否则须是 .js/.ts/.tsx 等
type = "widget"                   # widget|sidebar|modal|tab|toolbar|context-menu|hotkey

[capabilities.theme]
type = "theme"
mode = "dark"
className = "dark"
```

把它另存为 `.toml`，在「插件管理 → 安装 → 从文件」导入即可。

## 3. 清单字段速查

### `[metadata]`

| 字段 | 必填 | 约束 |
|---|---|---|
| `id` | ✅ | `/^[a-z0-9-_]+$/`，≤ 32。**不可与已有插件重名**（同 id 视为覆盖安装） |
| `name` | ✅ | 1–64 |
| `version` | ✅ | semver（`1.0.0` / `1.0.0-beta.1` / `1.0.0+build`） |
| `author` | ✅ | 1–64 |
| `description` | ✅ | **10–2000**（少于 10 字直接报错） |
| `homepage` | | 合法 URL |
| `license` | | ≤ 64 |
| `createdAt` / `updatedAt` | `createdAt` ✅ | ISO datetime |
| `compatibility.minCoreVersion` | ✅ | semver |
| `compatibility.maxCoreVersion` | | semver，且必须 ≥ min |
| `compatibility.testedVersions` | | semver 数组，默认 `[]` |
| `signature` | | `{ algorithm: RSA\|ECDSA\|Ed25519, signature, publicKey }`（**当前未启用校验**） |

### 其他段

| 段 | 现状 |
|---|---|
| `[dependencies]` | 仅做格式校验与"不能依赖自己"的检查，**不做实际依赖解析** |
| `[permissions]` | 仅做格式校验；`*` 通配、`shell: true` 等会得到**安全警告**而非拦截 |
| `[frontend]` | `entry` + `type` 必填。`entry` 为 `capability://...` 时跳过扩展名检查 |
| `[backend]`、`[hooks]` | ⚠️ **声明了也只是被安全忽略**，并产生 `EXECUTABLE_IGNORED` 警告。宿主不执行插件后端代码 |
| `[assets]` | 图标/截图元数据；缺 64×64 图标会有警告 |

## 4. 四类能力

### 4.1 `[capabilities.theme]` — 主题

| 字段 | 约束 | 作用 |
|---|---|---|
| `type` | 固定 `"theme"` | |
| `mode` | ✅ `light` \| `dark` | 主题模式（决定 `ThemeState.mode`） |
| `className` | ≤ 64 | 加到 `<html>` 的类名，如 `dark` |
| `dataAttribute` / `attributeValue` | ≤ 64 | 写到 `<html>` 的 data 属性 |
| `followSystem` | 默认 `true` | |
| `variables` | key ≤ 128、value ≤ 256 | CSS 变量，如 `"--accent" = "#C6FF00"` |
| `styleSheet` | **≤ 300 KB** | 随启停注入/移除整段 CSS |

行为：**同时只有一个主题插件生效**（按安装顺序取最后一个启用者）。禁用/卸载会精确撤销
自己写下的类名、data 属性、CSS 变量和 `<style>` 元素。

> 四个视觉字段全空会得到 `INERT_THEME_CAPABILITY` 警告（启用后没有任何可见效果）。

### 4.2 `[capabilities.page]` — 页面

| 字段 | 约束 |
|---|---|
| `pageId` | ✅ `/^[a-z0-9-_]{1,48}$/`，**必须在宿主注册表 `PAGE_RENDERERS` 中存在**，否则渲染占位页 |
| `title` | ✅ 1–64，导航显示名 |
| `path` | ✅ `/^\/[a-z0-9-_/]{0,63}$/`，必须以 `/` 开头；含 `..` 直接报错 |
| `icon` | 白名单：`smile` `calendar` `tasks` `chart` `plug` `settings` `home` `moon` |
| `description` | ≤ 500 |
| `showInNav` | 默认 `true` |

当前注册表里只有 **`mood-diary`** 一个。想新增页面组件见 §7。

### 4.3 `[capabilities.data]` — 命名空间数据

| 字段 | 约束 |
|---|---|
| `namespace` | ✅ `/^[a-z0-9-_]{1,32}$/`，**禁止 `core` 与 `__` 前缀**（宿主保留） |
| `collections` | 1–32 项，每项 `/^[a-z0-9-_]{1,64}$/`；**不声明则拒绝一切数据访问** |
| `operations` | `read` / `write` / `delete` 子集，默认 `['read']` |
| `retentionDays` | 0–90，默认 **3**。卸载后数据保留这么久 |

权限在**每次调用时**实时校验（不是安装时一次性校验），因此插件被卸载后立即失去数据访问权。
请求 `delete` 权限会有 `DANGEROUS_DATA_DELETE` 警告。

### 4.4 `[capabilities.code]` — 沙箱代码（进阶）

```toml
[capabilities.code]
type = "code"
kind = "theme"          # 目前仅支持 theme
sandbox = true          # 必须为 true；写 false 直接报错 UNSANDBOXED_CODE
permissions = ["theme"]
inline = '''
SDK.applyTheme({ mode: 'dark', className: 'my-theme', tokens: { '--accent': '#C6FF00' }, css: '...' });
'''
```

| 字段 | 约束 |
|---|---|
| `inline` / `url` | **必须恰好提供一个**（都给 `AMBIGUOUS_CODE_SOURCE`，都不给 `MISSING_CODE_SOURCE`）；`inline` ≤ 200 KB |
| `url` | 合法 URL；非 `https` 会有 `INSECURE_CODE_URL` 警告 |

**⚠️ `inline` 请用 TOML 字面量多行字符串 `'''...'''` 书写。** 普通字符串会做 `\n` 等转义，
把源码里 `join('\n')` 这类字面量破坏成真换行。

## 5. 沙箱消息协议

宿主 `SandboxHost` 为每个 `inline` 插件创建一个隐藏 iframe：
`sandbox="allow-scripts"`（**没有 `allow-same-origin`** ⇒ opaque origin ⇒ 插件拿不到主应用
DOM / `localStorage` / cookie），并用 `srcdoc` 注入一段 SDK：

```js
window.SDK = {
  id, token,                                   // 一次性 token，挂载时生成
  applyTheme(spec),                            // → 宿主 ThemeController.applyDynamic()
  log(...args)                                 // → 宿主 console.info
};                                             // Object.freeze，插件不可篡改
```

`spec` 结构（`SandboxThemeSpec`）：

| 字段 | 说明 |
|---|---|
| `mode` | `'light'` \| `'dark'` |
| `className` | 加到 `<html>` |
| `tokens` | CSS 变量表（`{'--x': '#fff'}`） |
| `accent` | 简写，等价 `tokens['--accent']` |
| `css` | 整段样式表，会被注入 `<style data-plugin-theme="<pluginId>">` |

消息格式与宿主接受的类型：

```js
window.parent.postMessage({ __plugin: id, __token: token, type: 'theme:apply', payload: spec }, '*');
window.parent.postMessage({ __plugin: id, __token: token, type: 'log', payload: [...] }, '*');
```

宿主 `route()` 的处理：先按 `__plugin` 找已挂载的 frame；**内联插件校验 `__token`**，
不匹配就丢弃；只处理 `theme:apply` 与 `log`，其余静默忽略。运行时 `window.onerror`
会被 SDK 捕获并作为 `log` 回传，方便排查。

**远程（`url`）插件不注入 SDK、没有 token**，需要作者按协议自行 `postMessage`。
这类消息**不做 token 校验**（见 §8 安全提示）。

## 6. 生命周期

```
安装 ── 解析 TOML → zod schema → 业务校验 → install()
        ├─ 若存在墓碑（保留期内卸载过）→ 自动恢复数据
        └─ 覆盖安装保留原启用状态；全新安装默认启用
启用/禁用 ── 用户操作 → registry.setEnabled() + host.flush()（立即生效，不等空闲调度）
卸载 ── 撤销主题痕迹 + 卸载 iframe + 写墓碑（数据保留 retentionDays 天）
       └─ 回收站："立即清除" → purgeNow() 立即按命名空间删数据
```

安装渠道（`pages/PluginManager.tsx`）：
1. **内置一键安装**：`src/plugins/builtin/*.toml` 三个（深色主题 / 心情日记 / 黑白线框·荧光），
   `installFromToml` 走空闲解析。
2. **从文件**：`parsePluginFile(file)`。
3. **从 URL**：`parsePluginFromURL(url)`，`fetch` 后当文本解析。

## 7. 给宿主新增一个"插件可用页面"

"插件贡献页面"需要宿主先提供受信任的组件，步骤固定：

1. 新建组件 `src/plugins/pages/MyPage.tsx`，用 `usePluginData('<pluginId>')` 拿数据访问句柄。
2. 在 `src/plugins/runtime/pages.tsx` 的 `PAGE_RENDERERS` 里登记：
   `'my-page': lazy(() => import('../pages/MyPage').then(m => ({ default: m.MyPage })))`。
3. 插件清单声明 `[capabilities.page] pageId = "my-page"` + 唯一 `path`。
4. 若需要数据，再声明 `[capabilities.data]`，namespace 与组件里 `usePluginData` 的 id 对应。
5. 跑一次 `tsc --noEmit`；路由会在插件启用后自动出现（`usePluginRoutes()`）。

参考实现：`mood-diary`（清单 + `MoodDiaryPage` + `PAGE_RENDERERS` 三处齐备）。

## 8. 校验错误码速查

**错误（拒绝安装）**：`SCHEMA_ERROR`、`TOML_PARSE_ERROR`、`FILE_TOO_LARGE`、
`INVALID_COMPATIBILITY`（min > max）、`CIRCULAR_DEPENDENCY`（依赖自己）、
`UNSAFE_PAGE_PATH`（path 含 `..`）、`RESERVED_NAMESPACE`（core / `__` 前缀）、
`UNSANDBOXED_CODE`、`AMBIGUOUS_CODE_SOURCE`、`MISSING_CODE_SOURCE`。

**警告（仍可安装，UI 会提示）**：`DANGEROUS_PERMISSION`、`WARNING_BROAD_NETWORK`、
`WARNING_BROAD_FS_READ`、`WARNING_SHELL_ACCESS`、`UNUSUAL_ENTRY_EXTENSION`、
`MISSING_ICON_SIZE`、`INERT_THEME_CAPABILITY`、`DANGEROUS_DATA_DELETE`、
`INSECURE_CODE_URL`、`EXECUTABLE_IGNORED`。

**排查表**：

| 症状 | 多半原因 |
|---|---|
| 安装后主题没变化 | 四个视觉字段全空；或有另一个主题插件排在后面（只有最后一个生效） |
| 导航里没有我的页面 | 未设置 `showInNav`；或 `path` 与核心路由冲突（核心优先）；或 `pageId` 与他人在前 |
| 页面打开是黄色占位块 | `pageId` 不在 `PAGE_RENDERERS` 中（宿主没有对应组件） |
| 数据读写报"未声明 data 能力" | 忘了写 `[capabilities.data]`，或 `collections` 里没包含该集合，或 `operations` 缺写权限 |
| 代码主题报错说源码变了 | `inline` 用了普通字符串而非 `'''...'''`，`\n` 被转义 |
| 卸载后数据还在 | **这是设计**：保留期默认 3 天，去回收站点"立即清除"才会删 |

## 9. 当前安全边界与已知弱点

| 项 | 现状 | 影响 |
|---|---|---|
| 清单是否携带代码 | 声明式能力**完全不携带**；`backend` / `hooks` 只警告不执行 | ✅ 安全 |
| 沙箱隔离 | `allow-scripts` 无 `allow-same-origin`，无 token 无法直接触达主应用 | ✅ 安全 |
| 消息来源校验 | `handleMessage` 校验 `event.source === rec.iframe.contentWindow`，**来源不匹配直接丢弃**；内联插件另有一次性 token | ✅ 安全（远程 `url` 插件无 token，但来源校验同样生效） |
| 插件签名 | **没有实现**，也**不做**：原 `utils/security.ts` 的 `verify*` 全是 `return true`，已整文件删除 | ✅ 口径清晰：不要对外声称"插件已签名验证" |
| `minCoreVersion` | `PluginHost.installPlugin()` 前置校验 `minCoreVersion ≤ CORE_VERSION ≤ maxCoreVersion`，不满足**拒绝安装**并把原因回传安装弹窗 | ✅ 安全 |

以上各条已同步记入 `docs/TODO.md`。本轮修复后的安全口径是：

> **声明式能力（清单白名单）+ 沙箱 iframe（来源校验 + 一次性 token）+ 数据权限门 + 核心版本校验**，
> **不含**任何签名/校验和验证。请勿在对外材料中声称"插件已签名验证"。
