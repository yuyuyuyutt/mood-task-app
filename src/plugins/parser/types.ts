// src/plugins/parser/types.ts

// ============ 插件错误类 ============
export class PluginError extends Error {
  constructor(
    public code: string,
    message: string,
    public level: 'warning' | 'error' | 'fatal' = 'error',
    public details?: any
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

// ============ 插件元数据 ============
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  homepage?: string;
  license?: string;
  
  // 兼容性
  compatibility: {
    minCoreVersion: string;
    maxCoreVersion?: string;
    testedVersions: string[];
  };
  
  // 签名和验证
  signature?: {
    algorithm: 'RSA' | 'ECDSA' | 'Ed25519';
    signature: string;
    publicKey: string;
  };
  
  // 时间戳
  createdAt: string;
  updatedAt?: string;
}

// ============ 依赖声明 ============
export interface PluginDependencies {
  plugins?: Record<string, string>;
  externals?: Array<{
    name: string;
    version?: string;
    url?: string;
  }>;
  system?: {
    os?: Array<'windows' | 'macos' | 'linux'>;
    arch?: Array<'x64' | 'arm64' | 'ia32'>;
  };
}

// ============ 权限声明 ============
export interface PluginPermissions {
  fs?: {
    read?: string[];
    write?: string[];
    delete?: string[];
  };
  network?: {
    domains?: string[];
    protocols?: Array<'http' | 'https' | 'ws' | 'wss'>;
  };
  system?: {
    clipboard?: boolean;
    notifications?: boolean;
    dialog?: boolean;
    shell?: boolean;
  };
  ui?: {
    overlay?: boolean;
    notification?: boolean;
    contextMenu?: boolean;
    keyboardShortcuts?: Array<{
      key: string;
      description: string;
    }>;
  };
  api?: Array<'store' | 'database' | 'config' | 'events'>;
}

// ============ 前端配置 ============
export type ComponentType = 
  | 'widget' | 'sidebar' | 'modal' | 'tab' 
  | 'toolbar' | 'context-menu' | 'hotkey';

export interface FrontendConfig {
  entry: string;
  type: ComponentType;
  mountPoint?: string;
  styles?: string[];
  scripts?: string[];
  locales?: {
    path: string;
    default: string;
    supported: string[];
  };
  assets?: Array<{
    type: 'image' | 'font' | 'audio' | 'video';
    path: string;
    preload?: boolean;
  }>;
  config?: Record<string, any>;
}

// ============ 后端配置 ============
export interface BackendConfig {
  rust?: {
    lib: string;
    entry: string;
  };
  js?: {
    entry: string;
    type?: 'commonjs' | 'module';
  };
  commands?: Array<{
    name: string;
    description: string;
    args?: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      required?: boolean;
    }>;
    permissions?: string[];
  }>;
  services?: Array<{
    name: string;
    schedule?: string;
    autoStart?: boolean;
  }>;
  eventListeners?: Array<{
    event: string;
    handler: string;
  }>;
}

// ============ 声明式插件能力 ============
// 插件通过 TOML 中的 [capabilities.*] 声明自身能力，由宿主(host)解释执行。
// 这是纯声明式的插件模型：插件不携带任意代码，行为完全由受信任的宿主解释器
// 按清单执行，因此天然安全、可审计，且解释开销极低（适合大量插件同时启用）。

export type PluginCapabilityType = 'theme';

export interface ThemeCapability {
  /** 能力类型标识 */
  type: 'theme';
  /** 启用后呈现的主题模式 */
  mode: 'light' | 'dark';
  /** 附加到 <html> 上的 CSS 类名（如 "dark"） */
  className?: string;
  /** 写到 <html> 上的 data 属性名（如 "data-theme"） */
  dataAttribute?: string;
  /** data 属性的取值 */
  attributeValue?: string;
  /** 首次启用时是否跟随系统偏好决定默认模式 */
  followSystem?: boolean;
  /** 启用时注入的自定义 CSS 变量（key: --xxx, value: 颜色/值） */
  variables?: Record<string, string>;
  /** 随主题启停的整段样式表（如"黑白线框"这类整站视觉风格），由宿主以 <style> 注入/移除 */
  styleSheet?: string;
}

/**
 * 页面能力：插件向应用贡献一个页面。
 * 安全模型：宿主只渲染【内置注册表】中登记过的 pageId 对应组件，
 * 插件清单本身不携带任何可执行代码，无法注入脚本/HTML。
 */
