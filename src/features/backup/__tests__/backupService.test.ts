// src/features/backup/__tests__/backupService.test.ts
// 备份模块：重点覆盖"文件校验"这条最容易出错的路径，以及无 IPC/无 IndexedDB 时的降级行为。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  createBackup,
  parseBackup,
  type BackupHost,
} from '../backupService';

const host: BackupHost = {
  dumpPluginData: async () => [],
  restorePluginData: async (rows) => rows.length,
};

function validBackup(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-09-14T10:00:00.000Z',
    data: { tasks: [], pluginData: [], planner: { kv: [], plans: [], resources: [] } },
    ...overrides,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseBackup', () => {
  it('接受合法备份', () => {
    const result = parseBackup(validBackup());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup.version).toBe(BACKUP_VERSION);
  });

  it('拒绝非 JSON 文本', () => {
    const result = parseBackup('这不是 json');
    expect(result).toEqual({ ok: false, error: '文件不是合法的 JSON' });
  });

  it('拒绝其他应用的 JSON', () => {
    const result = parseBackup(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
  });

  it('拒绝版本高于当前支持的备份（避免误导入未来结构）', () => {
    const result = parseBackup(validBackup({ version: BACKUP_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/高于当前支持的/);
  });

  it('拒绝缺少 data 的备份', () => {
    const result = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }));
    expect(result.ok).toBe(false);
  });
});

describe('createBackup', () => {
  it('在无 IPC / 无 IndexedDB 的环境下降级为空备份，而不是抛错', async () => {
    const backup = await createBackup(host);
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.data.tasks).toEqual([]);
    expect(backup.data.pluginData).toEqual([]);
    expect(backup.data.planner).toEqual({ kv: [], plans: [], resources: [] });
    expect(backup.data.userProfile).toBeNull();
    expect(typeof backup.data.appSettings.language).toBe('string');
  });
});

describe('backupFileName', () => {
  it('按日期生成文件名', () => {
    expect(backupFileName(new Date(2026, 8, 14))).toBe('mood-task-backup-2026-09-14.json');
  });
});
