import type { PartFeatures } from '../src/features';
import { difference, polyArea, type PathD, type PathsD } from '../src/geom';

export const rectangle = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

export const circle = (x: number, y: number, radius: number, samples = 120): PathD =>
  Array.from({ length: samples }, (_, i) => ({
    x: x + radius * Math.cos((i * 2 * Math.PI) / samples),
    y: y + radius * Math.sin((i * 2 * Math.PI) / samples),
  }));

/** Small analytic inputs keep machining invariants independent of model importing. Dimensions are mm. */
export function machiningPart(regions: PathsD[] = [[rectangle(20, 20, 70, 50)]], floorZ = 6, holes: PathsD = []): PartFeatures {
  const outline = rectangle(0, 0, 100, 70);
  const footprint = difference([outline], holes);
  const pockets = regions.flat();
  return {
    thickness: 12,
    footprint,
    outlines: [outline],
    throughHoles: holes,
    levels: [
      { z: 12, region: difference(footprint, pockets), area: polyArea(difference(footprint, pockets)) },
      ...(regions.length ? [{ z: floorZ, region: pockets, area: polyArea(pockets) }] : []),
    ],
    pockets: regions.map(region => ({
      floorZ,
      region,
      strictRegion: region,
      above: difference(footprint, region),
      area: polyArea(region),
    })),
    bottomFaces: [],
    slopedArea: 0,
  };
}

export const machiningCases = {
  rectangle: () => machiningPart(),
  island: () => machiningPart([[rectangle(15, 15, 75, 55), rectangle(38, 28, 53, 43).reverse()]]),
  concave: () =>
    machiningPart([
      [
        [
          { x: 15, y: 15 },
          { x: 75, y: 15 },
          { x: 75, y: 30 },
          { x: 35, y: 30 },
          { x: 35, y: 55 },
          { x: 15, y: 55 },
        ],
      ],
    ]),
  disjoint: () => machiningPart([[rectangle(15, 20, 35, 45)], [rectangle(65, 20, 85, 45)]]),
  open: () => machiningPart([[rectangle(20, 0, 80, 3.5)]]),
  slot: (width = 3.4) => machiningPart([[rectangle(20, 20, 65, 20 + width)]]),
  small: () => machiningPart([[circle(45, 35, 2.2)]], 2),
  profiles: () => machiningPart([], 6, [circle(50, 35, 6.5)]),
};
