import { Box2, Box3, Vector2, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { parseGCode } from './gcodeParsing';
import {
  directionFromAngles,
  fitZoom,
  FollowStep,
  framedTarget,
  getJobParts,
  kPartShotElevation,
  nearestStockSide,
  partAt,
  PartShotFollower,
  stockSideAzimuth,
} from './jobFollow';

// A pocket with its outline around it, two passes, then a separate square further along X.
const gcode = [
  'G0 X10 Y10 Z5',
  'G1 Z-2 F100',
  'G1 X20 F600',
  'G0 Z5',
  'G0 X5 Y5',
  'G1 Z-5 F100',
  'G1 X25',
  'G1 Y25',
  'G1 X5',
  'G1 Y5',
  'G0 Z5',
  'G0 X100 Y5',
  'G1 Z-5 F100',
  'G1 X120',
  'G1 Y25',
  'G0 Z5',
].join('\n');
const toolpath = parseGCode(gcode);

describe('getJobParts', () => {
  const parts = getJobParts(toolpath, 0);

  it('keeps cuts over each other in one part and starts a new one elsewhere', () => {
    expect(parts).toHaveLength(2);
    expect(parts[0]!.box.min.x).toBe(5);
    expect(parts[0]!.box.max.x).toBe(25);
    expect(parts[1]!.box.min.x).toBe(100);
    expect(parts[1]!.box.max.x).toBe(120);
  });

  it('gives the rapid to a part to that part', () => {
    const rapidToSecond = toolpath.pathPoints.findIndex(p => p.x === 100);
    expect(partAt(parts, rapidToSecond)).toBe(parts[1]);
    expect(partAt(parts, rapidToSecond - 2)).toBe(parts[0]);
    expect(partAt(parts, 0)).toBe(parts[0]);
  });

  const square = (x: number, y: number, size: number) => [
    'G0 Z5',
    `G0 X${x} Y${y}`,
    'G1 Z-3 F100',
    `G1 X${x + size} F600`,
    `G1 Y${y + size}`,
    `G1 X${x}`,
    `G1 Y${y}`,
  ];

  it('does not let a board outline after the pockets swallow the last of them', () => {
    const job = parseGCode([...square(10, 10, 50), ...square(100, 10, 50), ...square(0, 0, 300)].join('\n'));
    const found = getJobParts(job, 0);
    expect(found).toHaveLength(3);
    expect(found[1]!.box.max.x).toBe(150);
    expect(found[2]!.box.max.x).toBe(300);
  });

  it('does not let a facing pass swallow the parts cut after it', () => {
    const job = parseGCode([...square(0, 0, 300), ...square(10, 10, 50), ...square(100, 10, 50)].join('\n'));
    expect(getJobParts(job, 0).map(p => p.box.max.x)).toEqual([300, 60, 150]);
  });

  it('ignores feed moves above the stock', () => {
    const air = parseGCode('G1 X0 Y0 Z5 F600\nG1 X50\nG1 Z-1\nG1 X60\n');
    const [part, ...rest] = getJobParts(air, 0);
    expect(rest).toHaveLength(0);
    expect(part!.box.max.x).toBe(60);
    expect(part!.box.min.z).toBe(-1);
    // Zero at the stock bottom: nothing above that level is above the stock.
    expect(getJobParts(parseGCode('G1 X0 Y0 Z5 F600\nG1 X50\n'), -10)).toHaveLength(1);
  });

  it('finds nothing to frame in a job that does not cut', () => {
    const none = getJobParts(parseGCode('G0 X10 Z5\nG0 X20\n'), 0);
    expect(none).toEqual([]);
    expect(partAt(none, 0)).toBeNull();
  });
});

describe('nearestStockSide', () => {
  const footprint = new Box2(new Vector2(0, 0), new Vector2(200, 100));
  const box = (x0: number, y0: number, x1: number, y1: number) => new Box3(new Vector3(x0, y0, 0), new Vector3(x1, y1, 0));

  it('looks from the side nearest the part', () => {
    expect(nearestStockSide(box(5, 40, 30, 60), footprint, null)).toBe(0); // -X
    expect(nearestStockSide(box(80, 5, 120, 30), footprint, null)).toBe(1); // -Y
    expect(nearestStockSide(box(170, 40, 195, 60), footprint, null)).toBe(2); // +X
    expect(nearestStockSide(box(80, 70, 120, 95), footprint, null)).toBe(3); // +Y
  });

  it('stays on the current side unless another is clearly nearer', () => {
    expect(nearestStockSide(box(80, 8, 120, 86), footprint, 3)).toBe(3);
    expect(nearestStockSide(box(80, 5, 120, 80), footprint, 3)).toBe(1);
  });
});

describe('fitZoom', () => {
  const box = new Box3(new Vector3(0, 0, -10), new Vector3(100, 60, 0));

  it('fits the part and limits the zoom on tiny ones', () => {
    const zoom = fitZoom(box, stockSideAzimuth(1), kPartShotElevation, 1000, 600);
    expect(zoom).toBeGreaterThan(1);
    expect(100 * zoom).toBeLessThan(1000);
    const tiny = new Box3(new Vector3(0, 0, -1), new Vector3(1, 1, 0));
    expect(fitZoom(tiny, 0, kPartShotElevation, 1000, 600)).toBeLessThan(600 / 40);
  });

  it('zooms out on a smaller canvas', () => {
    expect(fitZoom(box, 0, kPartShotElevation, 500, 300)).toBeCloseTo(fitZoom(box, 0, kPartShotElevation, 1000, 600) / 2);
  });
});

describe('PartShotFollower', () => {
  function setup() {
    const camera = { position: new Vector3(-100, -100, 100), zoom: 2, updateProjectionMatrix: vi.fn() };
    const controls = { target: new Vector3(), update: vi.fn() };
    const follower = new PartShotFollower(camera, controls);
    const onPan = vi.fn();
    const onCustomView = vi.fn();
    const partBox = new Box3(new Vector3(100, 5, -5), new Vector3(120, 25, 0));
    const step: FollowStep = {
      worldBox: partBox,
      partBox,
      footprint: new Box2(new Vector2(0, 0), new Vector2(200, 100)),
      width: 1000,
      height: 600,
      dt: 0.1,
      customView: false,
      onPan,
      onCustomView,
    };
    return { camera, controls, follower, onPan, onCustomView, step, partBox };
  }
  const settle = (follower: PartShotFollower, step: FollowStep, n = 200) => {
    for (let i = 0; i < n; i++) follower.step(step);
  };
  const angles = (camera: { position: Vector3 }, target: Vector3) => {
    const offset = camera.position.clone().sub(target);
    return { azimuth: Math.atan2(offset.y, offset.x), elevation: Math.asin(offset.z / offset.length()) };
  };

  it('settles on the part, from the stock side nearest it, without taking that for the user', () => {
    const { camera, controls, follower, onPan, onCustomView, step, partBox } = setup();
    settle(follower, step);
    const { azimuth, elevation } = angles(camera, controls.target);
    expect(azimuth).toBeCloseTo(stockSideAzimuth(1), 2);
    expect(elevation).toBeCloseTo(kPartShotElevation, 2);
    // Fitted into the canvas without the panels over it.
    expect(camera.zoom).toBeCloseTo(fitZoom(partBox, azimuth, elevation, 760, 400), 2);
    const center = partBox.getCenter(new Vector3());
    expect(controls.target.distanceTo(framedTarget(center, azimuth, elevation, camera.zoom, 1000, 600))).toBeLessThan(0.01);
    expect(onPan).not.toHaveBeenCalled();
    expect(onCustomView).not.toHaveBeenCalled();
  });

  it('does not take crossing the azimuth wrap on the way to the -X side for the user', () => {
    const { camera, controls, follower, onCustomView, step } = setup();
    const partBox = new Box3(new Vector3(5, 40, -5), new Vector3(30, 60, 0));
    // Coming from just short of ±180°, the side's azimuth lies past it.
    camera.position.set(-100, 5, 50);
    settle(follower, { ...step, worldBox: partBox, partBox });
    expect(onCustomView).not.toHaveBeenCalled();
    const { azimuth, elevation } = angles(camera, controls.target);
    expect(Math.cos(azimuth - stockSideAzimuth(0))).toBeCloseTo(1, 3);
    expect(elevation).toBeCloseTo(kPartShotElevation, 2);
  });

  it('shows the part in the middle of the canvas not covered by panels', () => {
    const center = new Vector3(50, 50, 0);
    const azimuth = stockSideAzimuth(1);
    const target = framedTarget(center, azimuth, kPartShotElevation, 2, 1000, 600);
    const direction = directionFromAngles(azimuth, kPartShotElevation);
    const right = new Vector3(0, 0, 1).cross(direction).normalize();
    const up = direction.clone().cross(right);
    const onScreen = center.clone().sub(target);
    expect(onScreen.dot(right) * 2).toBeCloseTo(-120); // Left of the depth panel.
    expect(onScreen.dot(up) * 2).toBeCloseTo(50); // Above the timeline, which is taller than the toolbar.
  });

  it('keeps an orbit by the user, and follows on from that angle until reset', () => {
    const { camera, controls, follower, onCustomView, step, partBox } = setup();
    settle(follower, step);
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new Vector3(0, 0, 1), 0.5);
    camera.position.copy(controls.target).add(offset);
    const wanted = angles(camera, controls.target);
    const moved = partBox.clone().translate(new Vector3(30, 0, 0));
    settle(follower, { ...step, customView: true, worldBox: moved });
    expect(onCustomView).toHaveBeenCalled();
    expect(angles(camera, controls.target).azimuth).toBeCloseTo(wanted.azimuth, 5);
    const expected = framedTarget(moved.getCenter(new Vector3()), wanted.azimuth, wanted.elevation, camera.zoom, 1000, 600);
    expect(controls.target.distanceTo(expected)).toBeLessThan(0.01);
    settle(follower, { ...step, customView: false });
    expect(angles(camera, controls.target).azimuth).toBeCloseTo(stockSideAzimuth(1), 2);
  });

  it('keeps a zoom by the user relative to the fit', () => {
    const { camera, follower, step } = setup();
    settle(follower, step);
    const fit = camera.zoom;
    camera.zoom *= 2;
    settle(follower, { ...step, customView: true });
    expect(camera.zoom).toBeCloseTo(fit * 2, 2);
  });

  it('stops on a pan by the user', () => {
    const { controls, follower, onPan, step } = setup();
    settle(follower, step, 5);
    controls.target.x += 5;
    const panned = controls.target.clone();
    follower.step(step);
    expect(onPan).toHaveBeenCalledOnce();
    expect(controls.target.equals(panned)).toBe(true);
  });

  it('does not take other camera moves for the user after a skip', () => {
    const { controls, follower, onPan, step } = setup();
    settle(follower, step, 5);
    controls.target.x += 5;
    follower.skip();
    follower.step(step);
    expect(onPan).not.toHaveBeenCalled();
  });
});
