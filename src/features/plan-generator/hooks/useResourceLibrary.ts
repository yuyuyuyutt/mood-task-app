// src/features/plan-generator/hooks/useResourceLibrary.ts
// 用户自己的资源库（手动添加）：本地 IndexedDB 保存，不联网、不上传。
import { useCallback, useEffect, useState } from 'react';
import type { ManualResource, ResourceType } from '../types';
import {
  deleteManualResource,
  getAllManualResources,
  putManualResource,
} from '../db/plannerDB';

export interface NewManualResourceInput {
  title: string;
  url: string;
  type: ResourceType;
  author?: string;
  keywords?: string[];
  note?: string;
}

export interface UseResourceLibraryResult {
  resources: ManualResource[];
  loading: boolean;
  add: (input: NewManualResourceInput) => Promise<ManualResource>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function makeId(url: string): string {
  let h = 5381;
  const seed = `${url}`;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return `manual-${(h >>> 0).toString(36)}`;
}

/** 基础校验：仅接受 http(s) 链接与非空标题 */
export function validateManualResource(input: NewManualResourceInput): string | null {
  if (input.title.trim().length < 2) return '标题至少 2 个字';
  if (!/^https?:\/\//i.test(input.url.trim())) return '请填写以 http(s):// 开头的链接';
  return null;
}

export function useResourceLibrary(): UseResourceLibraryResult {
  const [resources, setResources] = useState<ManualResource[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setResources(await getAllManualResources());
    } catch (err) {
      console.warn('读取资源库失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (input: NewManualResourceInput): Promise<ManualResource> => {
      const error = validateManualResource(input);
      if (error) throw new Error(error);
      const resource: ManualResource = {
        id: makeId(input.url.trim() + input.title.trim()),
        title: input.title.trim().slice(0, 160),
        url: input.url.trim(),
        type: input.type,
        author: input.author?.trim() || undefined,
        keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 8),
        note: input.note?.trim().slice(0, 200) || undefined,
        createdAt: new Date().toISOString(),
      };
      await putManualResource(resource);
      await refresh();
      return resource;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteManualResource(id);
      await refresh();
    },
    [refresh],
  );

  return { resources, loading, add, remove, refresh };
}
