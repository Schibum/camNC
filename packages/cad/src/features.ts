import { newCadId, originId } from './document';
import { cadFaceSketches } from './featureModel';
import { CAD_CHORD_TOLERANCE, evaluateCadPart, validateCadDocument } from './geometry';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import { sketchRegions, type CadSketchRegion } from './sketchRegions';
import type {
  CadCutDepth,
  CadDiagnostic,
  CadDocument,
  CadFaceRef,
  CadFaceSketch,
  CadPart,
  CadPoint,
  CadSketch,
  EvaluatedCadCut,
  EvaluatedCadPart,
} from './types';

/** Features belong to the newer format, so an older build refuses the file instead of silently cutting without them. */
function withFeatureVersion(document: CadDocument): CadDocument {
  return { ...document, version: document.parts.some(part => part.features?.length) ? 2 : 1 };
}
function editPart(
  document: CadDocument,
  partId: string,
  edit: (features: NonNullable<CadPart['features']>) => CadPart['features']
): CadDocument {
  return withFeatureVersion({
    ...document,
    parts: document.parts.map(part => {
      if (part.id !== partId) return part;
      const { features: current, ...rest } = part,
        features = edit(current ?? []);
      return features?.length ? { ...rest, features } : rest;
    }),
  });
}

export function addFaceSketch(document: CadDocument, partId: string, on: CadFaceRef): { document: CadDocument; sketchId: string } {
  const sketch: CadSketch = { id: newCadId(), entities: [], constraints: [] };
  sketch.entities.push({ id: originId(sketch), type: 'point', x: 0, y: 0, fixed: true, construction: true });
  return {
    document: editPart(document, partId, features => [...features, { type: 'sketch', id: newCadId(), on, sketch }]),
    sketchId: sketch.id,
  };
}

/** Sets the depth of a region's cut, adding the cut if it has none. A region has at most one cut. */
export function setCutDepth(document: CadDocument, partId: string, sketchId: string, regionId: string, depth: CadCutDepth): CadDocument {
  return editPart(document, partId, features =>
    features.some(f => f.type === 'cut' && f.sketchId === sketchId && f.regionId === regionId)
      ? features.map(f => (f.type === 'cut' && f.sketchId === sketchId && f.regionId === regionId ? { ...f, depth } : f))
      : [...features, { type: 'cut', id: newCadId(), sketchId, regionId, depth }]
  );
}

/** Removes a feature, and the cuts of a removed sketch. Sketches on a removed cut's floor report the lost face. */
export function removeCadFeature(document: CadDocument, partId: string, featureId: string): CadDocument {
  return editPart(document, partId, features => {
    const gone = features.find(f => f.id === featureId),
      sketchId = gone?.type === 'sketch' ? gone.sketch.id : null;
    return features.filter(f => f.id !== featureId && !(f.type === 'cut' && f.sketchId === sketchId));
  });
}

