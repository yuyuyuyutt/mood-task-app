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
  };
}