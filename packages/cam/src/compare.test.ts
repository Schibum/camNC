import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { parseGCode } from '../../../apps/camNC/src/visualize/gcodeParsing';
import { hasProbeOrZeroCommand } from '../../../apps/camNC/src/visualize/gcodeChecks';
import { parseToolInfo } from '../../../apps/camNC/src/visualize/guess-tools';
import {
  DepthMap,
  finalPassPoints,
  metrics,
  pointsToPathDistances,
  readGcode,
  register,
  stats,
  toSvg,
  transformMoves,
  type Move,
  type Xf,
} from './analyze';
import { extractFeatures } from './features';
import { fusionGcodePath, OUT_DIR, readStep } from './fixtures';
import { checkGcodeSafety } from './safety';
import { toGcode } from './gcode';
import { detectFlat, flipPart, loadStep, type FlatPart } from './import';
import { camPart, DEFAULT_SETTINGS, DEFAULT_TABS, type CamSettings } from './toolpaths';

// STEP body -> Fusion setup (Part 3 is identical to Part 1). Fusion's "left" setup machines the STEP body named
// "right" and vice versa: matching them by name needs a mirror, swapped they match by a plain rotation.
const PARTS: Record<string, string> = {
  left: 'right',
  right: 'left',
  'Part 1': 'shelf top bottom',
  'Part 2': 'shelf middle',
  back: 'back',
};

const rows: string[] = [];

// One browser for every render of the file: launching Chromium for each PNG took longer than drawing it.
let browser: Promise<Browser> | undefined;
afterAll(async () => {
  await (await browser)?.close();
});

async function renderPng(svg: string, file: string) {
  // Mock keychain: otherwise macOS asks for "Chromium Safe Storage" access.
  browser ??= chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  const page = await (await browser).newPage();
  try {
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.locator('svg').screenshot({ path: file });
  } finally {
    await page.close();
  }
}

/** IoU of cells cut below the stock top, 1mm grid (cheap; picks among registrations of symmetric outlines). */
function cutIou(a: Move[], b: Move[], top: number) {
  const pts = a.flatMap(m => [m.from, m.to]);
  const xs = pts.map(p => p[0]),
    ys = pts.map(p => p[1]);
  const mk = () => new DepthMap(Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5, 1);
  const A = mk(),
    B = mk();
  A.sweep(a, 0.5, top - 0.01);
  B.sweep(b, 0.5, top - 0.01);
  let inter = 0,
    uni = 0;
  for (let k = 0; k < A.data.length; k++) {
    const ca = A.data[k] < top - 0.01,
      cb = B.data[k] < top - 0.01;
    if (ca && cb) inter++;
    if (ca || cb) uni++;
  }
  return uni ? inter / uni : 0;
}

function pocketCoverage(fusion: Move[], ours: Move[], part: FlatPart, r: number) {
  const pts = fusion.flatMap(m => [m.from, m.to]).filter(p => p[2] < part.thickness);
  const xs = pts.map(p => p[0]),
    ys = pts.map(p => p[1]);
  const res = 0.25;
  const mk = () => new DepthMap(Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3, res);
  const F = mk(),
    O = mk();
  F.sweep(fusion, r, part.thickness - 0.01);
  O.sweep(ours, r, part.thickness - 0.01);
  const lo = DEFAULT_SETTINGS.profileRoughBottom + 0.5,
    hi = part.thickness - 0.05;
  const isPocket = (z: number) => z >= lo && z <= hi;
  let f = 0,
    both = 0,
    sameDepth = 0,
    extra = 0;
  for (let k = 0; k < F.data.length; k++) {
    const fz = F.data[k],
      oz = O.data[k];
    if (isPocket(fz)) {
      f++;
      if (oz <= hi) both++;
      if (Math.abs(oz - fz) < 0.05) sameDepth++;
    } else if (isPocket(oz) && !(fz <= hi)) extra++;
  }
  const cell = res * res;
  return { fusionArea: f * cell, coverage: f ? both / f : NaN, sameDepth: f ? sameDepth / f : NaN, extraArea: extra * cell };
}

interface CompareCase {
  /** Output file stem in OUT_DIR. */
  label: string;
  part: FlatPart;
  settings?: Partial<CamSettings>;
  /** Fusion G-code to compare with (omit to only generate + render ours). */
  fusionFile?: string;
}

