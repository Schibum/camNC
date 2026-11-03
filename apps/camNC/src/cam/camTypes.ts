import type { PartSummary } from '@wbcnc/cam';

/** One part to make: a group of identical bodies, laid flat (Z up, Z0 = bottom face). */
export interface CamPartInfo {
  /** Stable for the same model file: `part-<n>` in import order. */
  id: string;
  name: string;
  /** All identical bodies; the quantity is names.length. */
  names: string[];
  size: [number, number, number];
  thickness: number;
  summary: PartSummary;
}

/** A body for display, in the model's coordinates; `flat` (column-major 4x4) lays it flat. */
export interface BodyMesh {
  name: string;
  partId: string;
  positions: Float32Array;
  indices: Uint32Array;
  flat: number[];
}

export interface ModelImport {
  parts: CamPartInfo[];
  meshes: BodyMesh[];
  readMs: number;
  analyzeMs: number;
}

export interface OpSummary {
  name: string;
  /** For people: "Pocket 4.2 deep", "Outline: rough + final pass". */
  label: string;
  kind: 'pocket' | 'profile';
  tool: { number: number; diameter: number };
  zTop: number;
  zBottom: number;
  /** Distinct depths the operation cuts at (pocket stepdowns, outline roughing + final). */
  depthSteps: number;
  /** Cutting feeds used, fastest first (the final pass may be slower). */
  feeds: number[];
  timeMin: number;
}

export interface PlanResult {
  gcode: string;
  timeMin: number;
  warnings: string[];
  /** Broken safety rules (empty when fine): never shown as a downloadable program then. */
  safety: string[];
  ops: OpSummary[];
  size: [number, number, number];
  path: [number, number, number][][];
}
