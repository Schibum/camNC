import type { CadCut, CadDiagnostic, CadFaceSketch, CadPart } from './types';

export const cadFaceSketches = (part: CadPart): CadFaceSketch[] => (part.features ?? []).filter(f => f.type === 'sketch');
export const cadCuts = (part: CadPart): CadCut[] => (part.features ?? []).filter(f => f.type === 'cut');

/** The profile sketch first, then the face sketches, each as a part the sketch checks and the solver can walk. */
export function sketchTargets(part: CadPart): CadPart[] {
  return [part, ...cadFaceSketches(part).map(face => ({ id: part.id, name: part.name, thickness: part.thickness, sketch: face.sketch }))];
}

export function validateCadFeatures(part: CadPart): CadDiagnostic[] {
  const diagnostics: CadDiagnostic[] = [];
  const error = (code: string, message: string) => diagnostics.push({ code, message, severity: 'error', partId: part.id });
  const sketchIds = new Set([part.sketch.id]),
    seenCuts = new Set<string>(),
    regions = new Set<string>();
  for (const feature of part.features ?? []) {
    if (feature.type === 'sketch') {
      if (typeof feature.on === 'object' && !seenCuts.has(feature.on.floorOf))
        error('invalid-face', 'A sketch can only sit on the floor of an earlier cut.');
      sketchIds.add(feature.sketch.id);
      continue;
    }
    if (!sketchIds.has(feature.sketchId)) error('invalid-cut', 'A cut needs an earlier sketch on the same part.');
    if (feature.depth !== 'through' && (!Number.isFinite(feature.depth) || feature.depth < 0))
      error('invalid-depth', 'A cut depth must be zero or more, or through.');
    const region = `${feature.sketchId}\n${feature.regionId}`;
    if (regions.has(region)) error('duplicate-cut', 'A sketch region can only have one cut.');
    regions.add(region);
    seenCuts.add(feature.id);
  }
  return diagnostics;
}
