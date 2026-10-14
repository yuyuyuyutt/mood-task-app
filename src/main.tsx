import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { migrateLegacyLocalStorage } from "./utils/storageKeys";

// 品牌更名兼容：把更名前（mood-task:*）写入的本地数据一次性搬到 sophotask:*。
// 必须早于任何存储读取（主题、插件注册表、设置、任务）。迁移失败不阻断启动 ——
// 最差的结果是当作全新用户，而不是白屏。
try {
  if (typeof localStorage !== "undefined") {
    const migrated = migrateLegacyLocalStorage(localStorage);
    if (migrated > 0) {
      console.info(`[sophotask] 已迁移 ${migrated} 条更名前的本地数据`);
    }
  }
} catch (err) {
  console.warn("[sophotask] 更名前的本地数据迁移失败，将按全新数据启动:", err);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
