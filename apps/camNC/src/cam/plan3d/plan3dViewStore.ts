import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';
import type { Projection, ViewKind } from './framing';

/**
 * Result: the simulated board with the timeline. Compare: the same board coloured against the model.
 * Toolpath: every op's moves at their real depth, through a see-through board.
 */
export type Plan3dMode = 'result' | 'compare' | 'toolpath';

/** Top is always orthographic; the 3D view can be either. */
export function projectionOf(view: ViewKind, ortho3d: boolean): Projection {
  return view === 'top' || ortho3d ? 'orthographic' : 'perspective';
}

/** How the 3D Plan view was last set up: remembered across boards, jobs and reloads. */
export const usePlan3dView = create(
  persist(
    combine(
      {
        mode: 'result' as Plan3dMode,
        /** Result mode: semi-transparent stock with the finished part as a ghost (Toolpath always is). */
        seeThrough: false,
        view: '3d' as ViewKind,
        /** The 3D view in orthographic instead of perspective. */
        ortho3d: false,
        showRapids: true,
      },
      set => ({
        setMode: (mode: Plan3dMode) => set({ mode }),
        setSeeThrough: (seeThrough: boolean) => set({ seeThrough }),
        setView: (view: ViewKind) => set({ view }),
        setOrtho3d: (ortho3d: boolean) => set({ ortho3d }),
        setShowRapids: (showRapids: boolean) => set({ showRapids }),
      })
    ),
    {
      name: 'camnc-plan-3d-view',
      version: 1,
      // v0 had a Compare toggle and a projection per view.
      migrate: (saved, version) => {
        type V0 = { mode?: 'result' | 'toolpath'; compare?: boolean; projection?: Record<ViewKind, Projection> };
        const s = (saved ?? {}) as V0;
        if (version >= 1) return s as never;
        const { compare, projection, ...rest } = s;
        return {
          ...rest,
          mode: rest.mode === 'result' && compare ? 'compare' : rest.mode,
          ortho3d: projection?.['3d'] === 'orthographic',
        } as never;
      },
    }
  )
);
