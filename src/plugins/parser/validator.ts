// src/plugins/parser/validator.ts
import { z, ZodError } from 'zod';
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
    .regex(/^[a-z0-9-_]+$/, 'Plugin ID must contain only lowercase letters, numbers, hyphens, and underscores'),
  name: z.string().min(1, 'Plugin name is required'),
  version: versionSchema,
  author: z.string().min(1, 'Author is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  homepage: urlSchema,
  license: z.string().optional(),
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

// ============ 完整插件清单验证 ============
const manifestSchema = z.object({
  metadata: metadataSchema,
  dependencies: dependenciesSchema,
  permissions: permissionsSchema,
  frontend: frontendSchema,
  backend: backendSchema,
  assets: assetsSchema,
  hooks: hooksSchema
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

  // 3. 验证前端入口文件扩展名
  const entryExt = manifest.frontend.entry.split('.').pop()?.toLowerCase();
  const allowedExts = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'];
  if (entryExt && !allowedExts.includes(entryExt)) {
    warnings.push(new PluginError(
      'UNUSUAL_ENTRY_EXTENSION',
      `Frontend entry has unusual extension: .${entryExt}. Expected: ${allowedExts.join(', ')}`,
      'warning'
    ));
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

  return { errors, warnings };
}

// ============ 版本比较函数 ============
function compareVersions(v1: string, v2: string): number {
  const parseVersion = (version: string): number[] => {
    // 移除预发布版本和构建元数据
    const cleanVersion = version.split('-')[0].split('+')[0];
    return cleanVersion.split('.').map(Number);
  };

  const v1Parts = parseVersion(v1);
  const v2Parts = parseVersion(v2);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const part1 = v1Parts[i] || 0;
    const part2 = v2Parts[i] || 0;
    
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }
  
  return 0;
}

// ============ 导出类型和函数 ============
export { manifestSchema };