export interface PageCapability {
  type: 'page';
  /** 页面标识，必须匹配内置页面注册表中的某个条目，否则渲染安全占位页 */
  pageId: string;
  /** 导航标题 */
  title: string;
  /** 路由路径（必须以 / 开头，仅小写字母/数字/-/_/） */
  path: string;
  /** 导航图标（受信任的图标白名单键） */
  icon?: 'smile' | 'calendar' | 'tasks' | 'chart' | 'plug' | 'settings' | 'home' | 'moon';
  description?: string;
  /** 是否显示在侧边导航中（默认 true） */
  showInNav?: boolean;
}

/**
 * 数据能力：插件读写【长期数据】。
 * 安全模型：数据按 namespace 隔离，宿主强制要求：
 * 1) 请求方必须是声明了该 namespace 的插件（或受信任的核心宿主）；
 * 2) 操作必须在 operations 白名单内；
 * 3) 集合必须在 collections 白名单内。
 * 卸载插件时数据不立即删除，而是进入保留期（retentionDays，默认 3 天），
 * 保留期内重新安装自动恢复数据。
 */
export interface DataCapability {
  type: 'data';
  /** 数据命名空间（隔离域，小写字母/数字/-/_，≤32 字符，禁止 core/__ 前缀） */
  namespace: string;
  /** 允许访问的集合名；未声明则拒绝一切数据访问 */
  collections?: string[];
  /** 允许的操作，默认仅 ['read'] */
  operations?: Array<'read' | 'write' | 'delete'>;
  /** 卸载后数据保留天数（0-90，默认 3） */
  retentionDays?: number;
}

/**
 * 代码能力：插件携带【自己的 JavaScript 源码】，在宿主提供的沙箱 iframe 中运行，
 * 通过受限消息协议（postMessage + 一次性 token）与宿主交互。
 * 这是"去中心化自由开发"的代码前提：插件作者可以写任意 JS 来生成/计算 UI 风格、
 * 主题、内容等，但代码运行在 opaque-origin 的沙箱里，无法直接触碰主应用 DOM/存储。
 */
export interface CodeCapability {
  type: 'code';
  /** 能力类别（本轮先支持 theme；page 等后续扩展） */
  kind: 'theme';
  /** 内联 JS 源码（与 url 二选一）。演示/分发友好，且可被持久化。
   *  ⚠️ 请用 TOML 字面量多行字符串（'''...'''）书写源码：普通字符串会做
   *  \n 等转义，导致源码里的字符串字面量被破坏（如 join('\n') 变成真换行）。 */
  inline?: string;
  /** 远程 JS 地址（与 inline 二选一）。加载进沙箱 iframe（不注入 SDK，需按协议自行 postMessage）。 */
  url?: string;
  /** 是否强制沙箱运行（固定 true；false 会被校验器拒绝） */
  sandbox?: boolean;
  /** 该插件可用的消息权限（白名单） */
  permissions?: Array<'theme' | 'storage'>;
}

/** 插件能力集合：新增能力类型时在此扩展，并在 host/capabilities 中注册解释器 */
export interface PluginCapabilities {
  theme?: ThemeCapability;
  page?: PageCapability;
  data?: DataCapability;
  code?: CodeCapability;
  /** 预留扩展位：允许未来能力透传而不破坏旧版解析器（宿主会安全忽略未知能力） */
  [key: string]: any;
}

// ============ 完整插件清单 ============
export interface PluginManifest {
  metadata: PluginMetadata;
  dependencies?: PluginDependencies;
  permissions: PluginPermissions;
  frontend: FrontendConfig;
  backend?: BackendConfig;
  assets?: {
    icons?: Record<string, string>;
    screenshots?: string[];
    previews?: string[];
  };
  hooks?: {
    onInstall?: string;
    onUninstall?: string;
    onEnable?: string;
    onDisable?: string;
    onUpdate?: string;
  };
  /** 声明式能力：由插件宿主解释执行 */
  capabilities?: PluginCapabilities;
}

// ============ 解析器选项 ============
export interface ParserOptions {
  validateSignature?: boolean;
  verifyChecksum?: boolean;
  sandbox?: boolean;
  strict?: boolean;
  allowUnknownFields?: boolean;
  basePath?: string;
  tempPath?: string;
  maxFileSize?: number;
  timeout?: number;
}

// ============ 解析结果 ============
export interface ParseResult {
  success: boolean;
  manifest?: PluginManifest;
  errors: PluginError[];
  warnings: PluginError[];
  info: {
    parseTime: number;
    fileSize: number;
    validated: boolean;
    /** 清单来源（本地文件路径或 URL），便于追踪插件来源 */
    source?: string;
  };
}