import { create } from 'zustand';

export interface CamStageDestination {
  stage: 'boards' | 'plan' | 'machine';
  board?: string;
  newTab?: boolean;
}
/** The mounted Design editor owns acceptance for every stage control, including the rail. */
export const useStageNavigation = create<{
  guard: { jobId: string; navigate: (destination: CamStageDestination) => void; pending: boolean } | null;
}>(() => ({ guard: null }));
