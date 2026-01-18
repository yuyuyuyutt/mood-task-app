import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // 从 localStorage 获取保存的主题
    const savedTheme = localStorage.getItem('theme') as Theme;
    
    // 如果用户已保存主题偏好，使用它
    if (savedTheme) {
      return savedTheme;
    }
    
    // 否则检查系统偏好
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    
    // 移除旧的类
    root.classList.remove('light', 'dark');
    // 添加新的主题类
    root.classList.add(theme);
    
    // 保存到 localStorage
    localStorage.setItem('theme', theme);
    
    // 更新 HTML 的 data-theme 属性（可选，便于其他样式引用）
    root.setAttribute('data-theme', theme);
    
  }, [theme]);

  // 切换主题
  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // 设置特定主题
  const setLightTheme = () => setTheme('light');
  const setDarkTheme = () => setTheme('dark');

  return {
    theme,
    toggleTheme,
    setLightTheme,
    setDarkTheme,
    isDark: theme === 'dark',
    isLight: theme === 'light',
  };
}