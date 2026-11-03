import type { FlipRegistration, TabFallback } from '@wbcnc/cam';
import type { HoldDown, PartSummary, TabStop } from '@wbcnc/cam';

/** Closed polygons as [x, y] point lists, in the part's flat frame (mm). */
export type Outline2D = [number, number][][];

/** One part to make: a group of identical bodies, laid flat (Z up, Z0 = bottom face). */
export interface CamPartInfo {
  /** Stable for the same model file: `part-<n>` in import order. */
  id: string;
  /** The job's name for the part: the model's, unless the user renamed it (see `withPartNames`). */
  name: string;
  /** The name in the model file, before any rename. */
  modelName?: string;
  /** One name per identical body, as shown on every step and in the G-code; the quantity is names.length. */
  names: string[];
  size: [number, number, number];
  thickness: number;
  summary: PartSummary;
  /** Top view for the nesting view. */
  shape: { outlines: Outline2D; holes: Outline2D; pockets: { depth: number; region: Outline2D }[] };
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
  /** The deepest single step down, mm, from where the operation starts cutting. */
  stepdown: number;
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
  /** Bit diameters in the order the program uses them. */
  bits: number[];
  /**
   * What to run: one program per bit (FluidNC can't zero Z during an M0 pause, so bit swaps happen between programs).
   * `gcode` is all of them in order, for previews.
   */
  programs: { tool: number; diameter: number; gcode: string; timeMin: number }[];
  size: [number, number, number];
  path: [number, number, number][][];
  /**
   * With tabs: per part, which tabs hold it once its outline is cut through (the stock beyond a tab must be wide
   * enough and reach the board's edge). A part with too few is not held: the job is blocked.
   */
  hold?: { part: string; tabs: { at: { x: number; y: number }; anchored: boolean }[]; anchored: number; ok: boolean }[];
  /** With tabs: how each part is held: tabs where they hold, or its fallback (a bottom skin, tabs anyway, by hand). */
  /** Per part: tabs placed (`tabs` of them; `wanted` when fewer fit than asked), or its fallback. */
  holding?: { name: string; how: 'placed' | TabFallback; tabs: number; wanted?: number }[];
  /** Bottom skin thickness, mm, for the parts that have one. */
  skin?: number;
  /** The board's second side, after turning it over top to bottom: the programs for the parts' undersides. */
  sideB?: PlanResult;
  /** How side B lines up; for dowels, where the pins go (and why there's no room for them). */
  flip?: { registration: FlipRegistration; dowels?: { x: number; y: number }[]; dowelDiameter?: number; problem?: string };
}

/** A board to generate: which bodies sit where. */
export interface BoardRequest {
  id: string;
  name: string;
  w: number;
  h: number;
  thickness: number;
  /** Stock top Z (thickness + allowance, or measured). */
  stockTop: number;
  /** Board lying askew on the bed: the program is turned about the XY zero (degrees, counterclockwise). */
  rotationDeg?: number;
  holdDown: HoldDown;
  tabs: { width: number; height: number; minCount: number };
  parts: { id: string; partId: string; name: string; x: number; y: number; rotated: boolean; tabFallback?: TabFallback }[];
  /** A second side for the parts' undersides, and how it lines up after turning the board over. */
  flip?: { registration: FlipRegistration; dowelDiameter?: number };
  /** With tabs: what parts without a spot for tabs that hold get (each part may choose its own), and the skin. */
  tabFallback?: TabFallback;
  skin?: number;
}

/** After cutting a board with bottom-skin parts: frees them one at a time, each paused for taking it out. */
export interface FreePartsResult {
  gcode: string;
  /** In program order, with a spot to point at (board coordinates). */
  parts: { name: string; at: { x: number; y: number } }[];
  timeMin: number;
}

/** A guided tab removal program for a board: one pause per tab, then a cut through it. */
export interface TabRemovalResult {
  gcode: string;
  tabs: TabStop[];
  timeMin: number;
}
