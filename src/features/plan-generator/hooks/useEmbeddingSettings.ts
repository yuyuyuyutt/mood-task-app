// src/features/plan-generator/hooks/useEmbeddingSettings.ts
// 本地语义检索（向量）设置：开关 / embedding 模型 / 超时。
// 端点不单独配置 —— 沿用「AI 增强」里的本地模型地址，避免出现"两个 Ollama 地址"的困惑。
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_EMBEDDING_SETTINGS, type EmbeddingSettings } from '../types';
import { KV_EMBEDDING, KV_LLM_CONFIG, kvGet, kvSet } from '../db/plannerDB';
import { DEFAULT_LLM_CONFIG, type LLMConfig } from '../services/llmClient';

export interface UseEmbeddingSettingsResult {
  settings: EmbeddingSettings;
  loading: boolean;
  /** 实际使用的 embedding 端点（只读展示） */
  endpoint: string;
  update: (patch: Partial<EmbeddingSettings>) => Promise<void>;
  reset: () => Promise<void>;
}

export function useEmbeddingSettings(): UseEmbeddingSettingsResult {
  const [settings, setSettings] = useState<EmbeddingSettings>(DEFAULT_EMBEDDING_SETTINGS);
  const [endpoint, setEndpoint] = useState<string>(DEFAULT_LLM_CONFIG.baseUrl);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [saved, llm] = await Promise.all([
          kvGet<EmbeddingSettings>(KV_EMBEDDING),
          kvGet<LLMConfig>(KV_LLM_CONFIG),
        ]);
        if (!alive) return;
        if (saved) setSettings({ ...DEFAULT_EMBEDDING_SETTINGS, ...saved });
        setEndpoint(llm?.baseUrl || DEFAULT_LLM_CONFIG.baseUrl);
      } catch (err) {
        console.warn('读取语义检索设置失败:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<EmbeddingSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await kvSet(KV_EMBEDDING, next);
    },
    [settings],
  );

  const reset = useCallback(async () => {
    setSettings(DEFAULT_EMBEDDING_SETTINGS);
    await kvSet(KV_EMBEDDING, DEFAULT_EMBEDDING_SETTINGS);
  }, []);

  return { settings, loading, endpoint, update, reset };
}
