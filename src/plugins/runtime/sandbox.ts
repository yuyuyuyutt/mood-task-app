// src/plugins/runtime/sandbox.ts
// 沙箱代码插件运行时。
// 安全模型：
//   - 插件 JS 运行在 `sandbox="allow-scripts"`（opaque origin）的 iframe 里，
//     没有 allow-same-origin，因此【无法】访问主应用的 DOM / localStorage / cookie；
//   - 插件只能通过注入的 SDK（postMessage 协议）向宿主请求"受白名单约束"的能力；
//   - 每个内联代码插件在挂载时拿到一次性 token，消息必须携带匹配 token，防伪造。
// 能力白名单（当前）：
//   - theme:apply  -> 向宿主提交一个主题应用规格（tokens/css/accent），
//                    由宿主(ThemeController) 落到真实 DOM。
import type { SandboxThemeSpec } from './types';

export interface SandboxMessage {
  __plugin: string;
  __token?: string;
  type: string;
  payload?: unknown;
}

interface FrameRecord {
  iframe: HTMLIFrameElement;
  token?: string;
}

const ESCAPE_SCRIPT = /<\/script/gi;

/** 生成内联代码插件用的 srcDoc：注入 SDK（含 token），再执行插件源码 */
function buildSrcDoc(pluginId: string, token: string, code: string): string {
  const safeCode = code.replace(ESCAPE_SCRIPT, '<\\/script');
  return [
    '<!doctype html><html><head><meta charset="utf-8"></head><body>',
    '<script>',
    `(function(){var ID=${JSON.stringify(pluginId)};var TOKEN=${JSON.stringify(token)};`,
    'window.SDK={id:ID,token:TOKEN,',
    'applyTheme:function(spec){window.parent.postMessage({__plugin:ID,__token:TOKEN,type:"theme:apply",payload:spec||{}},"*");},',
    'log:function(){var a=Array.prototype.slice.call(arguments);window.parent.postMessage({__plugin:ID,__token:TOKEN,type:"log",payload:a},"*");}',
    '};Object.freeze(window.SDK);',
    // 运行时错误上报（语法错误无法捕获，会显示在该 script 自身；其余错误回传宿主日志）
    'window.addEventListener("error",function(ev){try{window.parent.postMessage({__plugin:ID,__token:TOKEN,type:"log",payload:["runtime-error:"+(ev&&ev.message)]},"*");}catch(_e){}});',
    '})();',
    '</scr' + 'ipt>',
    '<script>',
    safeCode,
    '</scr' + 'ipt>',
    '</body></html>',
  ].join('');
}

export class SandboxHost {
  private frames = new Map<string, FrameRecord>();
  private container: HTMLDivElement | null = null;
  private onThemeApply: (pluginId: string, spec: SandboxThemeSpec) => void;
  private handler = (e: MessageEvent): void => this.handleMessage(e);

  constructor(opts: { onThemeApply: (pluginId: string, spec: SandboxThemeSpec) => void }) {
    this.onThemeApply = opts.onThemeApply;
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handler);
    }
  }

  private ensureContainer(): HTMLDivElement {
    if (this.container || typeof document === 'undefined') {
      return this.container ?? document.body.appendChild(document.createElement('div'));
    }
    const div = document.createElement('div');
    div.setAttribute('aria-hidden', 'true');
    div.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(div);
    this.container = div;
    return div;
  }

  /** 挂载一个 theme 类代码插件（隐藏 iframe，运行其源码） */
  mountTheme(pluginId: string, source: string, isUrl: boolean): void {
    if (typeof document === 'undefined') return;
    this.unmount(pluginId);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('title', `plugin-sandbox:${pluginId}`);
    iframe.style.cssText = 'width:0;height:0;border:0;';

    if (isUrl) {
      // 远程代码：直接加载其页面（不注入 SDK；作者按协议自行 postMessage）
      iframe.src = source;
      this.frames.set(pluginId, { iframe });
    } else {
      const token = `${pluginId}:${Math.random().toString(36).slice(2)}:${Date.now().toString(36)}`;
      iframe.srcdoc = buildSrcDoc(pluginId, token, source);
      this.frames.set(pluginId, { iframe, token });
    }
    this.ensureContainer().appendChild(iframe);
  }

  /** 卸载某插件沙箱 */
  unmount(pluginId: string): void {
    const rec = this.frames.get(pluginId);
    if (!rec) return;
    try {
      rec.iframe.remove();
    } catch {
      /* noop */
    }
    this.frames.delete(pluginId);
  }

  /** 暴露给测试/未来扩展：直接投递一条消息（等价于 iframe 内 postMessage） */
  dispatch(pluginId: string, type: string, payload?: unknown, token?: string): void {
    this.route({ __plugin: pluginId, __token: token, type, payload });
  }

  private handleMessage(e: MessageEvent): void {
    const d = e.data as SandboxMessage | undefined;
    if (!d || typeof d !== 'object' || typeof d.__plugin !== 'string') return;
    if (typeof d.type !== 'string') return;
    this.route(d);
  }

  private route(msg: SandboxMessage): void {
    const rec = this.frames.get(msg.__plugin);
    if (!rec) return;
    // token 校验（仅内联代码插件有 token）
    if (rec.token && msg.__token !== rec.token) {
      console.warn(`[sandbox] 插件 "${msg.__plugin}" 消息 token 不匹配，已丢弃`);
      return;
    }
    switch (msg.type) {
      case 'theme:apply': {
        const spec = (msg.payload ?? {}) as SandboxThemeSpec;
        this.onThemeApply(msg.__plugin, spec);
        break;
      }
      case 'log': {
        console.info(`[sandbox:${msg.__plugin}]`, msg.payload);
        break;
      }
      default:
        break;
    }
  }
}
