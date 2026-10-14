// src/features/plan-generator/hooks/useTraces.ts
// 轨迹面板的数据源：订阅 `traceStore`（内存环形缓冲）+ 首次挂载时补一次历史记录。
//
// 两个细节：
//   1) **只在内存为空时 hydrate**：避免"刚跑完一次生成、面板却把内存里的新轨迹替换成旧的持久化数据"；
//   2) 订阅返回的取消函数必须包一层 —— store 内部的 unsubscribe 返回 boolean，
//      直接当 effect 清理函数虽然 TS 允许，但语义上不干净。
import { useCallback, useEffect, useState } from 'react';
import { traceStore, type AgentRunTrace } from '../services/agent/trace';

export interface UseTracesResult {
  traces: AgentRunTrace[];
  loading: boolean;
  clear: () => void;
  refresh: () => void;
}

export function useTraces(): UseTracesResult {
  const [traces, setTraces] = useState<AgentRunTrace[]>(() => traceStore.list());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = traceStore.subscribe(setTraces);
    void (async () => {
      try {
        if (traceStore.list().length === 0) await traceStore.hydrate();
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      unsubscribe();
    };
  }, []);

  const clear = useCallback(() => {
    traceStore.clear();
    setTraces(traceStore.list());
  }, []);

  const refresh = useCallback(() => setTraces(traceStore.list()), []);

  return { traces, loading, clear, refresh };
}
