import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';
import type { Projection, ViewKind } from './framing';

/** Result: the simulated board with the timeline. Toolpath: every op's moves at their real depth. */
export type Plan3dMode = 'result' | 'toolpath';

/** How the 3D Plan view was last set up: remembered across boards, jobs and reloads. */
export const usePlan3dView = create(
  persist(
    combine(
      {
        mode: 'result' as Plan3dMode,
        /** Semi-transparent stock with the finished part as a ghost. */
        seeThrough: false,
        view: '3d' as ViewKind,
        /** Per view, so the top view can stay orthographic while the 3D view is in perspective. */
        projection: { top: 'orthographic', '3d': 'perspective' } as Record<ViewKind, Projection>,
        showRapids: true,
        /** Result mode: colour the cut board against the model (as designed / material left / cut too deep). */
        compare: false,
      },
      set => ({
        setMode: (mode: Plan3dMode) => set({ mode }),
        setSeeThrough: (seeThrough: boolean) => set({ seeThrough }),
        setView: (view: ViewKind) => set({ view }),
        /** For the current view. */
        setProjection: (projection: Projection) => set(s => ({ projection: { ...s.projection, [s.view]: projection } })),
        setShowRapids: (showRapids: boolean) => set({ showRapids }),
        setCompare: (compare: boolean) => set({ compare }),
      })
    ),
    { name: 'camnc-plan-3d-view' }
  )
);
