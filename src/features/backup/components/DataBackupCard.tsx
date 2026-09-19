// src/features/backup/components/DataBackupCard.tsx
// 设置页的"数据管理"卡片：导出 / 导入全部本地数据。
import React, { useRef, useState } from 'react';
import {
  FaCheck,
  FaClipboard,
  FaDatabase,
  FaDownload,
  FaExclamationCircle,
  FaSpinner,
  FaUpload,
} from 'react-icons/fa';
import { usePluginHost } from '../../../plugins/runtime';
import { copyText, downloadJson } from '../../../utils/download';
import { backupFileName, createBackup, parseBackup, restoreBackup } from '../backupService';

type Status = { type: 'success' | 'error'; text: string } | null;

export const DataBackupCard: React.FC = () => {
  const { dataStore } = usePluginHost();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const host = {
    dumpPluginData: () => dataStore.dumpAll(),
    restorePluginData: (rows: Parameters<typeof dataStore.restoreRows>[0]) => dataStore.restoreRows(rows),
  };

  const run = async (kind: 'export' | 'import', action: () => Promise<string>) => {
    setBusy(kind);
    setStatus(null);
    try {
      setStatus({ type: 'success', text: await action() });
    } catch (err) {
      setStatus({ type: 'error', text: `操作失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  const handleExport = () =>
    run('export', async () => {
      const backup = await createBackup(host);
      downloadJson(backupFileName(), backup);
      return `已生成备份：任务 ${backup.data.tasks.length} 个 · 插件数据 ${backup.data.pluginData.length} 条 · 计划 ${backup.data.planner.plans.length} 份`;
    });

  const handleCopy = () =>
    run('export', async () => {
      const backup = await createBackup(host);
      const ok = await copyText(JSON.stringify(backup, null, 2));
      if (!ok) throw new Error('剪贴板不可用，请改用「下载备份」');
      return '备份 JSON 已复制到剪贴板';
    });

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFile = (file: File) =>
    run('import', async () => {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) throw new Error(parsed.error);
      const { tasks, pluginData, planner } = parsed.backup.data;
      const plans = planner?.plans?.length ?? 0;
      const resources = planner?.resources?.length ?? 0;
      const confirmed = window.confirm(
        `即将导入 ${new Date(parsed.backup.exportedAt).toLocaleString()} 的备份：\n` +
          `· 任务 ${tasks?.length ?? 0} 个（按"标题+创建时间"去重，只追加缺失的）\n` +
          `· 插件数据 ${pluginData?.length ?? 0} 条（同 key 覆盖）\n` +
          `· 计划 ${plans} 份 / 我的资源 ${resources} 条（按 id 覆盖）\n\n` +
          `不会清空现有数据，但同 key 的记录会被备份中的值覆盖。是否继续？`,
      );
      if (!confirmed) return '已取消导入';
      const report = await restoreBackup(parsed.backup, host);
      return (
        `恢复完成：新增任务 ${report.tasksAdded}（跳过重复 ${report.tasksSkipped}）· ` +
        `插件数据 ${report.pluginRows} 条 · 计划数据 ${report.plannerKv + report.plannerPlans + report.plannerResources} 条` +
        `（重新进入页面即可看到最新数据）`
      );
    });

  return (
    <div className="card p-5">
      <div className="flex items-center mb-6">
        <div className="p-2 bg-indigo-50 rounded-lg mr-4">
          <FaDatabase className="w-5 h-5 text-indigo-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">数据管理</h2>
      </div>

      <p className="mb-4 text-[11px] leading-relaxed text-ink-3">
        打包任务、插件数据、计划与资源、应用设置；数据只留在本机。
      </p>

      {status && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-start text-sm ${
            status.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {status.type === 'success' ? (
            <FaCheck className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
          ) : (
            <FaExclamationCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
          )}
          <span>{status.text}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => void handleExport()}
          disabled={busy !== null}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
        >
          {busy === 'export' ? (
            <FaSpinner className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <FaDownload className="w-3.5 h-3.5 mr-2" />
          )}
          下载备份
        </button>
        <button
          onClick={() => void handleCopy()}
          disabled={busy !== null}
          className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-60"
        >
          <FaClipboard className="w-3.5 h-3.5 mr-2" />
          复制为 JSON
        </button>
        <button
          onClick={handlePickFile}
          disabled={busy !== null}
          className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-60"
        >
          {busy === 'import' ? (
            <FaSpinner className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <FaUpload className="w-3.5 h-3.5 mr-2" />
          )}
          从备份恢复
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
};
