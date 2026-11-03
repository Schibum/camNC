import type { FlipRegistration, TabFallback } from '@wbcnc/cam';
import type { HoldDown, HoldPoint, PartSummary, TabStop } from '@wbcnc/cam';

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
  /** One step of a guided program after the cutting (see `ReleaseProgram`): shown together as that program's row. */
  program?: { kind: ReleaseProgram['kind']; title: string; note: string };
}

/**
 * Planned with the board, run after its cutting (after side B, when there is one) in this order: freeing bottom-skin
 * parts or the layer on the tape, then the guided tab removal. The Plan step shows it, the machine queue runs it.
 */
export interface ReleaseProgram {
  kind: 'free' | 'tabs';
  /** "Free the parts", "Cut free", "Remove the tabs". */
  title: string;
  gcode: string;
  timeMin: number;
  tool: number;
  diameter: number;
  /** Stops for a person: holding a part, taking one out. The spindle confirmation every program starts with doesn't count. */
  pauses: number;
  /** "8 pauses: take out each part". */
  note: string;
  ops: OpSummary[];
  /** Broken safety rules: block the job like any other program's. */
  safety: string[];
  /** Cut with the board turned over (the skins or tabs on top), after side B. */
  turned: boolean;
  /** Freeing: the parts in program order, with a spot to point at (program coordinates). */
  parts?: { name: string; at: { x: number; y: number } }[];
  /** Tab removal: the tabs, and where to hold the part (program coordinates). */
  tabs?: TabStop[];
  /** Tab removal: one pause per part (all its tabs, then take it out), not one before every tab. */
  perPart?: boolean;
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
  /**
   * What comes loose during the job, at the step where it happens (see `holdTimeline`). `block`: the job is blocked
   * (stock that can turn or lift; a part that should be held but isn't). Without `block`: as the user chose (nothing
   * holds the parts).
   */
  timeline?: {
    step: number;
    after: string;
    kind: 'pivot' | 'loose';
    what: string;
    at: { x: number; y: number };
    block: boolean;
    message: string;
  }[];
  /** Hold points the bit would hit (blocks the job). */
  holdClash?: { x: number; y: number }[];
  /** With tabs: how each part is held: tabs where they hold, or its fallback (a bottom skin, tabs anyway, by hand). */
  /** Per part: tabs placed (`tabs` of them; `wanted` when fewer fit than asked), or its fallback. */
  holding?: { name: string; how: 'placed' | TabFallback; tabs: number; wanted?: number }[];
  /** Bottom skin thickness, mm, for the parts that have one. */
  skin?: number;
  /** The board is taped down: the skin is the layer on the tape, cut for all parts in one go at the end. */
  taped?: boolean;
  /** The board's second side, after turning it over top to bottom: the programs for the parts' undersides. */
  sideB?: PlanResult;
  /** How side B lines up; for dowels, where the pins go (and why there's no room for them). */
  flip?: { registration: FlipRegistration; dowels?: { x: number; y: number }[]; dowelDiameter?: number; problem?: string };
  /** What's left for after the cutting, in machine queue order. */
  release?: ReleaseProgram[];
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
  /** The board turned over can lie at another angle than side A (camera registration); unset: as side A. */
  sideBRotationDeg?: number;
  holdDown: HoldDown;
  /** Where the board is screwed or clamped down (board frame). None: taped, or held at its edges. */
  holdPoints?: HoldPoint[];
  tabs: { width: number; height: number; minCount: number };
  parts: { id: string; partId: string; name: string; x: number; y: number; rotated: boolean; tabFallback?: TabFallback }[];
  /** A second side for the parts' undersides, and how it lines up after turning the board over. */
  flip?: { registration: FlipRegistration; dowelDiameter?: number };
  /** With tabs: what parts without a spot for tabs that hold get (each part may choose its own), and the skin. */
  tabFallback?: TabFallback;
  skin?: number;
}