/** Generate our G-code for a part, write it, compare with Fusion's file and render both top views to PNG. */
async function compareWithFusion({ label, part, settings = {}, fusionFile }: CompareCase) {
  const t0 = performance.now();
  const features = extractFeatures(part.mesh, part.thickness);
  const t1 = performance.now();
  const cam = camPart(features, settings);
  const t2 = performance.now();
  const ours = toGcode(cam, { partName: part.name, stockSize: part.size });
  const t3 = performance.now();
  writeFileSync(`${OUT_DIR}/${label}.camnc.gcode`, ours);
  const limits = {
    stockTop: cam.stockTop,
    size: [part.size[0], part.size[1]] as [number, number],
    minZ: settings.cutThrough === false ? 0 : (settings.finalZ ?? DEFAULT_SETTINGS.finalZ),
    toolRadius: Math.max(...cam.operations.map(o => o.tool.diameter / 2)),
  };
  const safety = checkGcodeSafety(ours, limits);
  if (settings.cutThrough !== false) {
    const tabs = toGcode(camPart(features, { ...settings, tabs: DEFAULT_TABS }), { partName: part.name, stockSize: part.size });
    safety.push(...checkGcodeSafety(tabs, limits));
    writeFileSync(`${OUT_DIR}/${label}.camnc-tabs.gcode`, tabs);
    await renderPng(
      toSvg([{ title: `camNC POC with tabs: ${part.name}`, moves: readGcode(tabs) }], [-0.3, part.thickness]),
      `${OUT_DIR}/${label}.tabs.png`
    );
  }
  // Same paths with the Fusion setups' depths and feeds (full-depth pockets, 4 mm outline roughing, full-feed final
  // pass) to compare raw path efficiency; our defaults step down less (see the camNC time column).
  const fusionLike = toGcode(
    camPart(features, {
      ...settings,
      finalFeedFactor: 1,
      material: { name: 'fusion-like', stepdownFactor: 100 },
      maxStepdown: undefined,
      profileStepdown: 4,
      // Fusion's setups don't finish rabbet walls separately; ours do by default (see the camNC time column).
      openWallAllowance: 0,
    })
  );

  const oursRaw = readGcode(ours);
  const fusionSrc = fusionFile ? readFileSync(fusionFile, 'utf8') : undefined;
  const fusion = fusionSrc ? readGcode(fusionSrc) : undefined;
  const top = part.thickness;

  let oursMoves = oursRaw;
  let dev = '-',
    devBack = '-',
    p95 = 0,
    maxDev = 0;
  if (fusion) {
    let candidates: { xf: Xf; mean: number }[];
    if (settings.cutThrough !== false) {
      // Register on the final outline pass; symmetric outlines are disambiguated by overall cut overlap.
      const ref = finalPassPoints(fusion);
      candidates = register(finalPassPoints(oursRaw), ref).filter((c, _, all) => c.mean < all[0].mean + 0.05);
    } else {
      // Pockets only: align the bboxes of the cuts per rotation, pick by overlap.
      const box = (ms: Move[]) => {
        const p = ms.filter(m => !m.rapid && m.to[2] < top - 0.01).map(m => m.to);
        return [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1]))];
      };
      const [fx, fy] = box(fusion);
      candidates = ([0, 1, 2, 3] as const).map(rot => {
        const [ox, oy] = box(transformMoves(oursRaw, { rot, mirror: false, dx: 0, dy: 0 }));
        return { xf: { rot, mirror: false, dx: fx - ox, dy: fy - oy }, mean: 0 };
      });
    }
    const scored = candidates.map(c => ({ ...c, iou: cutIou(fusion, transformMoves(oursRaw, c.xf), top) }));
    const { xf } = scored.sort((a, b) => b.iou - a.iou)[0];
    oursMoves = transformMoves(oursRaw, xf);
    if (settings.cutThrough !== false) {
      const ref = finalPassPoints(fusion);
      const ourFinal = finalPassPoints(oursMoves);
      const d = stats(pointsToPathDistances(ourFinal, ref));
      p95 = d.p95;
      maxDev = d.max;
      dev = `${d.mean.toFixed(3)} / ${d.p95.toFixed(3)} / ${d.max.toFixed(3)}`;
      devBack = stats(pointsToPathDistances(ref, ourFinal)).p95.toFixed(3);
    }
  }

  const tool = cam.operations[0].tool;
  const cov = fusion ? pocketCoverage(fusion, oursMoves, part, tool.diameter / 2) : undefined;
  const mf = fusion ? metrics(fusion, top) : undefined;
  const mo = metrics(oursMoves, top);
  const ml = metrics(readGcode(fusionLike), top);

  const svg = toSvg(
    [
      ...(fusion ? [{ title: `Fusion: ${fusionFile!.split('/').pop()}`, moves: fusion }] : []),
      { title: `camNC POC: ${part.name}`, moves: oursMoves },
    ],
    [Math.min(settings.finalZ ?? DEFAULT_SETTINGS.finalZ, 0), top],
    2
  );
  await renderPng(svg, `${OUT_DIR}/${label}.png`);

  // camNC's own parser / checks on our output.
  const parsed = parseGCode(ours);
  const bounds = parsed.getBounds();
  const toolsGuess = parseToolInfo(ours);

  console.log(
    `${label}: features ${(t1 - t0).toFixed(0)}ms, toolpaths ${(t2 - t1).toFixed(0)}ms, gcode ${(t3 - t2).toFixed(0)}ms; ` +
      `warnings: ${cam.warnings.join('; ') || '-'}\n` +
      `  camNC parse: ${parsed.pathPoints.length} pts, bounds z ${bounds.min.z.toFixed(2)}..${bounds.max.z.toFixed(2)}, ` +
      `tools ${JSON.stringify(toolsGuess)}, probe/zero ${hasProbeOrZeroCommand(ours)}`
  );
  const pct = (v?: number) => (v === undefined || Number.isNaN(v) ? '-' : `${(v * 100).toFixed(1)}%`);
  rows.push(
    `| ${label} | ${cam.operations.map(o => o.name).join(', ')} | ${dev} | ${devBack} | ` +
      `${cov ? cov.fusionArea.toFixed(0) : '-'} | ${pct(cov?.coverage)} | ${pct(cov?.sameDepth)} | ${cov ? cov.extraArea.toFixed(0) : '-'} | ` +
      `${mf ? mf.plunges : '-'}/${mo.plunges} | ${mf ? mf.zLevels.join(',') : '-'} / ${mo.zLevels.join(',')} | ` +
      `${mf ? mf.timeMin.toFixed(1) : '-'}/${mo.timeMin.toFixed(1)}/${ml.timeMin.toFixed(1)} | ` +
      `${fusionSrc ? (fusionSrc.length / 1024).toFixed(1) : '-'}/${(ours.length / 1024).toFixed(1)} |`
  );
  return { toolsGuess, bounds, p95, maxDev, cov, cam, safety, timeFusion: mf?.timeMin, timeFusionLike: ml.timeMin };
}

