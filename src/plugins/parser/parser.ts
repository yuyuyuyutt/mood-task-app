// src/plugins/parser/parser.ts
import { parse } from 'toml';  // 导入 parse 函数
import { PluginManifest, PluginError, ParseResult, ParserOptions } from './types';
import { validateManifestSchema } from './validator';

export class PluginParser {
  private options: Required<ParserOptions>;
  
  constructor(options: ParserOptions = {}) {
    this.options = {
      validateSignature: false,
      verifyChecksum: false,
      sandbox: true,
      strict: true,
      allowUnknownFields: false,
      // 浏览器环境没有 Node 的 process 全局：仅在 Node 下取 cwd，否则用空串，
      // 避免在浏览器/WebView 中构造解析器时抛 ReferenceError。
      basePath:
        typeof process !== 'undefined' && typeof process.cwd === 'function'
          ? process.cwd()
          : '',
      tempPath: '/tmp',
      maxFileSize: 10 * 1024 * 1000,
      timeout: 30000,
      ...options
    };
  }

  async parse(
    input: string | ArrayBuffer | File,
    filePath?: string
  ): Promise<ParseResult> {
    const startTime = Date.now();
    const result: ParseResult = {
      success: false,
      errors: [],
      warnings: [],
      info: {
        parseTime: 0,
        fileSize: 0,
        validated: false
      }
    };

    try {
      // 1. 读取内容
      const content = await this.readInput(input);
      result.info.fileSize = content.length;
      result.info.source = filePath;

      // 2. 检查文件大小
      if (content.length > this.options.maxFileSize) {
        throw new PluginError(
          'FILE_TOO_LARGE',
          `Plugin file exceeds maximum size of ${this.options.maxFileSize} bytes`,
          'error'
        );
      }

      // 3. 解析 TOML - 使用 toml 库的 parse 函数
      let rawData: any;
      try {
        rawData = parse(content);
      } catch (tomlError) {
        const error = tomlError as Error;
        throw new PluginError(
          'TOML_PARSE_ERROR',
          `Failed to parse TOML: ${error.message}`,
          'error'
        );
      }

      // 4. 验证架构
      const validationResult = validateManifestSchema(rawData);
      
      // 添加验证错误和警告
      result.errors.push(...validationResult.errors);
      result.warnings.push(...validationResult.warnings);
      
      if (!validationResult.success || !validationResult.data) {
        // 验证失败
        result.info.validated = false;
        result.info.parseTime = Date.now() - startTime;
        return result;
      }

      // 5. 安全检查
      const securityIssues = this.checkSecurity(validationResult.data);
      result.warnings.push(...securityIssues);

      // 成功
      result.success = true;
      result.manifest = validationResult.data;
      result.info.validated = true;

    } catch (error) {
      if (error instanceof PluginError) {
        result.errors.push(error);
      } else {
        const err = error as Error;
        result.errors.push(new PluginError(
          'UNKNOWN_ERROR',
          `Unknown error during parsing: ${err.message}`,
          'fatal',
          err
        ));
      }
    } finally {
      result.info.parseTime = Date.now() - startTime;
    }

    return result;
  }

  private async readInput(input: string | ArrayBuffer | File): Promise<string> {
    if (typeof input === 'string') {
      return input;
    } else if (input instanceof ArrayBuffer) {
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(input);
    } else if (input instanceof File) {
      return await input.text();
    }
    throw new PluginError(
      'INVALID_INPUT',
      'Input must be string, ArrayBuffer, or File',
      'error'
    );
  }

  private checkSecurity(manifest: PluginManifest): PluginError[] {
    const warnings: PluginError[] = [];
    const permissions = manifest.permissions || {};

    // 检查权限是否过于宽松
    if (permissions.fs?.read?.includes('*')) {
      warnings.push(new PluginError(
        'WARNING_BROAD_FS_READ',
        'Plugin requests broad filesystem read access',
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

    // 检查危险的系统权限
    if (permissions.system?.shell) {
      warnings.push(new PluginError(
        'WARNING_SHELL_ACCESS',
        'Plugin requests shell access, which can be dangerous',
        'warning'
      ));
    }

    return warnings;
  }
}