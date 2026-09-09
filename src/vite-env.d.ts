/// <reference types="vite/client" />

// Vite 的 ?raw 导入：将文件内容作为字符串导入（用于内置插件 TOML 清单）
declare module '*.toml?raw' {
  const content: string;
  export default content;
}
