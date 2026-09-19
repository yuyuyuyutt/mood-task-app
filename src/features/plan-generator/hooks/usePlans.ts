// src/features/plan-generator/hooks/usePlans.ts
// 计划 CRUD Hook（IndexedDB 'plans' store）。
import { useCallback, useEffect, useState } from 'react';
import type { GeneratedPlan } from '../types';
import { deletePlan, getAllPlans, putPlan } from '../db/plannerDB';

export interface UsePlansResult {
  plans: GeneratedPlan[];
  loading: boolean;
  /** 新建/更新计划文档 */
  savePlan: (plan: GeneratedPlan) => Promise<void>;
  /** 一键删除计划 */
  removePlan: (id: string) => Promise<void>;
  /** 接受计划（记录接受状态） */
  acceptPlan: (plan: GeneratedPlan) => Promise<void>;
  /** 拒绝计划并填写反馈（全部本地保存） */
  rejectPlan: (plan: GeneratedPlan, feedback: string) => Promise<void>;
  /** 删除某计划的反馈 */
  refresh: () => Promise<void>;
}

export function usePlans(): UsePlansResult {
  const [plans, setPlans] = useState<GeneratedPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const all = await getAllPlans();
      setPlans(all);
    } catch (err) {
      console.warn('读取计划失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savePlan = useCallback(async (plan: GeneratedPlan) => {
    await putPlan(plan);
    await refresh();
  }, [refresh]);

  const removePlan = useCallback(
    async (id: string) => {
      await deletePlan(id);
      await refresh();
    },
    [refresh],
  );

  const acceptPlan = useCallback(
    async (plan: GeneratedPlan) => {
      await putPlan({ ...plan, accepted: true, feedback: null });
      await refresh();
    },
    [refresh],
  );

  const rejectPlan = useCallback(
    async (plan: GeneratedPlan, feedback: string) => {
      await putPlan({ ...plan, accepted: false, feedback: feedback.trim() || '（未填写）' });
      await refresh();
    },
    [refresh],
  );

  return { plans, loading, savePlan, acceptPlan, rejectPlan, removePlan, refresh };
}
