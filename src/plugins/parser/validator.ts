// src/plugins/parser/validator.ts
import { z, ZodError } from 'zod';
import { compareVersions } from '../../utils/version';
import { PluginManifest, PluginError } from './types';

// ============ 基础验证模式 ============
const versionSchema = z.string()
  .regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/, {
    message: 'Version must follow semantic versioning (e.g., 1.0.0)'
  });

const urlSchema = z.string().url().optional();

// ============ 元数据验证 ============
const metadataSchema = z.object({
  id: z.string()
    .min(1, 'Plugin ID is required')
    .max(32, 'Plugin ID must not exceed 32 characters')
    .regex(/^[a-z0-9-_]+$/, 'Plugin ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  name: z.string().min(1, 'Plugin name is required').max(64, 'Plugin name must not exceed 64 characters'),
  version: versionSchema,
  author: z.string().min(1, 'Author is required').max(64, 'Author must not exceed 64 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters').max(2000, 'Description must not exceed 2000 characters'),
  homepage: urlSchema,
  license: z.string().max(64).optional(),
  compatibility: z.object({
    minCoreVersion: versionSchema,
    maxCoreVersion: versionSchema.optional(),
    testedVersions: z.array(versionSchema).optional().default([])
  }),
  signature: z.object({
    algorithm: z.enum(['RSA', 'ECDSA', 'Ed25519']),
    signature: z.string(),
    publicKey: z.string()
  }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
});

// ============ 依赖验证 ============
const dependenciesSchema = z.object({
  plugins: z.record(z.string(), z.string()).optional(),
  externals: z.array(
    z.object({
      name: z.string(),
      version: z.string().optional(),
      url: z.string().url().optional()
    })
  ).optional(),
  system: z.object({
    os: z.array(z.enum(['windows', 'macos', 'linux'])).optional(),
    arch: z.array(z.enum(['x64', 'arm64', 'ia32'])).optional(),
    runtime: z.object({
      node: z.string().optional(),
      deno: z.string().optional(),
      bun: z.string().optional()
    }).optional()
  }).optional()
}).optional();

// ============ 权限验证 ============
const permissionsSchema = z.object({
  fs: z.object({
    read: z.array(z.string()).optional(),
    write: z.array(z.string()).optional(),
    delete: z.array(z.string()).optional()
  }).optional(),
  network: z.object({
    domains: z.array(z.string()).optional(),
    protocols: z.array(z.enum(['http', 'https', 'ws', 'wss'])).optional()
  }).optional(),
  system: z.object({
    clipboard: z.boolean().optional(),
    notifications: z.boolean().optional(),
    dialog: z.boolean().optional(),
    shell: z.boolean().optional()
  }).optional(),
  ui: z.object({
    overlay: z.boolean().optional(),
    notification: z.boolean().optional(),
    contextMenu: z.boolean().optional(),
    keyboardShortcuts: z.array(
      z.object({
        key: z.string(),
        description: z.string()
      })
    ).optional()
  }).optional(),
  api: z.array(z.enum(['store', 'database', 'config', 'events'])).optional()
}).optional().default({});

// ============ 前端配置验证 ============
const frontendSchema = z.object({
  entry: z.string().min(1, 'Frontend entry is required'),
  type: z.enum(['widget', 'sidebar', 'modal', 'tab', 'toolbar', 'context-menu', 'hotkey']),
  mountPoint: z.string().optional(),
  styles: z.array(z.string()).optional(),
  scripts: z.array(z.string()).optional(),
  locales: z.object({
    path: z.string(),
    default: z.string(),
    supported: z.array(z.string())
  }).optional(),
  assets: z.array(
    z.object({
      type: z.enum(['image', 'font', 'audio', 'video']),
      path: z.string(),
      preload: z.boolean().optional()
    })
  ).optional(),
  config: z.object({}).catchall(z.any()).optional()
});

// ============ 后端配置验证 ============
const backendSchema = z.object({
  rust: z.object({
    lib: z.string(),
    entry: z.string()
  }).optional(),
  js: z.object({
    entry: z.string(),
    type: z.enum(['commonjs', 'module']).optional().default('module')
  }).optional(),
  commands: z.array(
    z.object({
      name: z.string().regex(/^[a-z0-9-_]+$/, 'Command name must contain only lowercase letters, numbers, hyphens, and underscores'),
      description: z.string(),
      args: z.array(
        z.object({
          name: z.string(),
          type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
          required: z.boolean().optional().default(false)
        })
      ).optional(),
      permissions: z.array(z.string()).optional()
    })
  ).optional(),
  services: z.array(
    z.object({
      name: z.string(),
      schedule: z.string().optional(),
      autoStart: z.boolean().optional().default(false)
    })
  ).optional(),
  eventListeners: z.array(
    z.object({
      event: z.string(),
      handler: z.string()
    })
  ).optional()
}).optional();

// ============ 资源验证 ============
const assetsSchema = z.object({
  icons: z.record(z.string(), z.string()).optional(),
  screenshots: z.array(z.string()).optional(),
  previews: z.array(z.string()).optional()
}).optional();

// ============ 钩子验证 ============
const hooksSchema = z.object({
  onInstall: z.string().optional(),
  onUninstall: z.string().optional(),
  onEnable: z.string().optional(),
  onDisable: z.string().optional(),
  onUpdate: z.string().optional()
}).optional();

// ============ 声明式能力验证 ============
// 已知能力严格验证（含安全约束）；未知能力透传（catchall），保证向前兼容，
// 宿主会对未知能力做安全忽略，绝不执行插件代码。

// 受信任的导航图标白名单（防图标名注入）
const PAGE_ICONS = ['smile', 'calendar', 'tasks', 'chart', 'plug', 'settings', 'home', 'moon'] as const;

const themeCapabilitySchema = z.object({
  type: z.literal('theme'),
  mode: z.enum(['light', 'dark']),
  className: z.string().max(64).optional(),
  dataAttribute: z.string().max(64).optional(),
  attributeValue: z.string().max(64).optional(),
  followSystem: z.boolean().optional().default(true),
  variables: z.record(z.string().max(128), z.string().max(256)).optional(),
  styleSheet: z.string().max(300_000, 'styleSheet 超过 300KB 上限').optional()
});

const pageCapabilitySchema = z.object({
  type: z.literal('page'),
  pageId: z.string().regex(/^[a-z0-9-_]{1,48}$/, 'pageId 只能包含小写字母/数字/连字符/下划线'),
  title: z.string().min(1).max(64, '页面标题过长'),
  path: z
    .string()
    .regex(/^\/[a-z0-9-_/]{0,63}$/, 'path 必须以 / 开头，且只能包含小写字母/数字/-/_/'),
  icon: z.enum(PAGE_ICONS).optional(),
  description: z.string().max(500).optional(),
  showInNav: z.boolean().optional().default(true)
});

const dataCapabilitySchema = z.object({
  type: z.literal('data'),
  namespace: z
    .string()
    .regex(/^[a-z0-9-_]{1,32}$/, 'namespace 只能包含小写字母/数字/连字符/下划线'),
  collections: z
    .array(z.string().regex(/^[a-z0-9-_]{1,64}$/, '集合名不合法'))
    .min(1, '至少声明一个集合')
    .max(32, '集合数量过多')
    .optional(),
  operations: z
    .array(z.enum(['read', 'write', 'delete']))
    .min(1)
    .optional()
    .default(['read']),
  retentionDays: z.number().int().min(0).max(90, '保留天数不得超过 90').optional().default(3)
});

const codeCapabilitySchema = z.object({
  type: z.literal('code'),
  kind: z.literal('theme'),
  inline: z.string().max(200_000, 'inline 源码超过 200KB 上限').optional(),
  url: z.string().url('url 必须是合法 URL').optional(),
  sandbox: z.boolean().optional().default(true),
  permissions: z.array(z.enum(['theme', 'storage'])).optional().default(['theme'])
});

const capabilitiesSchema = z.object({
  theme: themeCapabilitySchema.optional(),
  page: pageCapabilitySchema.optional(),
  data: dataCapabilitySchema.optional(),
  code: codeCapabilitySchema.optional()
}).catchall(z.any()).optional();

// ============ 完整插件清单验证 ============
const manifestSchema = z.object({
  metadata: metadataSchema,
  dependencies: dependenciesSchema,
  permissions: permissionsSchema,
  frontend: frontendSchema,
  backend: backendSchema,
  assets: assetsSchema,
  hooks: hooksSchema,
  capabilities: capabilitiesSchema
});

// ============ 验证结果接口 ============
export interface ValidationResult {
  success: boolean;
  errors: PluginError[];
  warnings: PluginError[];
  data?: PluginManifest;
}

// ============ 验证函数 ============
export function validateManifestSchema(input: any): ValidationResult {
  const result: ValidationResult = {
    success: false,
    errors: [],
    warnings: []
  };

  try {
    // 使用Zod验证并解析
    const parsedData = manifestSchema.parse(input);
    
    // 验证通过，转换类型
    const manifest: PluginManifest = parsedData as PluginManifest;
    
    // 额外的业务逻辑验证
    const extraValidations = performExtraValidations(manifest);
    result.warnings.push(...extraValidations.warnings);
    
    if (extraValidations.errors.length > 0) {
      result.errors.push(...extraValidations.errors);
      return result;
    }
    
    // 成功
    result.success = true;
    result.data = manifest;
    
  } catch (error) {
    if (error instanceof ZodError) {
      // Zod 3.x 使用 issues 属性
      const zodError = error as ZodError;
      
      // 处理每个验证问题
      zodError.issues.forEach(issue => {
        const path = issue.path?.join('.') || 'unknown';
        const message = issue.message || 'Unknown validation error';
        
        result.errors.push(new PluginError(
          'SCHEMA_ERROR',
          `${path}: ${message}`,
          'error',
          {
            code: issue.code,
            path: issue.path,
            message: issue.message,
            issue: issue
          }
        ));
      });
    } else {
      const err = error as Error;
      result.errors.push(new PluginError(
        'VALIDATION_ERROR',
        `Validation error: ${err.message}`,
        'error',
        { originalError: err }
      ));
    }
  }

  return result;
}

// ============ 额外的业务逻辑验证 ============
function performExtraValidations(manifest: PluginManifest): {
  errors: PluginError[];
  warnings: PluginError[];
} {
  const errors: PluginError[] = [];
  const warnings: PluginError[] = [];
  const permissions = manifest.permissions || {};

  // 1. 验证版本兼容性
  if (manifest.metadata.compatibility.maxCoreVersion) {
    const min = manifest.metadata.compatibility.minCoreVersion;
    const max = manifest.metadata.compatibility.maxCoreVersion;
    
    if (compareVersions(min, max) > 0) {
      errors.push(new PluginError(
        'INVALID_COMPATIBILITY',
        `minCoreVersion (${min}) must be less than or equal to maxCoreVersion (${max})`,
        'error'
      ));
    }
  }

  // 2. 验证权限合理性
  if (permissions.fs?.delete?.includes('*')) {
    warnings.push(new PluginError(
      'DANGEROUS_PERMISSION',
      'Plugin requests permission to delete any file (using * wildcard). This is dangerous.',
      'warning'
    ));
  }

  if (permissions.network?.domains?.includes('*')) {
    warnings.push(new PluginError(
      'WARNING_BROAD_NETWORK',
      'Plugin requests unrestricted network access',
      'warning'
    ));
  }

  // 3. 验证前端入口文件扩展名（capability:// 形式的声明式入口跳过检查）
  const entry = manifest.frontend.entry;
  if (!entry.startsWith('capability://')) {
    const entryExt = entry.split('.').pop()?.toLowerCase();
    const allowedExts = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'];
    if (entryExt && !allowedExts.includes(entryExt)) {
      warnings.push(new PluginError(
        'UNUSUAL_ENTRY_EXTENSION',
        `Frontend entry has unusual extension: .${entryExt}. Expected: ${allowedExts.join(', ')}`,
        'warning'
      ));
    }
  }

  // 4. 验证依赖循环
  if (manifest.dependencies?.plugins) {
    const deps = Object.keys(manifest.dependencies.plugins);
    if (deps.includes(manifest.metadata.id)) {
      errors.push(new PluginError(
        'CIRCULAR_DEPENDENCY',
        'Plugin cannot depend on itself',
        'error'
      ));
    }
  }

  // 5. 检查是否缺少必需的图标
  if (manifest.assets?.icons && !manifest.assets.icons['64']) {
    warnings.push(new PluginError(
      'MISSING_ICON_SIZE',
      'Plugin is missing a 64x64 icon, which is recommended for display in plugin lists',
      'warning'
    ));
  }

  // 6. 校验声明式能力的一致性
  const themeCap = manifest.capabilities?.theme;
  if (themeCap) {
    const hasVisualEffect = !!(
      themeCap.className ||
      themeCap.dataAttribute ||
      themeCap.variables ||
      themeCap.styleSheet
    );
    if (!hasVisualEffect) {
      warnings.push(new PluginError(
        'INERT_THEME_CAPABILITY',
        'Theme capability declares no className / dataAttribute / variables / styleSheet, so enabling it will have no visible effect',
        'warning'
      ));
    }
  }

  // 7. 页面能力安全检查
  const pageCap = manifest.capabilities?.page;
  if (pageCap) {
    // 路径穿越防护（regex 之外的双保险）
    if (pageCap.path.includes('..')) {
      errors.push(new PluginError(
        'UNSAFE_PAGE_PATH',
        `Page path contains ".." which is forbidden: ${pageCap.path}`,
        'error'
      ));
    }
  }

  // 8. 数据能力安全检查
  const dataCap = manifest.capabilities?.data;
  if (dataCap) {
    // 保留命名空间：core / __ 前缀仅供宿主使用
    if (dataCap.namespace === 'core' || dataCap.namespace.startsWith('__')) {
      errors.push(new PluginError(
        'RESERVED_NAMESPACE',
        `Namespace "${dataCap.namespace}" is reserved for the host. Choose another one.`,
        'error'
      ));
    }
    // 危险操作提示
    if (dataCap.operations?.includes('delete')) {
      warnings.push(new PluginError(
        'DANGEROUS_DATA_DELETE',
        'Plugin requests data delete permission. Uninstalled data will be retained for the retention window, but explicit delete calls are irreversible.',
        'warning'
      ));
    }
  }

  // 8.5 代码能力安全检查（沙箱强制 + 源码来源互斥）
  const codeCap = manifest.capabilities?.code;
  if (codeCap) {
    if (codeCap.sandbox === false) {
      errors.push(new PluginError(
        'UNSANDBOXED_CODE',
        'Code capability must run sandboxed. Setting sandbox = false is forbidden.',
        'error'
      ));
    }
    const hasInline = typeof codeCap.inline === 'string' && codeCap.inline.length > 0;
    const hasUrl = typeof codeCap.url === 'string' && codeCap.url.length > 0;
    if (hasInline && hasUrl) {
      errors.push(new PluginError(
        'AMBIGUOUS_CODE_SOURCE',
        'Code capability must declare exactly one of inline or url.',
        'error'
      ));
    }
    if (!hasInline && !hasUrl) {
      errors.push(new PluginError(
        'MISSING_CODE_SOURCE',
        'Code capability must declare inline or url source.',
        'error'
      ));
    }
    if (hasUrl && !codeCap.url!.startsWith('https://')) {
      warnings.push(new PluginError(
        'INSECURE_CODE_URL',
        'Remote code URL is not https; prefer https for code delivery.',
        'warning'
      ));
    }
  }

  // 9. 可执行入口告警：宿主是纯声明式模型，不执行任何插件代码，
  //    声明了 backend / hooks 的清单会被安全忽略（提示而非报错）
  if (manifest.backend || manifest.hooks) {
    warnings.push(new PluginError(
      'EXECUTABLE_IGNORED',
      'This manifest declares backend/hooks entry points. The host runs a declarative-only plugin model and will safely ignore executable entries.',
      'warning'
    ));
  }

  return { errors, warnings };
}

// ============ 导出类型和函数 ============
export { manifestSchema };