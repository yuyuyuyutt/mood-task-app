// src/hooks/useTheme.ts
// 主题 Hook：不再自行读写 DOM / localStorage，而是完全委托给插件宿主。
// 深色模式是否可用，取决于"深色主题"能力插件（内置 dark-theme.toml）的安装与启用状态：
//   - 未安装 -> 只有浅色基线，toggle/setDark 会自动安装并启用内置插件
//   - 已安装未启用 -> 浅色；启用 -> 深色
// 保留原 API（theme/toggleTheme/setLightTheme/setDarkTheme/isDark/isLight），
// 使调用方（如设置页）无需感知底层实现。
import { usePluginHost } from '../plugins/runtime';

export function useTheme() {
  const { theme } = usePluginHost();

  return {
    theme: theme.mode,
    toggleTheme: () => void theme.toggle(),
    setLightTheme: () => void theme.setLight(),
    setDarkTheme: () => void theme.setDark(),
    isDark: theme.isDark,
    isLight: theme.isLight,
  };
}
