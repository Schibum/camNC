import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitByBit } from '../../src/board';
import type { PartFeatures } from '../../src/features';
import { finalizePlan } from '../../src/finalizePlan';
import { difference, polyArea, unionMany, type PathD, type Vec3 } from '../../src/geom';
import { postProgram } from '../../src/gcode';
import { camPart, DEFAULT_SETTINGS, profileOperation, type CamSettings, type PartCam } from '../../src/toolpaths';

export const CASE_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

type Shape =
  | { type: 'polygon'; points: [number, number][] }
  | { type: 'circle'; center: [number, number]; radius: number; segments: number };

export interface MachiningCaseInput {
  schemaVersion: 1;
  id: string;
  description: string;
  mode: 'part' | 'profiles';
  stockSize: Vec3;
  outline: Shape;
  pockets: { boundary: Shape; islands?: Shape[]; floorZ: number }[];
  profiles?: { name: string; shape: Shape; inside: boolean; toolNumber: number }[];
  settings: Partial<CamSettings>;
  expected: {
    minimumZ: number;
    programs: number;
    requiredRoles?: string[];
    protectedRectangles?: [number, number, number, number][];
    uncutRectangles?: [number, number, number, number][];
    warningIncludes?: string[];
    tabPlateau?: { x0: number; x1: number; centerY: number; minimumHeight: number };
    polish?: { insideOperation: string; outsideOperation: string; desiredWallFeed: number; springPasses: number };
  };
}

export function shapePath(shape: Shape): PathD {
  const path =
    shape.type === 'polygon'
      ? shape.points.map(([x, y]) => ({ x, y }))
      : Array.from({ length: shape.segments }, (_, i) => ({
          x: shape.center[0] + shape.radius * Math.cos((2 * Math.PI * i) / shape.segments),
          y: shape.center[1] + shape.radius * Math.sin((2 * Math.PI * i) / shape.segments),
        }));
  return polyArea([path]) >= 0 ? path : path.reverse();
}

export function readMachiningCases(): { input: MachiningCaseInput; inputText: string; inputFile: string }[] {
  return readdirSync(CASE_DIRECTORY)
    .filter(file => file.endsWith('.input.json'))
    .sort()
    .map(inputFile => {
      const inputText = readFileSync(`${CASE_DIRECTORY}/${inputFile}`, 'utf8');
      const input = JSON.parse(inputText) as MachiningCaseInput;
      if (input.schemaVersion !== 1 || !['part', 'profiles'].includes(input.mode) || inputFile !== `${input.id}.input.json`)
        throw new Error(`Unsupported machining case ${inputFile}`);
      return { input, inputText, inputFile };
    });
}

/** Explicit analytic features use nested depth regions, matching the planner's input contract. */
export function caseFeatures(input: MachiningCaseInput): PartFeatures {
  const outline = shapePath(input.outline);
  const pockets = input.pockets.map(pocket => ({
    floorZ: pocket.floorZ,
    region: [shapePath(pocket.boundary), ...(pocket.islands ?? []).map(island => shapePath(island).reverse())],
  }));
  const floors = [...new Set(pockets.map(pocket => pocket.floorZ))].sort((a, b) => b - a);
  return {
    thickness: input.stockSize[2],
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [],
    pockets: floors.map(floorZ => {
      const region = unionMany(pockets.filter(pocket => pocket.floorZ <= floorZ).flatMap(pocket => pocket.region));
      return { floorZ, region, strictRegion: region, above: difference([outline], region), area: polyArea(region) };
    }),
    bottomFaces: [],
    slopedArea: 0,
  };
}

export function generateMachiningCase(input: MachiningCaseInput) {
  const settings: CamSettings = { ...DEFAULT_SETTINGS, ...input.settings };
  let cam: PartCam;
  if (input.mode === 'part') cam = camPart(caseFeatures(input), settings);
  else {
    const top = settings.stockTop ?? input.stockSize[2];
    const operations = (input.profiles ?? []).map(profile => {
      const tool = settings.tools.find(tool => tool.number === profile.toolNumber);
      if (!tool) throw new Error(`Case ${input.id}: profile has no matching tool`);
      return profileOperation(profile.name, shapePath(profile.shape), top, tool, settings, profile.inside);
    });
    cam = finalizePlan(
      {
        stockTop: top,
        safeZ: top + settings.safeHeight,
        retractZ: top + settings.retractHeight,
        operations,
        warnings: operations.flatMap(operation => operation.warnings ?? []),
      },
      settings
    );
  }
  const programs = splitByBit(cam).map((part, index, all) => ({
    file: `${input.id}${all.length > 1 ? `.${index + 1}` : ''}.nc`,
    cam: part,
    ...postProgram(part, { partName: input.id, stockSize: input.stockSize, spindle: 'hand', spindleDwell: 3 }),
  }));
  return { cam, programs };
}
