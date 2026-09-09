// src/plugins/builtin/index.ts
// 内置插件清单注册表：id -> TOML 源文本。
// 内置插件可以一键（重新）安装；卸载后进入保留期，重新安装自动恢复数据。
import darkThemeToml from './dark-theme.toml?raw';
import moodDiaryToml from './mood-diary.toml?raw';
import wireframeToml from './wireframe.toml?raw';

export const BUILTIN_PLUGINS: Record<string, { id: string; name: string; toml: string }> = {
  'dark-theme': { id: 'dark-theme', name: '深色主题', toml: darkThemeToml },
  'mood-diary': { id: 'mood-diary', name: '心情日记', toml: moodDiaryToml },
  'wireframe': { id: 'wireframe', name: '黑白线框 · 荧光', toml: wireframeToml },
};

export function getBuiltinToml(id: string): string | undefined {
  return BUILTIN_PLUGINS[id]?.toml;
}

/** 从 TOML 源文本中读取 [metadata] 下的 version（与校验器语义一致，避免重复维护版本号） */
export function builtinTomlVersion(toml: string): string | undefined {
  const m = /^\s*version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"/m.exec(toml);
  return m ? m[1] : undefined;
}

export function getBuiltinVersion(id: string): string | undefined {
  const toml = BUILTIN_PLUGINS[id]?.toml;
  return toml ? builtinTomlVersion(toml) : undefined;
}

/** 简易语义化版本比较：a>b -> 1，相等 -> 0，a<b -> -1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('+')[0].split('-')[0].split('.').map(Number);
  const pb = b.split('+')[0].split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export const BUILTIN_PLUGIN_IDS = Object.keys(BUILTIN_PLUGINS);
