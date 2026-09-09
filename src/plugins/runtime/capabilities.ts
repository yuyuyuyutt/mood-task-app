// src/plugins/runtime/capabilities.ts
// 声明式能力的解释器。宿主按清单调用，解释器只负责"把能力落到 DOM/偏好上"。
// 所有解释器共享：单次批量 DOM 写入、错误由宿主统一隔离、可订阅变更。
import type { ThemeCapability } from '../parser/types';
import { THEME_PREF_KEY, type SandboxThemeSpec, type ThemeState } from './types';

type ThemeListener = () => void;

/**
 * 主题能力解释器。
 * 约定：基线主题是"浅色"（应用无需任何插件即可运行）；只有启用主题能力插件
 * （如内置的 dark-theme.toml / wireframe.toml）才会改变外观。
 * 切换/恢复都是幂等、批量的 DOM 写入，且插件的启用状态本身就是用户偏好。
 * 支持三类痕迹：CSS 类名、data 属性、CSS 变量、随启停注入的整段样式表
 * （styleSheet，用于"黑白线框"这类整站视觉风格）。切换插件时会精确撤销上一轮的痕迹。
 */
export class ThemeController {
  private active: { pluginId: string; cap: ThemeCapability } | null = null;
  /** 上一轮应用过的痕迹（用于切换插件时精确撤销） */
  private appliedClass: string | null = null;
  private appliedAttr: string | null = null;
  private appliedVars: Record<string, string> | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private listeners = new Set<ThemeListener>();

  get state(): ThemeState {
    return this.active
      ? { mode: this.active.cap.mode, activePluginId: this.active.pluginId }
      : { mode: 'light', activePluginId: null };
  }

  /** 应用某个插件的主题能力。
   * 幂等策略：仅当 (pluginId, cap 对象引用) 都与当前一致时才跳过。
   * 宿主批量激活时传同一 manifest 对象 -> 天然幂等；
   * 同 id 插件被"覆盖更新/重新安装"后 manifest 是新对象 -> 会自动重新应用
   * 新样式表/类名（修复升级后仍显示旧版样式的问题）。 */
  apply(pluginId: string, cap: ThemeCapability): void {
    if (this.active && this.active.pluginId === pluginId && this.active.cap === cap) return;
    this.active = { pluginId, cap };
    try {
      this.writeDom();
    } catch (err) {
      console.error('[theme] writeDom failed:', err);
    }
    this.emit();
  }

  /** 移除当前主题能力，回到浅色基线 */
  clear(): void {
    if (!this.active) return;
    this.active = null;
    try {
      this.writeDom();
    } catch (err) {
      console.error('[theme] clear failed:', err);
    }
    this.emit();
  }

  /** 供沙箱代码插件调用：把"运行时计算出的主题规格"落到 DOM。
   *  将 spec 归一化为 ThemeCapability 后走同一套幂等/批量写入逻辑，
   *  代码插件因此可以动态生成 token/样式，而不是只能写死静态 CSS。 */
  applyDynamic(pluginId: string, spec: SandboxThemeSpec): void {
    const tokens: Record<string, string> = { ...(spec.tokens ?? {}) };
    if (spec.accent) tokens['--accent'] = spec.accent;
    const cap: ThemeCapability = {
      type: 'theme',
      mode: spec.mode ?? 'light',
      className: spec.className,
      variables: Object.keys(tokens).length > 0 ? tokens : undefined,
      styleSheet: spec.css,
    };
    this.apply(pluginId, cap);
  }

  subscribe(fn: ThemeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 批量 DOM 写入：先精确撤销上一轮痕迹，再一次写入本轮主题（避免抖动） */
  private writeDom(): void {
    const root = document.documentElement;

    // 1) 撤销上一轮注入的全部痕迹（单次批量操作）
    if (this.appliedClass) root.classList.remove(this.appliedClass);
    if (this.appliedAttr) root.removeAttribute(this.appliedAttr);
    if (this.appliedVars) {
      for (const key of Object.keys(this.appliedVars)) root.style.removeProperty(key);
      this.appliedVars = null;
    }
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
    this.appliedClass = null;
    this.appliedAttr = null;

    // 2) 无主题插件 -> 浅色基线
    const cap = this.active?.cap;
    if (!cap) {
      localStorage.setItem(THEME_PREF_KEY, 'light');
      return;
    }

    // 3) 应用插件声明的主题痕迹
    if (cap.className) {
      root.classList.add(cap.className);
      this.appliedClass = cap.className;
    }
    if (cap.dataAttribute) {
      root.setAttribute(cap.dataAttribute, cap.attributeValue ?? cap.mode);
      this.appliedAttr = cap.dataAttribute;
    }
    if (cap.variables) {
      this.appliedVars = cap.variables;
      for (const [k, v] of Object.entries(cap.variables)) root.style.setProperty(k, v);
    }
    if (cap.styleSheet && typeof document !== 'undefined') {
      const pid = this.active?.pluginId;
      if (pid) {
        const el = document.createElement('style');
        el.setAttribute('data-plugin-theme', pid);
        el.textContent = cap.styleSheet;
        document.head.appendChild(el);
        this.styleEl = el;
        // 自愈：清掉任何不属于当前主题插件的残留样式（如某次激活中途出错遗留的旧 <style>）
        try {
          const leftovers = Array.from(document.head.querySelectorAll('style[data-plugin-theme]'));
          for (const s of leftovers) {
            if (s !== el && s.getAttribute('data-plugin-theme') !== pid) s.remove();
          }
        } catch {
          /* noop */
        }
      }
    }
    localStorage.setItem(THEME_PREF_KEY, cap.mode);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
