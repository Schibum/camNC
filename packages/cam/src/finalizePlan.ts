import { planAccuracy, type PlanAccuracy } from './accuracy';
import { limitRemovalRate } from './engagement';
import type { PathsD } from './geom';
import { StockModel } from './stock';
import { certifyStockLinks } from './stockPlan';
import type { PartCam } from './toolpaths';

export interface StockSummary {
  certifiedLinks: number;
  retractedLinks: number;
  limitedSegments: number;
  maximumPlanarRemovalRate: number;
  axialEntryExceptions: number;
  descendingSegments: number;
  conservativeFrontierSegments?: number;
}

export interface FinalizeSettings {
  feed: number;
  plungeFeed: number;
  stepoverFactor: number;
  geometryTolerance?: number;
  sourceTolerance?: number;
  pocketStrategy?: 'offset' | 'controlled';
  maxPlanarRemovalRate?: number;
  minimumCuttingFeed?: number;
}

export type FinalizedCam = PartCam & { accuracy: PlanAccuracy; stockSummary: StockSummary; stockFootprint?: PathsD };

/** Resolve stock decisions after final ordering. Blank means original material, never the finished silhouette. */
export function finalizePlan(cam: PartCam, settings: FinalizeSettings, blank?: PathsD): FinalizedCam {
  const accuracy = planAccuracy(settings.geometryTolerance, settings.sourceTolerance);
  const pathTolerance = accuracy.budget.fitting + accuracy.budget.outputRounding + accuracy.budget.controllerRounding;
  const stock = new StockModel({ stockTop: cam.stockTop, footprint: blank, tolerance: accuracy.budget.offset, pathTolerance });
  const summary: StockSummary = {
    certifiedLinks: 0,
    retractedLinks: 0,
    limitedSegments: 0,
    maximumPlanarRemovalRate: 0,
    axialEntryExceptions: 0,
    descendingSegments: 0,
    conservativeFrontierSegments: 0,
  };
  const operations = cam.operations.map(operation => {
    const rate =
      settings.maxPlanarRemovalRate ??
      (settings.pocketStrategy === 'controlled' && operation.kind === 'pocket'
        ? (operation.tool.feed ?? settings.feed) * (operation.tool.stepover ?? operation.tool.diameter * settings.stepoverFactor)
        : undefined);
    if (rate !== undefined) {
      const resolved = limitRemovalRate(operation.passes, operation.tool, stock, {
        maxPlanarRemovalRate: rate,
        minimumFeed: settings.minimumCuttingFeed ?? 1,
        plungeFeed: settings.plungeFeed,
      });
      summary.limitedSegments += resolved.limitedSegments;
      summary.maximumPlanarRemovalRate = Math.max(summary.maximumPlanarRemovalRate, resolved.maximumAreaRate);
      summary.axialEntryExceptions += resolved.axialEntries;
      summary.descendingSegments += resolved.descendingSegments;
      summary.conservativeFrontierSegments = (summary.conservativeFrontierSegments ?? 0) + resolved.conservativeFrontierSegments;
      summary.retractedLinks += resolved.retractedLinks;
      summary.certifiedLinks += resolved.passes.filter((pass, i) => i > 0 && pass.link === 'direct' && pass.clearLink).length;
      return { ...operation, passes: resolved.passes };
    }
    const resolved = certifyStockLinks({ ...cam, operations: [operation] }, { plungeFeed: settings.plungeFeed }, stock);
    summary.certifiedLinks += resolved.certificates.filter(proof => proof.certificate.clear).length;
    summary.retractedLinks += resolved.retractedLinks;
    return resolved.cam.operations[0];
  });
  const warnings = [...cam.warnings];
  if (summary.descendingSegments)
    warnings.push(
      `Planar material-rate limits exclude axial removal in ${summary.descendingSegments} descending moves; ramp/plunge feed and stepdown apply separately`
    );
  return {
    ...cam,
    operations,
    warnings: [...new Set(warnings)],
    accuracy,
    stockSummary: summary,
    stockFootprint: blank?.map(path => path.map(point => ({ ...point }))),
  };
}