/** The regions cuts can refer to in one of a part's sketches. Face sketches also use the part's outline as a boundary. */
export function cadSketchRegions(part: CadPart, sketchId: string, outline?: CadPoint[]): CadSketchRegion[] {
  if (sketchId === part.sketch.id) return sketchRegions(part.sketch, CAD_CHORD_TOLERANCE);
  const face = cadFaceSketches(part).find(candidate => candidate.sketch.id === sketchId);
  if (!face) return [];
  const points = outline ?? evaluateCadPart(part).part?.outline;
  return points ? sketchRegions(face.sketch, CAD_CHORD_TOLERANCE, { boundary: { id: `${part.id}:outline`, points } }) : [];
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Applies a part's features to its evaluated profile. An inner loop stays a through-hole unless its cut says otherwise,
 * so parts without features evaluate exactly as they always have.
 */
export function evaluateCadFeatures(part: CadPart, profile: EvaluatedCadPart): { part: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  if (!part.features?.length) return { part: profile, diagnostics: [] };
  const diagnostics: CadDiagnostic[] = [];
  const error = (code: string, message: string, entityIds?: string[]) =>
    diagnostics.push({ code, message, severity: 'error', partId: part.id, entityIds });
  const regions = new Map<string, CadSketchRegion[]>([[part.sketch.id, cadSketchRegions(part, part.sketch.id)]]);
  const faces = new Map<string, CadFaceRef>();
  for (const face of cadFaceSketches(part)) {
    regions.set(face.sketch.id, cadSketchRegions(part, face.sketch.id, profile.outline));
    faces.set(face.sketch.id, face.on);
  }
  const cuts: EvaluatedCadCut[] = [],
    keptHoles = new Set<string>();
  const start = (face: CadFaceRef | undefined): { side: EvaluatedCadCut['side']; from: number } | null => {
    if (face === undefined || face === 'top') return { side: 'top', from: 0 };
    if (face === 'underside') return { side: 'underside', from: 0 };
    const floor = cuts.find(cut => cut.id === face.floorOf);
    return floor && !floor.through ? { side: floor.side, from: floor.to } : null;
  };
  const uncut = profile.loops.filter(loop => loop.kind === 'hole');
  for (const feature of part.features) {
    if (feature.type !== 'cut') continue;
    const region = regions.get(feature.sketchId)?.find(candidate => candidate.id === feature.regionId);
    if (!region) {
      error('cut-region-missing', 'A cut lost its sketch region. Pick the region again, or remove the cut.');
      continue;
    }
    const at = start(faces.get(feature.sketchId));
    if (!at) {
      error('cut-face-lost', 'A sketch lost the pocket floor it sat on. Move it to another face, or remove it.', region.curveIds);
      continue;
    }
    const fromProfile = feature.sketchId === part.sketch.id,
      hole = fromProfile ? uncut.find(loop => sameIds(loop.entityIds, region.curveIds)) : undefined;
    if (hole && feature.depth === 'through') {
      keptHoles.add(hole.id);
      continue;
    }
    if (hole) uncut.splice(uncut.indexOf(hole), 1);
    if (fromProfile && !hole && feature.depth === 'through') {
      error('cut-whole-part', 'The whole part can’t be cut through. Pick a region inside it.', region.curveIds);
      continue;
    }
    if (feature.depth === 0) continue;
    const to = feature.depth === 'through' ? part.thickness : Math.min(part.thickness, at.from + feature.depth);
    cuts.push({
      id: feature.id,
      regionId: region.id,
      side: at.side,
      from: at.from,
      to,
      through: to >= part.thickness - CAD_GEOMETRY_TOLERANCE,
      outline: hole ? [...hole.points].reverse() : region.points,
      islands: region.holes,
    });
  }
  // Holes whose loop gained a depth aren't holes any more; every other inner loop keeps its place and order.
  const holes = profile.loops.filter(loop => loop.kind === 'hole' && (uncut.includes(loop) || keptHoles.has(loop.id)));
  return {
    part: {
      ...profile,
      holes: holes.map(loop => loop.points),
      loops: profile.loops.filter(loop => loop.kind === 'outer' || holes.includes(loop)),
      ...(cuts.length && { cuts }),
    },
    diagnostics,
  };
}

export function evaluateCadDocument(document: CadDocument): { parts: EvaluatedCadPart[]; diagnostics: CadDiagnostic[] } {
  const diagnostics = validateCadDocument(document);
  if (diagnostics.some(d => d.severity === 'error')) return { parts: [], diagnostics };
  const parts: EvaluatedCadPart[] = [];
  for (const part of document.parts) {
    const result = evaluateCadPart(part);
    diagnostics.push(...result.diagnostics);
    if (!result.part) continue;
    const evaluated = evaluateCadFeatures(part, result.part);
    diagnostics.push(...evaluated.diagnostics);
    parts.push(evaluated.part);
  }
  return { parts: diagnostics.some(d => d.severity === 'error') ? [] : parts, diagnostics };
}
