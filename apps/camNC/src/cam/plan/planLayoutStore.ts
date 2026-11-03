import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';

/** The Plan step's sidebar: the board's operations, or the job's bit and cutting settings. */
export type PlanTab = 'operations' | 'settings';
/** The operations as a list (one row per op, the selected one opened) or a table with every op's numbers side by side. */
export type PlanOpsView = 'list' | 'table';

/** How the Plan step's sidebar was last left: remembered per viewer, across boards, jobs and reloads. */
export const usePlanLayout = create(
  persist(
    combine({ tab: 'operations' as PlanTab, opsView: 'list' as PlanOpsView }, set => ({
      setTab: (tab: PlanTab) => set({ tab }),
      setOpsView: (opsView: PlanOpsView) => set({ opsView }),
    })),
    { name: 'camnc-plan-layout' }
  )
);
