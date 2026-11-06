import type { TurnedOver } from './flip';
import type { PartCam } from './toolpaths';

/** Derived release motion keeps its numerical contract; stock-history counts belong to the original operation list. */
export function releaseMetadata(cam: PartCam, turned?: TurnedOver): Pick<PartCam, 'accuracy' | 'stockFootprint' | 'stockSummary'> {
  return {
    accuracy: cam.accuracy,
    stockSummary: undefined,
    stockFootprint: cam.stockFootprint?.map(loop => {
      const mapped = loop.map(point => ({ ...point, ...(turned ? { y: turned.h - point.y } : {}) }));
      // Reflection reverses winding; preserve outer/hole orientation in the transformed blank.
      return turned ? mapped.reverse() : mapped;
    }),
  };
}
