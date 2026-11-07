import { solveCadDocument, type CadDocument, type EvaluatedCadPart } from '@wbcnc/cad';
import { featuresFromCuts, summarizePart, type FlatPart, type PartFeatures } from '@wbcnc/cam';
import { ExtrudeGeometry, Path, Shape, Vector2 } from 'three';
import type { BodyMesh, CamPartInfo, ModelImport, Outline2D } from './camTypes';
import { cutPartMesh } from './cutPartMesh';

export interface NativeCadEntry {
  part: FlatPart;
  features: PartFeatures;
}

/** Native curves are tessellated once by CAD, then go straight to CAM's polygon feature seam. */
function nativePart(source: EvaluatedCadPart): { entry: NativeCadEntry; info: CamPartInfo; mesh: BodyMesh } {
  if (source.cuts?.some(cut => cut.side === 'underside')) throw new Error(`${source.name}: cuts on the underside can’t be machined yet.`);
  // A through cut can move the part's edge, and every part starts at 0,0 on its board.
  const cutOutlines = source.cuts?.length
    ? featuresFromCuts({
        thickness: source.thickness,
        outline: source.outline,
        holes: source.holes,
        cuts: source.cuts,
      }).features.outlines.flat()
    : source.outline;
  const x0 = Math.min(...cutOutlines.map(p => p.x));
  const y0 = Math.min(...cutOutlines.map(p => p.y));
  const point = (p: { x: number; y: number }) => ({ x: p.x - x0, y: p.y - y0 });
  const outline = source.outline.map(point);
  const holes = source.holes.map(h => h.map(point));
  const area = (loop: { x: number; y: number }[]) =>
    loop.reduce((sum, p, i) => {
      const q = loop[(i + 1) % loop.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2;
  const positive = (loop: { x: number; y: number }[]) => (area(loop) < 0 ? [...loop].reverse() : loop);
  const outer = positive(outline);
  const inner = holes.map(positive);
  const footprint = [outer, ...inner.map(h => [...h].reverse())];
  const holeLoops = source.loops.filter(loop => loop.kind === 'hole').map(loop => loop.id);
  const cut = source.cuts?.length
    ? featuresFromCuts({
        thickness: source.thickness,
        outline: outer,
        holes: inner,
        cuts: source.cuts.map(c => ({ ...c, outline: c.outline.map(point), islands: c.islands.map(island => island.map(point)) })),
      })
    : null;
  const features: PartFeatures = cut?.features ?? {
    thickness: source.thickness,
    footprint,
    outlines: [outer],
    throughHoles: inner,
    levels: [{ z: source.thickness, region: footprint, area: area(outer) - inner.reduce((sum, h) => sum + area(h), 0) }],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
  let positions: Float64Array, indices: Uint32Array;
  if (cut) ({ positions, indices } = cutPartMesh(cut.features));
  else {
    const shape = new Shape(outer.map(p => new Vector2(p.x, p.y)));
    shape.holes.push(...inner.map(h => new Path(h.map(p => new Vector2(p.x, p.y)))));
    const geometry = new ExtrudeGeometry(shape, { depth: source.thickness, bevelEnabled: false, curveSegments: 4 });
    positions = Float64Array.from(geometry.getAttribute('position').array);
    indices = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
    geometry.dispose();
  }
  const edge = features.outlines.flat();
  const size: [number, number, number] = [Math.max(...edge.map(p => p.x)), Math.max(...edge.map(p => p.y)), source.thickness];
  const part: FlatPart = {
    name: source.name,
    size,
    thickness: source.thickness,
    mesh: { positions, indices, faceRanges: [] },
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    origin: [0, 0, 0],
    topFeatureArea: features.pockets.reduce((sum, pocket) => sum + pocket.area, 0),
    bottomFeatureArea: 0,
    flipped: false,
    prismaticRatio: 1,
    slopedShare: 0,
    slopedArea: 0,
  };
  const paths = (loops: { x: number; y: number }[][]): Outline2D => loops.map(loop => loop.map(p => [p.x, p.y]));
  return {
    entry: { part, features },
    info: {
      id: source.partId,
      holeIds: cut ? cut.holeSources.map(from => ('hole' in from ? holeLoops[from.hole]! : from.cut)) : holeLoops,
      sourceOrigin: [x0, y0],
      name: source.name,
      modelName: source.name,
      names: [source.name],
      size,
      thickness: source.thickness,
      summary: summarizePart(part, features),
      shape: {
        outlines: paths(features.outlines),
        holes: paths(features.throughHoles),
        pockets: features.pockets.map(pocket => ({ depth: source.thickness - pocket.floorZ, region: paths(pocket.strictRegion) })),
      },
    },
    mesh: {
      name: source.name,
      partId: source.partId,
      positions: Float32Array.from(positions),
      indices: indices.slice(),
      flat: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
  };
}

export async function nativeCadModel(document: CadDocument): Promise<{ model: ModelImport; entries: Map<string, NativeCadEntry> }> {
  const started = performance.now();
  const solved = await solveCadDocument(document);
  if (solved.status !== 'solved') throw new Error(solved.diagnostics.map(d => d.message).join(' ') || 'The design could not be solved.');
  const parts = solved.parts.map(nativePart);
  return {
    entries: new Map(parts.map(p => [p.info.id, p.entry])),
    model: { parts: parts.map(p => p.info), meshes: parts.map(p => p.mesh), readMs: 0, analyzeMs: performance.now() - started },
  };
}
