import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CASE_DIRECTORY, generateMachiningCase, readMachiningCases, sha256, shapePath } from '../test/machining-cases/build';
import {
  measurePerformanceCase,
  performanceCases,
  performanceLimits,
  PERFORMANCE_INPUT_TEXT,
  ORIGINAL_PERFORMANCE_INPUT_TEXT,
  ROUND_OPEN_INPUT_TEXT,
} from '../test/machining-cases/performance/measure';
import { DepthMap, readGcode } from './analyze';
import { validateFluidNCOutput } from './gcode';
import type { Vec3 } from './geom';
import { checkGcodeSafety } from './safety';

const update = process.env.UPDATE_MACHINING_CASES === '1';
const cases = readMachiningCases();
const generated = cases.map(source => {
  const started = performance.now();
  const result = generateMachiningCase(source.input);
  if (process.env.DEBUG_MACHINING_CASES === '1') console.info(`${source.input.id}: ${(performance.now() - started).toFixed(0)} ms`);
  return { ...source, result };
});
const manifest = {
  schemaVersion: 1,
  provenance: {
    inputKind: 'analytic primitives',
    units: 'mm',
    datum: 'stock lower left; Z0 stock bottom',
    generator: '@wbcnc/cam test/machining-cases/build.ts',
    baselineVersion: 1,
    cuttingData: 'synthetic regression settings, not a qualified process',
  },
  cases: generated.map(({ input, inputFile, inputText, result }) => ({
    id: input.id,
    inputFile,
    inputSha256: sha256(inputText),
    warnings: result.cam.warnings,
    programs: result.programs.map(({ file, gcode, cam, setup }) => ({
      file,
      sha256: sha256(gcode),
      bytes: Buffer.byteLength(gcode),
      operations: cam.operations.length,
      passes: cam.operations.reduce((sum, operation) => sum + operation.passes.length, 0),
      toolNumbers: [...new Set(cam.operations.map(operation => operation.tool.number))],
      setup,
    })),
  })),
};
const performanceGenerated = performanceCases.map(measurePerformanceCase);
if (process.env.DEBUG_MACHINING_CASES === '1')
  for (const { input, metrics } of performanceGenerated) console.info(input.id, JSON.stringify(metrics));
