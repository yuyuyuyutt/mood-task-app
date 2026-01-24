// src/plugins/parser/index.ts
export * from './types';
export * from './parser';
export * from './validator';

import { PluginParser } from './parser';
import { ParserOptions, PluginError } from './types';

/**
 * 解析插件文件的工厂函数
 */
export async function parsePluginFile(
  file: File,
  options?: ParserOptions
) {
  const parser = new PluginParser(options);
  return await parser.parse(file);
}

/**
 * 从URL加载并解析插件
 */
export async function parsePluginFromURL(
  url: string,
  options?: ParserOptions
) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new PluginError(
        'NETWORK_ERROR',
        `Failed to fetch plugin from ${url}: ${response.statusText}`,
        'error'
      );
    }
    
    const content = await response.text();
    const parser = new PluginParser(options);
    return await parser.parse(content, url);
  } catch (error) {
    if (error instanceof PluginError) {
      throw error;
    }
    
    const err = error as Error;
    throw new PluginError(
      'NETWORK_ERROR',
      `Failed to fetch plugin: ${err.message}`,
      'error',
      err
    );
  }
}

/**
 * 验证插件清单
 */
import { validateManifestSchema as validateSchema } from './validator';
export const validatePluginManifest = validateSchema;

// 默认导出解析器
export default PluginParser;