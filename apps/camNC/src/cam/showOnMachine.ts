import { useStore } from '@/store/store';
import { useDepthView } from '@/visualize/depthViewStore';
import type { PlanResult } from './camTypes';
import { isManufacturingLocked } from './machine/camMachine';

/**
 * Hand a generated program to the top view, simulation and job checklist with its setup, instead of letting them
 * guess: stock height = the board's stock top (Z0 is the bottom of the board), the bit's diameter, a flat end mill.
 * The simulation uses one bit; with several, it shows the first.
 */
export function loadIntoMachineView(plan: Pick<PlanResult, 'gcode' | 'size' | 'bits'>, name: string) {
  if (isManufacturingLocked()) return;
  const store = useStore.getState();
  store.updateToolpath(plan.gcode, name);
  store.setStockHeight(plan.size[2]);
  if (plan.bits[0]) store.setToolDiameter(plan.bits[0]);
  const depth = useDepthView.getState();
  depth.setZeroAt('bottom');
  depth.setToolShape('flat');
}

/** Nothing to show or run: what's loaded is not what the current step is about. */
export function clearMachineView() {
  if (isManufacturingLocked()) return;
  useStore.setState(state => {
    state.toolpath = null;
    state.toolpathName = null;
    state.stockHeightCheck = null;
  });
}
