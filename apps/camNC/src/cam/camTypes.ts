import type { Tool } from '@wbcnc/cam';

/** Closed polygons as [x, y] point lists (structured-clone friendly). */
export type Outline2D = [number, number][][];

export interface CamPartSummary {
  id: string;
  name: string;
  /** All identical bodies (quantity = names.length). */
  names: string[];
  size: [number, number, number];
  thickness: number;
  twoSided: boolean;
  warnings: string[];
  outlines: Outline2D;
  holes: Outline2D;
  pockets: { z: number; region: Outline2D }[];
}

export interface GeneratedJob {
  gcode: string;
  warnings: string[];
  timeMin: number;
  operations: { name: string; tool: Tool; passes: number }[];
  path: [number, number, number][][];
}
