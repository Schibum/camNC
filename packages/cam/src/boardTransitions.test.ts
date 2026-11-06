import { describe, expect, it } from 'vitest';
import { machiningCases, machiningPart, rectangle } from '../test/machining-fixtures';
import { readGcode } from './analyze';
import { camBoard, partToBoard, rotateAboutOrigin, type BoardPart, type BoardSpec } from './board';
import { toGcode } from './gcode';
import { camPart } from './toolpaths';

describe('placed pocket cutting transitions', () => {
  it.each(
    [
      { rotated: false, rotationDeg: 0 },
      { rotated: true, rotationDeg: 0 },
      { rotated: false, rotationDeg: 17 },
      { rotated: true, rotationDeg: -23 },
    ].flatMap(placement => [false, true].map(open => ({ ...placement, open })))
  )('keeps transition evidence in the toolpath frame: %j', ({ rotated, rotationDeg, open }) => {
    const features = open ? machiningPart([[rectangle(15, 0, 85, 12)]], 6) : machiningCases.rectangle();
    const settings = { cutThrough: false };
    const local = camPart(features, settings);
    const part: BoardPart = {
      id: 'pocket-part',
      name: 'Pocket part',
      features,
      size: [100, 70, 12],
      x: 120,
      y: 170,
      rotated,
    };
    const board: BoardSpec = {
      id: 'board',
      name: 'Board',
      w: 400,
      h: 400,
      thickness: 12,
      holdDown: 'none',
      rotationDeg,
      parts: [part],
    };
    const placed = camBoard(board, settings);
    const turn = rotateAboutOrigin(rotationDeg);
    const expectedRegion = local.operations[0].pocketTransition!.region.map(loop =>
      loop.map(point => {
        const [x, y] = turn(partToBoard(part, [point.x, point.y, 0]));
        return { x, y };
      })
    );
    expect(placed.operations[0].pocketTransition!.region).toEqual(expectedRegion);
    const retainedSolid = local.operations[0].pocketTransition!.retainedSolid;
    if (open) expect(retainedSolid).toBeDefined();
    expect(placed.operations[0].pocketTransition!.retainedSolid).toEqual(
      retainedSolid?.map(loop =>
        loop.map(point => {
          const [x, y] = turn(partToBoard(part, [point.x, point.y, 0]));
          return { x, y };
        })
      )
    );
    const transitions = placed.operations[0].passes.filter(pass => pass.cuttingTransition && pass.clearLink);
    expect(transitions.length).toBeGreaterThan(8);
    for (const pass of transitions) {
      expect(pass.cuttingTransition!.from).toEqual(pass.pts[0]);
      expect(pass.pts).toContainEqual(pass.cuttingTransition!.to);
    }
    for (const pass of placed.operations[0].passes.filter(pass => pass.cuttingTransition && !pass.clearLink)) {
      expect(pass.link).toBe('retract');
      expect(pass.pts[0]).toEqual(pass.cuttingTransition!.to);
    }
    const retracts = (code: string) => readGcode(code).filter(move => move.rapid && move.to[2] > move.from[2] + 1e-6).length;
    const baseline = camBoard({ ...board, rotationDeg: 0, parts: [{ ...part, rotated: false }] }, settings);
    expect(retracts(toGcode(placed))).toBe(retracts(toGcode(baseline)));
  });
});
