import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { parseGCode } from '@/visualize/gcodeParsing';
import { applyView, fitView, kFov, readView, screenShare } from './framing';
import { cutBounds } from './planModel';

const board = new Box3(new Vector3(0, 0, 0), new Vector3(600, 300, 8.3));

describe('framing', () => {
  it('fits the whole board in the top view with a small margin', () => {
    const state = fitView(board, { view: 'top', aspect: 2, margin: 1.1 });
    expect(state.target.toArray()).toEqual([300, 150, 4.15]);
    expect(state.dir.toArray()).toEqual([0, 0, 1]);
    // 600 wide at aspect 2 needs 300 mm of height; the 300 mm depth too: the margin on top.
    expect(state.height).toBeCloseTo(330);
    expect(screenShare(board, state, 2)).toBeCloseTo(1 / 1.1);
  });

  it('fits the board at an angle in the 3D view, all of it on screen', () => {
    const state = fitView(board, { view: '3d', aspect: 1.6, margin: 1.1 });
    const share = screenShare(board, state, 1.6);
    expect(share).toBeLessThanOrEqual(1);
    expect(share).toBeGreaterThan(0.65);
  });

  it('zooms to a single 6 mm through hole so it fills a good share of the view', () => {
    // A 6 mm hole cut with a 1/8" bit: the bit centre circles at r = 1.41 around (120, 80), down to just below Z0.
    const gcode = [
      'G21 G90',
      'G0 Z15',
      'G0 X121.4125 Y80',
      'G1 Z8.3 F600',
      'G1 Z4 F300',
      'G2 X121.4125 Y80 I-1.4125 J0 F800',
      'G1 Z-0.3',
      'G2 X121.4125 Y80 I-1.4125 J0',
      'G0 Z15',
    ].join('\n');
    const toolpath = parseGCode(gcode);
    const hole = cutBounds(toolpath, [{ from: 1, to: toolpath.pathPoints.length - 1 }], 3.175 / 2, 8.3)!;
    const size = hole.getSize(new Vector3());
    expect(size.x).toBeCloseTo(6, 1);
    expect(size.y).toBeCloseTo(6, 1);
    expect(hole.max.z).toBe(8.3);
    for (const view of ['top', '3d'] as const) {
      const state = fitView(hole, { view, aspect: 1.6, margin: 1.6, minSpan: 16 });
      const share = screenShare(hole, state, 1.6);
      expect(share, view).toBeGreaterThan(0.3);
      expect(share, view).toBeLessThan(0.75);
      // The whole board in the same view: the hole would be a speck.
      expect(screenShare(hole, fitView(board, { view, aspect: 1.6, margin: 1.1 }), 1.6)).toBeLessThan(0.03);
    }
  });

  it('keeps the framing when switching between perspective and orthographic', () => {
    const state = fitView(board, { view: '3d', aspect: 1.5, margin: 1.2 });
    const [w, h] = [900, 600];
    const persp = new PerspectiveCamera(kFov);
    const ortho = new OrthographicCamera();
    applyView(persp, state, w, h);
    // Orbit a little first: the switch must keep what the user looks at, not the original framing.
    persp.position.add(new Vector3(-40, 25, 30));
    persp.lookAt(state.target);
    const before = readView(persp, state.target, h);
    applyView(ortho, before, w, h);
    const after = readView(ortho, state.target, h);
    expect(after.height).toBeCloseTo(before.height, 6);
    expect(after.dir.distanceTo(before.dir)).toBeLessThan(1e-9);
    // And back: same distance as before the switch.
    applyView(persp, after, w, h);
    expect(persp.position.distanceTo(state.target)).toBeCloseTo(before.height / 2 / Math.tan((kFov * Math.PI) / 360), 6);
    const back = readView(persp, state.target, h);
    expect(back.height).toBeCloseTo(before.height, 6);
  });

  it('shows the same visible height in both projections', () => {
    const state = fitView(board, { view: 'top', aspect: 1.5 });
    const persp = new PerspectiveCamera();
    const ortho = new OrthographicCamera();
    applyView(persp, state, 900, 600);
    applyView(ortho, state, 900, 600);
    const perspHeight = 2 * persp.position.distanceTo(state.target) * Math.tan((persp.fov * Math.PI) / 360);
    const orthoHeight = (ortho.top - ortho.bottom) / ortho.zoom;
    expect(orthoHeight).toBeCloseTo(perspHeight, 6);
  });
});