describe('spike 5: compare with Fusion', async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const load = async (name: string) => (await loadStep(readStep(name))).bodies.map(detectFlat);
  const kinder = await load('kinderregal eiche');
  const besteck = await load('besteckkasten');

  afterAll(() => {
    if (!rows.length) return;
    const table = [
      '| setup | ops | final pass dev ours→F mean/p95/max mm | F→ours p95 | F pocket mm² | coverage | same depth | extra mm² | plunges F/O | cut z levels F / O | time min F/O/O-fusion-like | size KB F/O |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
      ...rows,
    ].join('\n');
    writeFileSync(`${OUT_DIR}/summary.md`, table + '\n');
    console.log(table);
  });

  it.each(Object.entries(PARTS))('kinderregal %s vs Fusion "%s"', async (bodyName, setup) => {
    const r = await compareWithFusion({
      label: setup,
      part: kinder.find(p => p.name === bodyName)!,
      fusionFile: fusionGcodePath(`kinderregal eiche ${setup}`),
    });
    expect(r.toolsGuess).toEqual([{ tool: 1, diameter: 3.175, name: 'flat end mill', isFlat: true }]);
    expect(r.bounds.min.z).toBeCloseTo(-0.3);
    // Golden: the finished outline lies within 0.05mm of Fusion's everywhere.
    expect(r.maxDev).toBeLessThan(0.05);
    // Golden: with Fusion's settings (full-depth pockets, full-feed final pass) as fast as Fusion within 15%.
    expect(Math.abs(r.timeFusionLike / r.timeFusion! - 1)).toBeLessThan(0.15);
    expect(r.safety).toEqual([]);
    if (r.cov && r.cov.fusionArea > 0) expect(r.cov.coverage).toBeGreaterThan(0.99);
  });

  it('besteckkasten vert1: top side vs Fusion b1, flipped setup vs b1 flipped', async () => {
    const vert1 = besteck.find(p => p.name === 'vert1')!;
    // Fusion cut this board 0.5 below the stock bottom.
    const top = await compareWithFusion({
      label: 'besteck vert1',
      part: vert1,
      settings: { finalZ: -0.5 },
      fusionFile: fusionGcodePath('besteck b1'),
    });
    expect(top.cam.warnings.some(w => w.includes('flipped'))).toBe(true);
    const flipped = await compareWithFusion({
      label: 'besteck vert1 flipped',
      part: flipPart(vert1),
      settings: { cutThrough: false },
      fusionFile: fusionGcodePath('besteck b1 flipped'),
    });
    expect(flipped.cam.operations.map(o => o.kind)).toEqual(['pocket']);
    expect(flipped.cov!.coverage).toBeGreaterThan(0.95);
    expect([...top.safety, ...flipped.safety]).toEqual([]);
  });

  it('besteckkasten other boards (ours only)', async () => {
    for (const part of besteck.filter(p => p.name !== 'vert1' && p.name !== 'connector top')) {
      const r = await compareWithFusion({ label: `besteck ${part.name}`, part });
      expect(r.safety).toEqual([]);
    }
  });
});
