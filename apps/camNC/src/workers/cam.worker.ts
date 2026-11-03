import {
  detectFlat,
  extractFeatures,
  flatMatrix,
  groupIdentical,
  loadStep,
  loadStl,
  summarizePart,
  type FlatPart,
  type StepBody,
} from '@wbcnc/cam';
import * as Comlink from 'comlink';
// Lazy: this worker only starts when a model is opened, and occt only loads the wasm on the first STEP file.
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { BodyMesh, CamPartInfo, ModelImport } from '../cam/camTypes';

async function readBodies(bytes: Uint8Array, fileName: string): Promise<{ bodies: StepBody[]; readMs: number }> {
  if (/\.stl$/i.test(fileName)) {
    const t0 = performance.now();
    const bodies = loadStl(bytes, fileName.replace(/\.stl$/i, ''));
    return { bodies, readMs: performance.now() - t0 };
  }
  return loadStep(bytes, { locateFile: () => occtWasmUrl });
}

const api = {
  /** STEP or STL → flat parts, identical ones grouped, with feature summaries and display meshes. */
  async importModel(bytes: Uint8Array, fileName: string): Promise<ModelImport> {
    const { bodies, readMs } = await readBodies(bytes, fileName);
    const t0 = performance.now();
    const flat = bodies.map(b => detectFlat(b));
    const groups = groupIdentical(flat);
    const partOf = new Map<FlatPart, string>();
    const parts: CamPartInfo[] = groups.map((g, i) => {
      const id = `part-${i}`;
      g.names.forEach(n => partOf.set(flat.find(f => f.name === n && !partOf.has(f))!, id));
      const notFlat = g.part.prismaticRatio < 0.95;
      // Freeform parts (350k triangles of knife slots) would take ~30s and give nothing machinable.
      const summary = summarizePart(g.part, notFlat ? emptyFeatures(g.part) : extractFeatures(g.part.mesh, g.part.thickness));
      return { id, name: g.names[0], names: g.names, size: g.part.size, thickness: g.part.thickness, summary };
    });
    const meshes: BodyMesh[] = bodies.map((b, i) => ({
      name: b.name,
      partId: partOf.get(flat[i]) ?? parts[0].id,
      positions: Float32Array.from(b.mesh.positions),
      indices: b.mesh.indices,
      flat: flatMatrix(flat[i]),
    }));
    const result: ModelImport = { parts, meshes, readMs, analyzeMs: performance.now() - t0 };
    return Comlink.transfer(
      result,
      meshes.flatMap(m => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer])
    );
  },
};

function emptyFeatures(part: FlatPart) {
  return {
    thickness: part.thickness,
    footprint: [],
    outlines: [],
    throughHoles: [],
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

export type CamWorkerAPI = typeof api;
Comlink.expose(api);
