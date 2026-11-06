import { describe, expect, it } from 'vitest';
import { circle, machiningPart, rectangle } from '../test/machining-fixtures';
import { readGcode } from './analyze';
import { camBoard, partToBoard, type BoardSpec } from './board';
import { pocketOperationClashes } from './boardEntrySafety';
import type { PartFeatures } from './features';
import { difference, distPointSeg, polyArea, union, type Vec3 } from './geom';
import { toGcode } from './gcode';
import { camPart, type Operation } from './toolpaths';

function plain(width: number, height: number): PartFeatures {
  return {
    thickness: 12,
    footprint: [rectangle(0, 0, width, height)],
    outlines: [rectangle(0, 0, width, height)],
    throughHoles: [],
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

function spec(rotated = false, rotationDeg = 0, pocketWidth = 12): BoardSpec {
  return {
    id: 'board',
    name: 'Board',
    w: 180,
    h: 160,
    thickness: 12,
    holdDown: 'none',
    rotationDeg,
    parts: [
      {
        id: 'main',
        name: 'Main',
        features: machiningPart([[rectangle(15, 0, 85, pocketWidth)]], 6),
        size: [100, 70, 12],
        x: rotated ? 60 : 20,
        y: rotated ? 20 : 30,
        rotated,
      },
      {
        id: 'neighbor',
        name: 'Neighbor',
        features: plain(110, 18),
        size: [110, 18, 12],
        x: rotated ? 132 : 15,
        y: rotated ? 15 : 10,
        rotated,
      },
    ],
  };
}
const settings = { tools: [{ number: 1, diameter: 6 }], cutThrough: false };

/** Independent segment/rectangle oracle: slab intersection plus endpoint/corner distances. */
function boxDistance(a: number[], b: number[], box: { x0: number; y0: number; x1: number; y1: number }): number {
  let lo = 0,
    hi = 1;
  for (const [axis, min, max] of [
    [0, box.x0, box.x1],
    [1, box.y0, box.y1],
  ]) {
    const delta = b[axis] - a[axis];
    if (!delta) {
      if (a[axis] < min || a[axis] > max) hi = -1;
    } else {
      const bounds = [(min - a[axis]) / delta, (max - a[axis]) / delta].sort((x, y) => x - y);
      lo = Math.max(lo, bounds[0]);
      hi = Math.min(hi, bounds[1]);
    }
  }
  if (lo <= hi) return 0;
  const endpoint = (point: number[]) =>
    Math.hypot(Math.max(box.x0 - point[0], 0, point[0] - box.x1), Math.max(box.y0 - point[1], 0, point[1] - box.y1));
  return Math.min(
    endpoint(a),
    endpoint(b),
    ...[box.x0, box.x1].flatMap(x => [box.y0, box.y1].map(y => distPointSeg(x, y, a[0], a[1], b[0], b[1])))
  );
}

describe('neighbor-safe board pockets', () => {
  it.each([false, true].flatMap(rotated => [0, 17].map(rotationDeg => ({ rotated, rotationDeg }))))(
    'replans ordinary open row ends and bridges inside the pocket after placement: %j',
    ({ rotated, rotationDeg }) => {
      const board = spec(rotated, rotationDeg),
        main = board.parts[0],
        neighbor = board.parts[1];
      const neighbors = neighbor.features.outlines.map(loop =>
        loop.map(point => {
          const [x, y] = partToBoard(neighbor, [point.x, point.y, 0]);
          return { x, y };
        })
      );
      const isolated = camPart(main.features, settings);
      expect(isolated.operations.some(operation => pocketOperationClashes(operation, neighbors, point => partToBoard(main, point)))).toBe(
        true
      );
      const job = camBoard(board, settings);
      expect(job.warnings).toContain('Main: Pocket 1: Open-pocket path would reach a neighboring part; using a path inside the pocket');
      expect(job.operations.every(operation => !operation.pocketTransition?.retainedSolid)).toBe(true);
      const unturn = (point: Vec3) => {
        const angle = (-rotationDeg * Math.PI) / 180;
        return [point[0] * Math.cos(angle) - point[1] * Math.sin(angle), point[0] * Math.sin(angle) + point[1] * Math.cos(angle)];
      };
      const box = { x0: neighbor.x, y0: neighbor.y, x1: neighbor.x + (rotated ? 18 : 110), y1: neighbor.y + (rotated ? 110 : 18) };
      const moves = readGcode(toGcode(job)).filter(move => !move.rapid && Math.min(move.from[2], move.to[2]) < 12);
      expect(moves.length).toBeGreaterThan(10);
      for (const move of moves) expect(boxDistance(unturn(move.from), unturn(move.to), box)).toBeGreaterThanOrEqual(3 - 0.06);
      // Independent floor probes prevent a clear-but-omitted pocket from passing the neighbor check.
      const floor = moves.filter(move => move.from[2] === 6 && move.to[2] === 6);
      for (const x of [25, 50, 75])
        for (const y of [1, 6, 11]) {
          const probe = partToBoard(main, [x, y, 6]);
          expect(
            Math.min(
              ...floor.map(move => {
                const a = unturn(move.from),
                  b = unturn(move.to);
                return distPointSeg(probe[0], probe[1], a[0], a[1], b[0], b[1]);
              })
            )
          ).toBeLessThanOrEqual(3.01);
        }
    }
  );

  it('keeps a safe open pocket unchanged when the neighboring part is farther away', () => {
    const board = spec();
    board.parts[1].y = 0;
    const job = camBoard(board, settings);
    expect(job.warnings.some(message => message.includes('neighboring part'))).toBe(false);
    expect(job.operations.some(operation => operation.pocketTransition?.retainedSolid)).toBe(true);
  });

  it('also reserves independently declared uncertainty of the neighboring boundary', () => {
    const board = spec();
    board.parts[1].y = 7.935;
    expect(camBoard(board, settings).warnings.some(message => message.includes('using a path inside'))).toBe(false);
    expect(camBoard(board, { ...settings, sourceTolerance: 0.01 }).warnings.some(message => message.includes('using a path inside'))).toBe(
      true
    );
  });

  it('replans only the threatened source pocket and retains its other depth operation', () => {
    const board = spec(),
      main = board.parts[0];
    const edge = rectangle(15, 0, 85, 12),
      deep = rectangle(15, 30, 40, 55),
      first = union([edge], [deep]);
    main.features.pockets = [
      { floorZ: 9, region: first, strictRegion: first, above: difference(main.features.outlines, first), area: polyArea(first) },
      { floorZ: 6, region: [deep], strictRegion: [deep], above: difference(main.features.outlines, [deep]), area: 625 },
    ];
    const before = camPart(main.features, settings);
    const after = camBoard(board, settings);
    const untouched = after.operations.filter(operation => operation.name.startsWith('Main: Pocket 2'));
    expect(untouched).toHaveLength(1);
    const expected = before.operations.find(operation => operation.name.startsWith('Pocket 2'))!;
    expect(untouched[0].passes).toEqual(
      expected.passes.map(pass => ({
        ...pass,
        pts: pass.pts.map(point => partToBoard(main, point)),
        ...(pass.cuttingTransition
          ? {
              cuttingTransition: { from: partToBoard(main, pass.cuttingTransition.from), to: partToBoard(main, pass.cuttingTransition.to) },
            }
          : {}),
      }))
    );
    expect(after.warnings.filter(message => message.includes('using a path inside'))).toHaveLength(1);
  });

  it('restarts a deeper open entry at stock top when the contained upper pocket left its exterior uncut', () => {
    const board = spec(),
      main = board.parts[0],
      outline = main.features.outlines;
    board.parts[1].features = plain(35, 18);
    board.parts[1].size = [35, 18, 12];
    const upper = rectangle(15, 0, 85, 12),
      lower = rectangle(60, 0, 80, 12);
    main.features.pockets = [
      { floorZ: 6, region: [upper], strictRegion: [upper], above: difference(outline, [upper]), area: 840 },
      { floorZ: 3, region: [lower], strictRegion: [lower], above: difference(outline, [lower]), area: 240 },
    ];
    const job = camBoard(board, settings);
    const lowerOperation = job.operations.find(operation => operation.name.startsWith('Main: Pocket 2'))!;
    expect(lowerOperation.pocketTransition?.retainedSolid).toBeDefined();
    expect(lowerOperation.passes[0].pts[0][2]).toBe(12);
    const first = lowerOperation.passes[0];
    expect(Math.min(...first.pts.map(point => point[2]))).toBe(9);
    for (const pass of lowerOperation.passes)
      for (let i = 1; i < pass.pts.length; i++)
        if (pass.pts[i][1] < main.y && pass.pts[i][2] < pass.pts[i - 1][2])
          expect(pass.pts[i - 1][2] - pass.pts[i][2]).toBeLessThanOrEqual(3);
    const posted = toGcode({ ...job, operations: [lowerOperation] });
    const firstDescent = readGcode(posted).find(move => !move.rapid && move.to[2] < move.from[2]);
    expect(firstDescent?.to[2]).toBe(12);
  });

  it('selects a smaller tool for a contained pocket and blocks the job when none fits', () => {
    const board = spec(false, 0, 2.5);
    expect(() => camBoard(board, settings)).toThrow(/no tool fits a pocket path that clears neighboring parts/);
    const job = camBoard(board, { ...settings, tools: [...settings.tools, { number: 2, diameter: 2 }] });
    expect(job.operations.every(operation => operation.tool.diameter === 2)).toBe(true);
  });

  it('replans and rechecks the complete main/rest-tool group when only a rest operation needs containment', () => {
    const seenContained = new Set<number>();
    let restTriggered = false;
    const features = machiningPart([union([rectangle(15, 10, 50, 45)], [rectangle(45, 25, 85, 28)])], 6);
    const job = camPart(
      features,
      { ...settings, tools: [...settings.tools, { number: 2, diameter: 2 }] },
      {
        pocketClashes: operation => {
          if (!operation.pocketTransition?.retainedSolid) {
            seenContained.add(operation.tool.number);
            return false;
          }
          if (operation.tool.number === 2) {
            restTriggered = true;
            return true;
          }
          return false;
        },
      }
    );
    expect(restTriggered).toBe(true);
    expect(seenContained).toEqual(new Set([1, 2]));
    expect(job.operations.every(operation => !operation.pocketTransition?.retainedSolid)).toBe(true);
    expect(job.warnings.filter(message => message.includes('using a path inside'))).toHaveLength(1);
  });

  it('fails closed if a contained cutter path still overlaps another part', () => {
    const board = spec();
    board.parts[1].y = 31;
    expect(() => camBoard(board, settings)).toThrow(/contained pocket path still reaches a neighboring part/);
  });

  it('does not treat a future frame hole as already cleared space for a nested pocket', () => {
    const board = spec();
    const frame = plain(180, 160),
      hole = circle(70, 65, 65);
    frame.footprint = [frame.outlines[0], [...hole].reverse()];
    frame.throughHoles = [hole];
    board.parts[1] = { id: 'frame', name: 'Frame', features: frame, size: [180, 160, 12], x: 0, y: 0, rotated: false };
    expect(() => camBoard(board, settings)).toThrow(/contained pocket path still reaches a neighboring part/);
  });
});

describe('complete pocket neighbor envelopes', () => {
  const identity = (point: Vec3) => point;
  const operation = (points: Vec3[]): Operation => ({
    name: 'Pocket',
    kind: 'pocket',
    feature: 'pocket',
    tool: { number: 1, diameter: 2 },
    passes: [{ pts: points, feeds: points.map(() => 300), link: 'retract' }],
  });

  it('checks plunge disks, segment interiors, implicit bridges, and sub-grid neighbor material', () => {
    expect(pocketOperationClashes(operation([[0, 0, 6]]), [rectangle(0.8, -0.1, 0.9, 0.1)], identity)).toBe(true);
    const crossing = operation([
      [-5, 0, 6],
      [5, 0, 6],
    ]);
    expect(pocketOperationClashes(crossing, [rectangle(0, 0.8, 0.00002, 0.9)], identity)).toBe(true);
    crossing.passes = [
      { pts: [[-5, 0, 6]], feeds: [300], link: 'retract' },
      { pts: [[5, 0, 6]], feeds: [300], link: 'direct' },
    ];
    expect(pocketOperationClashes(crossing, [rectangle(-0.1, -0.1, 0.1, 0.1)], identity)).toBe(true);
    crossing.passes[1].link = 'retract';
    expect(pocketOperationClashes(crossing, [rectangle(-0.1, -0.1, 0.1, 0.1)], identity)).toBe(false);
  });

  it('reserves the complete post deviation at a neighboring boundary', () => {
    const op = operation([
        [-5, 0, 6],
        [5, 0, 6],
      ]),
      neighbor = [rectangle(-1, 1.03, 1, 2)];
    expect(pocketOperationClashes(op, neighbor, identity, 0)).toBe(false);
    expect(pocketOperationClashes(op, neighbor, identity, 0.05)).toBe(true);
  });
});
