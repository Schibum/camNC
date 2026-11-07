import { extractFeatures, featuresFromCuts, type FlatCut, type FlatProfile } from '@wbcnc/cam';
import { describe, expect, it } from 'vitest';
import { cutPartMesh } from './cutPartMesh';

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const circle = (cx: number, cy: number, r: number) =>
  Array.from({ length: 64 }, (_, i) => ({ x: cx + r * Math.cos((i * Math.PI) / 32), y: cy + r * Math.sin((i * Math.PI) / 32) }));
const cut = (id: string, outline: { x: number; y: number }[], to: number, extra: Partial<FlatCut> = {}): FlatCut => ({
  id,
  from: 0,
  to,
  through: to >= 18,
  outline,
  islands: [],
  ...extra,
});
const profile = (cuts: FlatCut[], holes = [circle(150, 60, 10)]): FlatProfile => ({
  thickness: 18,
  outline: rect(0, 0, 200, 120),
  holes,
  cuts,
});
const holeArea = Math.PI * 100;

/** The solid's volume from its surface: only a closed mesh with outward faces gets this right. */
function volume({ positions }: { positions: Float64Array }) {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(i, i + 9) as unknown as number[];
    sum += ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!);
  }
  return sum / 6;
}

const cases: [string, FlatProfile, number][] = [
  ['a recess', profile([cut('a', rect(20, 20, 70, 60), 6)]), 70 * 60 * 6],
  ['a rabbet open to the edge', profile([cut('a', rect(176, 0, 24, 120), 6)]), 24 * 120 * 6],
  ['a round pocket', profile([cut('a', circle(60, 60, 25), 8)]), Math.PI * 625 * 8],
  ['a pocket with an island', profile([cut('a', rect(20, 20, 70, 60), 6, { islands: [rect(40, 40, 10, 10)] })]), (70 * 60 - 100) * 6],
  [
    'a pocket in a pocket',
    profile([cut('a', rect(20, 20, 70, 60), 6), cut('b', rect(40, 40, 20, 20), 10, { from: 6 })]),
    70 * 60 * 6 + 400 * 4,
  ],
  ['a through slot in a pocket', profile([cut('a', rect(20, 20, 70, 60), 6), cut('b', rect(40, 40, 20, 20), 18)]), 70 * 60 * 6 + 400 * 12],
  [
    'pockets at several depths',
    profile([cut('a', rect(20, 20, 40, 40), 3), cut('b', rect(70, 20, 40, 40), 6), cut('c', rect(20, 70, 40, 40), 9)]),
    1600 * 18,
  ],
];

describe('the solid of a part with cuts', () => {
  it.each(cases)('has the right volume for %s', (_, input, removed) => {
    const { features } = featuresFromCuts(input),
      expected = (200 * 120 - holeArea) * 18 - removed;
    expect(volume(cutPartMesh(features)) / expected).toBeCloseTo(1, 3);
  });

  it.each(cases)('reads back from the mesh as the same features for %s', (_, input) => {
    const { features } = featuresFromCuts(input),
      { positions, indices } = cutPartMesh(features),
      read = extractFeatures({ positions, indices, faceRanges: [] }, 18);
    expect(read.levels.map(level => level.z)).toEqual(features.levels.map(level => level.z));
    read.levels.forEach((level, i) => expect(level.area / features.levels[i]!.area).toBeCloseTo(1, 2));
    expect(read.pockets.map(pocket => pocket.floorZ)).toEqual(features.pockets.map(pocket => pocket.floorZ));
    read.pockets.forEach((pocket, i) => expect(pocket.area / features.pockets[i]!.area).toBeCloseTo(1, 2));
    expect(read.throughHoles).toHaveLength(features.throughHoles.length);
    expect(read.outlines).toHaveLength(features.outlines.length);
    expect(read.bottomFaces).toEqual([]);
    expect(read.slopedArea).toBe(0);
  });
});