const performanceManifest = {
  schemaVersion: 1,
  inputSha256: sha256(PERFORMANCE_INPUT_TEXT),
  tinyFeedLineThresholdMm: 0.1,
  retractDefinition: 'initial clearance command and subsequent positive-Z work-coordinate G0 moves; machine-coordinate parking excluded',
  timingProfile: 'lowrider-v4-reference',
  cases: performanceGenerated.map(({ input, resolvedSettings, metrics, result }) => ({
    id: input.id,
    resolvedSettings,
    accuracy: result.cam.accuracy,
    metrics,
  })),
};
if (update) {
  for (const { result } of generated) for (const { file, gcode } of result.programs) writeFileSync(`${CASE_DIRECTORY}/${file}`, gcode);
  writeFileSync(`${CASE_DIRECTORY}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  for (const { result } of performanceGenerated)
    for (const { file, gcode } of result.programs) writeFileSync(`${CASE_DIRECTORY}/performance/${file}`, gcode);
  writeFileSync(`${CASE_DIRECTORY}/performance/manifest.json`, JSON.stringify(performanceManifest, null, 2) + '\n');
}

const pointToSegment = (point: Vec3, a: Vec3, b: Vec3): number => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
};

function segmentToRectangle(a: Vec3, b: Vec3, box: [number, number, number, number]): number {
  const [x0, y0, x1, y1] = box;
  let lo = 0,
    hi = 1;
  for (const [start, delta, min, max] of [
    [a[0], b[0] - a[0], x0, x1],
    [a[1], b[1] - a[1], y0, y1],
  ]) {
    if (Math.abs(delta) < 1e-12) {
      if (start < min || start > max) {
        lo = 1;
        hi = 0;
      }
    } else {
      const t0 = (min - start) / delta,
        t1 = (max - start) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  if (lo <= hi) return 0;
  const corners: Vec3[] = [
    [x0, y0, 0],
    [x1, y0, 0],
    [x1, y1, 0],
    [x0, y1, 0],
  ];
  const pointDistance = (point: Vec3) => Math.hypot(Math.max(x0 - point[0], 0, point[0] - x1), Math.max(y0 - point[1], 0, point[1] - y1));
  return Math.min(pointDistance(a), pointDistance(b), ...corners.map(corner => pointToSegment(corner, a, b)));
}

describe('analytic machining regression corpus', () => {
  it('records the exact inputs, program bytes, and observed planning diagnostics', () => {
    expect(existsSync(`${CASE_DIRECTORY}/manifest.json`), 'Regenerate with UPDATE_MACHINING_CASES=1').toBe(true);
    expect(JSON.parse(readFileSync(`${CASE_DIRECTORY}/manifest.json`, 'utf8'))).toEqual(manifest);
  });

  for (const { input, result } of generated)
    it(`${input.id}: deterministic output and machining invariants`, () => {
      expect(result.programs).toHaveLength(input.expected.programs);
      const roles = result.cam.operations.flatMap(operation => operation.passes.flatMap(pass => pass.roles ?? []));
      for (const role of input.expected.requiredRoles ?? []) expect(roles, role).toContain(role);
      for (const text of input.expected.warningIncludes ?? []) expect(result.cam.warnings.join('\n')).toContain(text);
      const polish = input.expected.polish;
      if (polish) {
        const inner = result.cam.operations.find(operation => operation.name === polish.insideOperation)!;
        const outer = result.cam.operations.find(operation => operation.name === polish.outsideOperation)!;
        expect(inner).toBeDefined();
        expect(outer).toBeDefined();
        for (const operation of [inner, outer]) {
          const springs = operation.passes.filter(pass => pass.spring);
          expect(springs).toHaveLength(polish.springPasses);
          for (const pass of springs) {
            expect(pass.pts[0]).toEqual(pass.pts.at(-1));
            expect(pass.pts.every(point => Math.abs(point[2] - input.expected.minimumZ) < 1e-8)).toBe(true);
          }
          for (const pass of operation.passes.filter(pass => pass.auxiliary)) {
            expect(pass.feeds.every(feed => feed <= (operation.tool.plungeFeed ?? input.settings.plungeFeed!))).toBe(true);
            if (pass.verticalBlendRadius !== undefined) {
              expect(pass.verticalBlendRadius).toBeGreaterThan(0);
              expect(pass.verticalBlendRadius).toBeLessThanOrEqual(0.3);
            }
          }
        }
        const spring = inner.passes.find(pass => pass.spring)!;
        const center = input.profiles!.find(profile => profile.name === polish.insideOperation)!.shape;
        if (center.type !== 'circle') throw new Error('Circular finishing case requires a circle');
        const radii = spring.pts.map(point => Math.hypot(point[0] - center.center[0], point[1] - center.center[1])).sort((a, b) => a - b);
        const centerRadius = radii[Math.floor(radii.length / 2)];
        const wallFeeds = spring.feeds
          .filter((_, i) => spring.roles?.[i] === 'finish')
          .map(feed => (feed * (centerRadius + inner.tool.diameter / 2)) / centerRadius);
        expect(wallFeeds.length).toBeGreaterThan(10);
        for (const feed of wallFeeds) expect(Math.abs(feed - polish.desiredWallFeed)).toBeLessThan(1);
        const outsideFeeds = outer.passes.flatMap(pass => pass.feeds.filter((_, i) => pass.roles?.[i] === 'finish'));
        expect(outsideFeeds.length).toBeGreaterThan(10);
        expect(outsideFeeds.every(feed => feed === polish.desiredWallFeed)).toBe(true);
      }
      for (const { file, gcode, cam, setup } of result.programs) {
        expect(gcode).toBe(readFileSync(`${CASE_DIRECTORY}/${file}`, 'utf8'));
        expect(gcode).toContain(`(Plan: ${setup.planFingerprint})`);
        if (polish) expect(gcode).toMatch(/\bG18\b/);
        expect(() => validateFluidNCOutput(gcode)).not.toThrow();
        const radius = Math.max(...cam.operations.map(operation => operation.tool.diameter / 2));
        expect(
          checkGcodeSafety(gcode, {
            stockTop: cam.stockTop,
            size: [input.stockSize[0], input.stockSize[1]],
            minZ: input.expected.minimumZ,
            toolRadius: radius,
          })
        ).toEqual([]);
        const cuts = readGcode(gcode).filter(move => !move.rapid && Math.min(move.from[2], move.to[2]) < cam.stockTop - 1e-6);
        expect(cuts.length).toBeGreaterThan(0);
        expect(Math.min(...cuts.flatMap(move => [move.from[2], move.to[2]]))).toBeCloseTo(input.expected.minimumZ, 3);
        for (const box of input.expected.protectedRectangles ?? [])
          for (const move of cuts)
            expect(segmentToRectangle(move.from, move.to, box)).toBeGreaterThanOrEqual(radius - (input.settings.geometryTolerance ?? 0.05));
        for (const box of input.expected.uncutRectangles ?? [])
          for (const move of cuts) expect(segmentToRectangle(move.from, move.to, box)).toBeGreaterThan(0);
        const tab = input.expected.tabPlateau;
        if (tab) {
          const grid = new DepthMap(tab.x0 - 1, tab.centerY - 1, tab.x1 + 1, tab.centerY + 1, 0.05);
          grid.sweep(readGcode(gcode), radius, cam.stockTop);
          for (let x = tab.x0; x <= tab.x1; x += 0.25) {
            const ix = Math.round((x - grid.x0) / grid.res),
              iy = Math.round((tab.centerY - grid.y0) / grid.res);
            expect(grid.data[iy * grid.w + ix]).toBeGreaterThanOrEqual(tab.minimumHeight - 0.001);
          }
        }
        for (const operation of cam.operations)
          for (const pass of operation.passes) {
            expect(pass.feeds).toHaveLength(pass.pts.length);
            expect(pass.roles).toHaveLength(pass.pts.length);
            expect(pass.feeds.every(feed => Number.isFinite(feed) && feed > 0)).toBe(true);
          }
      }
    });
});

describe('default machining output cost', () => {
  it('records explicit inputs, expanded defaults and output metrics independently of byte snapshots', () => {
    expect(JSON.parse(readFileSync(`${CASE_DIRECTORY}/performance/manifest.json`, 'utf8'))).toEqual(performanceManifest);
    const before = JSON.parse(readFileSync(`${CASE_DIRECTORY}/performance/baseline-before.json`, 'utf8'));
    expect(before.sourceCommit).toBe('f5c76b20287b84f736d3e5bb19e01029281796d5');
    expect(before.inputSha256).toBe(sha256(ORIGINAL_PERFORMANCE_INPUT_TEXT));
    expect(before.cases.map((c: { input: unknown }) => c.input)).toEqual(JSON.parse(ORIGINAL_PERFORMANCE_INPUT_TEXT));
    const curvedOpenBefore = JSON.parse(readFileSync(`${CASE_DIRECTORY}/performance/baseline-round-open-before.json`, 'utf8'));
    expect(curvedOpenBefore.sourceCommit).toBe('850731a3706d0cd1bda6f8bfa74db87433025196');
    expect(curvedOpenBefore.inputSha256).toBe(sha256(ROUND_OPEN_INPUT_TEXT));
    expect(curvedOpenBefore.cases.map((entry: { input: unknown }) => entry.input)).toEqual(JSON.parse(ROUND_OPEN_INPUT_TEXT));
    expect(Object.keys(performanceLimits).sort()).toEqual(performanceCases.map(input => input.id).sort());
    for (const entry of before.cases) {
      const limit = performanceLimits[entry.id],
        observed = entry.metrics[0];
      expect(observed.executableBlocks).toBeGreaterThan(limit.executableBlocks);
      expect(observed.retracts).toBeGreaterThan(limit.retracts);
      expect(observed.estimatedAutomaticSeconds).toBeGreaterThan(limit.estimatedAutomaticSeconds);
      if (entry.input.mode !== 'profiles') expect(observed.tinyFeedLineBlocks).toBeGreaterThan(limit.tinyFeedLineBlocks);
    }
    for (const entry of curvedOpenBefore.cases) {
      const limit = performanceLimits[entry.id],
        observed = entry.metrics[0];
      if (entry.input.pockets[0].boundary.type === 'polygon')
        for (const field of ['executableBlocks', 'tinyFeedLineBlocks', 'retracts', 'estimatedAutomaticSeconds', 'feedLineBlocks'] as const)
          expect(observed[field], `historical ${entry.id} ${field}`).toBeGreaterThan(limit[field]!);
      else if (entry.input.pockets[0].boundary.segments < 512) expect(observed.feedLineBlocks).toBeGreaterThan(limit.feedLineBlocks!);
    }
  });

  for (const { input, result, metrics } of performanceGenerated)
    it(`${input.id}: bounded blocks, tiny moves, retracts and modeled time with retained geometry`, () => {
      expect(result.programs).toHaveLength(1);
      expect(result.cam.accuracy?.budget.total).toBe(0.05);
      expect(result.cam.accuracy?.scope).toBe('features');
      const roles = result.cam.operations.flatMap(operation => operation.passes.flatMap(pass => pass.roles ?? []));
      for (const role of input.expected.requiredRoles ?? []) expect(roles, role).toContain(role);
      const limit = performanceLimits[input.id];
      expect(limit).toBeDefined();
      for (const metric of metrics) {
        for (const field of ['executableBlocks', 'tinyFeedLineBlocks', 'retracts', 'estimatedAutomaticSeconds'] as const)
          expect(metric[field], `${input.id} ${field}`).toBeLessThanOrEqual(limit[field]);
        if (limit.feedLineBlocks !== undefined) expect(metric.feedLineBlocks).toBeLessThanOrEqual(limit.feedLineBlocks);
        if (limit.minimumArcBlocks !== undefined) expect(metric.arcBlocks).toBeGreaterThanOrEqual(limit.minimumArcBlocks);
        expect(metric.timingSkippedMotionCount).toBeLessThanOrEqual(3);
      }
      const { gcode, cam } = result.programs[0];
      expect(gcode).toBe(readFileSync(`${CASE_DIRECTORY}/performance/${result.programs[0].file}`, 'utf8'));
      const radius = cam.operations[0].tool.diameter / 2;
      expect(
        checkGcodeSafety(gcode, {
          stockTop: cam.stockTop,
          size: [input.stockSize[0], input.stockSize[1]],
          minZ: input.expected.minimumZ,
          toolRadius: radius,
        })
      ).toEqual([]);
      const cuts = readGcode(gcode).filter(move => !move.rapid && Math.min(move.from[2], move.to[2]) < cam.stockTop - 1e-6);
      const floor = cuts.filter(
        move => Math.abs(move.from[2] - input.expected.minimumZ) < 0.001 && Math.abs(move.to[2] - input.expected.minimumZ) < 0.001
      );
      expect(floor.length).toBeGreaterThan(0);
      expect(Math.min(...cuts.flatMap(move => [move.from[2], move.to[2]]))).toBeCloseTo(input.expected.minimumZ, 3);
      if (input.mode === 'profiles') {
        const source = input.profiles![0].shape;
        if (source.type !== 'polygon') throw new Error('Performance profile requires an analytic rectangle');
        const xs = source.points.map(p => p[0]),
          ys = source.points.map(p => p[1]);
        const box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        for (const cut of cuts) expect(segmentToRectangle(cut.from, cut.to, box)).toBeGreaterThanOrEqual(radius - 0.05);
        const [x0, y0, x1, y1] = box;
        // The four finished wall midpoints must still be reached at final depth; dropping laps cannot satisfy a cost cap.
        for (const point of [
          [x0 - radius, (y0 + y1) / 2, 0],
          [x1 + radius, (y0 + y1) / 2, 0],
          [(x0 + x1) / 2, y0 - radius, 0],
          [(x0 + x1) / 2, y1 + radius, 0],
        ] as Vec3[])
          expect(floor.some(move => pointToSegment(point, move.from, move.to) < 0.05)).toBe(true);
      } else if (input.pockets[0].boundary.type === 'circle') {
        const source = input.pockets[0].boundary;
        const polygon = shapePath(source);
        const edges = polygon.map((a, i) => {
          const b = polygon[(i + 1) % polygon.length];
          return { a, dx: b.x - a.x, dy: b.y - a.y, length: Math.hypot(b.x - a.x, b.y - a.y) };
        });
        let clearance = Infinity;
        for (const cut of cuts)
          for (const point of [cut.from, cut.to])
            for (const edge of edges)
              clearance = Math.min(clearance, (edge.dx * (point[1] - edge.a.y) - edge.dy * (point[0] - edge.a.x)) / edge.length);
        // Test the actual supplied polygon's half-planes, rather than granting ideal-circle space to a coarse source.
        expect(clearance).toBeGreaterThanOrEqual(radius - (input.settings.geometryTolerance ?? 0.05));
        const [cx, cy] = source.center;
        for (const x of [-24, -12, 0, 12, 24])
          for (const y of [-24, -12, 0, 12, 24])
            if (Math.hypot(x, y) < source.radius - 1)
              expect(
                floor.some(move => pointToSegment([cx + x, cy + y, 0], move.from, move.to) <= radius + 0.01),
                `floor ${x},${y}`
              ).toBe(true);
        const wallRadius = source.radius * Math.cos(Math.PI / source.segments) - radius;
        for (let i = 0; i < 8; i++) {
          const angle = ((2 * Math.floor((i * source.segments) / 8) + 1) * Math.PI) / source.segments;
          const point: Vec3 = [cx + wallRadius * Math.cos(angle), cy + wallRadius * Math.sin(angle), 0];
          expect(
            floor.some(move => pointToSegment(point, move.from, move.to) <= 0.05),
            `wall angle ${angle}`
          ).toBe(true);
        }
      } else {
        const polygon = input.pockets[0].boundary.points;
        const x0 = Math.min(...polygon.map(point => point[0])),
          y0 = Math.min(...polygon.map(point => point[1])),
          x1 = Math.max(...polygon.map(point => point[0])),
          y1 = Math.max(...polygon.map(point => point[1]));
        const open = y0 === 0;
        if (open) {
          const retained: [number, number, number, number][] = [
            [0, 0, x0, input.stockSize[1]],
            [x1, 0, input.stockSize[0], input.stockSize[1]],
            [x0, y1, x1, input.stockSize[1]],
          ];
          let clearance = Infinity;
          for (const cut of cuts) for (const box of retained) clearance = Math.min(clearance, segmentToRectangle(cut.from, cut.to, box));
          expect(clearance).toBeGreaterThanOrEqual(radius - 0.05);
        }
        // Closed rectangular cavities permit an analytical envelope check on every posted feed chord.
        for (const cut of cuts)
          for (const point of [cut.from, cut.to]) {
            if (!open) {
              expect(point[0]).toBeGreaterThanOrEqual(x0 + radius - 0.05);
              expect(point[0]).toBeLessThanOrEqual(x1 - radius + 0.05);
              expect(point[1]).toBeGreaterThanOrEqual(y0 + radius - 0.05);
              expect(point[1]).toBeLessThanOrEqual(y1 - radius + 0.05);
            }
          }
        // Retain floor coverage across the cavity, rather than accepting fewer blocks by leaving most of it uncut.
        const fractions = [0, 0.2, 0.5, 0.8, 1];
        const xs = fractions.map(t => x0 + radius + 1 + t * (x1 - x0 - 2 * (radius + 1)));
        const ys = fractions.map(t => y0 + (open ? 1 : radius + 1) + t * (y1 - y0 - (open ? radius + 2 : 2 * (radius + 1))));
        for (const x of xs)
          for (const y of ys)
            expect(
              floor.some(move => pointToSegment([x, y, 0], move.from, move.to) <= radius + 0.01),
              `floor ${x},${y}`
            ).toBe(true);
      }
    });
});
