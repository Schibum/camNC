/**
 * The only app-specific code for sketch specs: it drives real pointer and keyboard input and reads
 * the saved design. Scenarios never see these hooks, so replacing the app means replacing this file.
 */

const POSITION_TOLERANCE_MM = 1.5;
const VALUE_TOLERANCE = 0.05;

/** Dimension kinds in plain terms, so scenarios don't name internal constraint types. */
const KINDS = { distance: 'aligned', distanceX: 'horizontal', distanceY: 'vertical', pointLineDistance: 'gap', lineLineDistance: 'gap', pointArcDistance: 'gap', lineCircleDistance: 'gap', circleCircleDistance: 'gap' };

const point = text => text.split(',').map(Number);
const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const samePoint = (a, b, tolerance) => close(a[0], b[0], tolerance) && close(a[1], b[1], tolerance);

/** A flat, ID-free description of the sketch. */
function canonical(part) {
  if (!part) return { entities: [], dimensions: [], constraints: [] };
  const { entities, constraints } = part.sketch;
  const points = new Map(entities.filter(e => e.type === 'point').map(e => [e.id, [e.x, e.y]]));
  const out = [];
  for (const e of entities) {
    // A spline's own tangent segments are part of that spline, not separately drawn geometry.
    if (e.owner?.type === 'splineHandle') continue;
    if (e.type === 'point') {
      if (e.standalone) out.push({ type: 'point', at: [e.x, e.y] });
    } else if (e.type === 'circle') {
      out.push({ type: 'circle', c: points.get(e.centerId), r: e.radius, construction: !!e.construction });
    } else if (e.type === 'arc') {
      out.push({ type: 'arc', c: points.get(e.centerId), r: e.radius, a: points.get(e.startId), b: points.get(e.endId), construction: !!e.construction });
    } else {
      out.push({ type: e.type, a: points.get(e.startId), b: points.get(e.endId), construction: !!e.construction });
    }
  }
  return {
    entities: out,
    dimensions: constraints.filter(c => typeof c.value === 'number').map(c => ({ kind: KINDS[c.type] ?? c.type, value: c.value, driven: !!c.driven })),
    constraints: constraints.filter(c => typeof c.value !== 'number').map(c => c.type),
  };
}

function entityMatches(expected, actual) {
  if (expected.type !== actual.type) return false;
  const tolerance = expected.tol ?? POSITION_TOLERANCE_MM;
  if (expected.at && !samePoint(expected.at, actual.at, tolerance)) return false;
  if (expected.c && !samePoint(expected.c, actual.c, tolerance)) return false;
  if (expected.r !== undefined && !close(expected.r, actual.r, tolerance)) return false;
  if (expected.a && expected.b) {
    const direct = samePoint(expected.a, actual.a, tolerance) && samePoint(expected.b, actual.b, tolerance);
    const swapped = samePoint(expected.a, actual.b, tolerance) && samePoint(expected.b, actual.a, tolerance);
    if (!direct && !swapped) return false;
  }
  return expected.construction === undefined || expected.construction === actual.construction;
}

/** Every expected item must claim a different actual item. */
function unmatched(expected, actual, matches) {
  const left = [...actual];
  const missing = [];
  for (const item of expected) {
    const index = left.findIndex(candidate => matches(item, candidate));
    if (index < 0) missing.push(item);
    else left.splice(index, 1);
  }
  return { missing, extra: left };
}

const dimensionMatches = (expected, actual) =>
  (expected.kind === undefined || expected.kind === actual.kind) &&
  (expected.value === undefined || close(expected.value, actual.value, expected.tol ?? VALUE_TOLERANCE)) &&
  (expected.driven === undefined || expected.driven === actual.driven);

/* Runs in the page. Reads what is on screen, in screen pixels. */
function readScene(cursor) {
  const svg = document.querySelector('[data-testid="cad-canvas"]');
  if (!svg) return { stage: location.pathname.split('/').pop(), noCanvas: true, pressed: [], labels: [], colors: {}, previewWidths: [], committedWidths: [], status: '', footer: '' };
  const visible = el => {
    const s = getComputedStyle(el);
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(s.stroke)?.[1];
    return s.stroke !== 'none' && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && Number(s.strokeOpacity) > 0 && (alpha === undefined || Number(alpha) > 0);
  };
  const width = el => {
    const s = getComputedStyle(el);
    const px = parseFloat(s.strokeWidth);
    if (s.vectorEffect === 'non-scaling-stroke') return px;
    const m = el.getScreenCTM();
    return px * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  };
  const shapes = 'line,path,polyline,polygon,circle,ellipse,rect';
  const preview = [...svg.querySelectorAll('.cad-preview')].flatMap(g => [...g.querySelectorAll(shapes)]).filter(visible);
  const committed = [...svg.querySelectorAll('[data-entity-id]')].flatMap(g => (g.matches(shapes) ? [g] : [...g.querySelectorAll(shapes)])).filter(visible);
  const rgb = el => (getComputedStyle(el).stroke.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const colors = { dark: 0, blue: 0, other: 0 };
  const seen = new Set();
  for (const el of committed) {
    const owner = el.closest('[data-entity-id]').getAttribute('data-entity-id');
    if (seen.has(owner)) continue;
    seen.add(owner);
    const [r, g, b] = rgb(el);
    if (r < 90 && g < 90 && b < 90) colors.dark++;
    else if (b > r + 60 && b > g + 40) colors.blue++;
    else colors.other++;
  }
  const texts = [...svg.querySelectorAll('text')].map(t => ({ text: t.textContent.trim(), rect: t.getBoundingClientRect() })).filter(t => /\d/.test(t.text));
  const segments = [...svg.querySelectorAll('[data-dimension-line]')].filter(visible).map(el => {
    const m = el.getScreenCTM();
    const map = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    if (el.tagName === 'line') return [map(+el.getAttribute('x1'), +el.getAttribute('y1')), map(+el.getAttribute('x2'), +el.getAttribute('y2'))];
    const r = el.getBoundingClientRect();
    return [[r.left, r.top], [r.right, r.bottom]];
  });
  const toSegment = ([x, y], [[ax, ay], [bx, by]]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const annotation = texts.length
    ? texts
        .map(t => {
          const c = [t.rect.left + t.rect.width / 2, t.rect.top + t.rect.height / 2];
          return {
            label: t.text,
            toCursor: cursor ? Math.hypot(c[0] - cursor[0], c[1] - cursor[1]) : null,
            toLine: segments.length ? Math.min(...segments.map(segment => toSegment(c, segment))) : null,
          };
        })
        .sort((a, b) => (a.toCursor ?? 0) - (b.toCursor ?? 0))[0]
    : null;
  const pressed = [...document.querySelectorAll('[aria-pressed="true"]')].map(el => el.getAttribute('aria-label') ?? '').filter(Boolean);
  const active = document.activeElement;
  return {
    previewCount: preview.length,
    previewWidths: preview.map(width),
    committedWidths: committed.map(width),
    colors,
    annotation,
    labels: texts.map(t => t.text),
    labelCentres: texts.map(t => ({ text: t.text, x: t.rect.left + t.rect.width / 2, y: t.rect.top + t.rect.height / 2 })),
    regions: svg.querySelectorAll('[data-sketch-region]').length,
    pressed,
    focusInput: !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'),
    status: document.querySelector('.cad-status')?.textContent ?? '',
    footer: document.querySelector('.cad-canvas-footer')?.textContent ?? '',
    stage: location.pathname.split('/').pop(),
    gridLines: svg.querySelectorAll('pattern, [data-grid], .cad-grid, .cad-grid line').length,
  };
}

/* Runs in the page. A reviewable drawing: real shapes in screen pixels, effective strokes, no names or IDs. */
function readFrame() {
  const svg = document.querySelector('[data-testid="cad-canvas"]');
  const box = svg.getBoundingClientRect();
  const n = value => Math.round(value * 100) / 100;
  const lines = [];
  for (const el of svg.querySelectorAll('line,path,polyline,polygon,circle,ellipse,rect')) {
    if (el.closest('pattern,defs,clipPath')) continue;
    const s = getComputedStyle(el);
    const hasStroke = s.stroke !== 'none' && !/,\s*0\)$/.test(s.stroke);
    const hasFill = s.fill !== 'none' && !/,\s*0\)$/.test(s.fill);
    if ((!hasStroke && !hasFill) || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    if (el.getAttribute('fill')?.startsWith('url(')) continue;
    const m = el.getScreenCTM();
    const px = parseFloat(s.strokeWidth);
    const width = s.vectorEffect === 'non-scaling-stroke' ? px : px * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const shape = {};
    for (const attr of ['d', 'points', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height']) {
      const value = el.getAttribute(attr);
      if (value !== null) shape[attr] = value.replace(/-?\d+\.\d+(?:e-?\d+)?/g, match => String(Math.round(Number(match) * 100) / 100));
    }
    const attrs = Object.entries(shape).map(([key, value]) => `${key}="${value}"`).join(' ');
    const matrix = [m.a, m.b, m.c, m.d, m.e - box.left, m.f - box.top].map(n).join(' ');
    lines.push(`<${el.tagName} ${attrs} transform="matrix(${matrix})" vector-effect="non-scaling-stroke" stroke="${hasStroke ? s.stroke : 'none'}" stroke-width="${n(width)}" stroke-dasharray="${s.strokeDasharray}" fill="${hasFill ? s.fill : 'none'}" fill-rule="${s.fillRule}" opacity="${s.opacity}"/>`);
  }
  for (const t of svg.querySelectorAll('text')) {
    const b = t.getBoundingClientRect();
    if (!b.width) continue;
    const s = getComputedStyle(t);
    // Centre, not corner: glyph widths differ between platforms' fonts, and a golden must not depend on them.
    lines.push(`<text x="${n(b.left + b.width / 2 - box.left)}" y="${n(b.top + b.height / 2 - box.top)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="11" fill="${s.fill}">${t.textContent.trim().replace(/[<&]/g, '')}</text>`);
  }
  // Document order, because later shapes draw over earlier ones.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(box.width)} ${Math.round(box.height)}">\n${lines.join('\n')}\n</svg>\n`;
}

export async function createAdapter(page, url) {
  // The dev server's type-check overlay would swallow every click; type errors have their own check.
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'vite-plugin-checker-error-overlay{display:none!important}';
      document.head.append(style);
    });
  });
  page.setDefaultNavigationTimeout(45000);
  await page.goto(new URL('/demo?camera=off', url).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: 'Demo mode', exact: true }).waitFor();
  await page.goto(new URL('/cam', url).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^New design/ }).click();
  const canvas = page.getByTestId('cad-canvas');
  await canvas.waitFor();
  const jobId = new URL(page.url()).pathname.split('/')[2];
  let cursor = null;

  const screen = ([x, y]) =>
    canvas.evaluate((svg, p) => {
      const q = new DOMPoint(p[0], -p[1]).matrixTransform(svg.getScreenCTM());
      return [q.x, q.y];
    }, [x, y]);
  const moveTo = async at => {
    const [x, y] = await screen(at);
    await page.mouse.move(x, y, { steps: 4 });
    cursor = [x, y];
    return [x, y];
  };
  const settle = async () => {
    await page
      .waitForFunction(() => {
        const status = document.querySelector('.cad-status')?.textContent ?? '';
        return !/Checking|Saving/.test(status) && document.querySelector('.cad-editor')?.getAttribute('aria-busy') !== 'true';
      }, undefined, { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(60);
  };
  const leaveTool = async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settle();
  };
  const click = async (at, options) => {
    await moveTo(at);
    await page.mouse.down(options);
    await page.mouse.up(options);
    await page.waitForTimeout(40);
  };
  const drag = async (from, to) => {
    await moveTo(from);
    await page.mouse.down();
    const [x, y] = await screen(to);
    await page.mouse.move(x, y, { steps: 12 });
    cursor = [x, y];
    await page.mouse.up();
    await page.waitForTimeout(60);
  };
  const chooseTool = async name => {
    const family = /arc|conic/i.test(name) ? 'Arc tools' : /rectangle/i.test(name) ? 'Rectangle tools' : 'Spline tools';
    await page.getByRole('button', { name: family, exact: true }).click();
    await page.locator('[role=menu][data-state=open]').getByRole('menuitem', { name, exact: true }).click();
  };
  const readDesign = (which = 'draft') =>
    page.evaluate(async ([id, key]) => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/cam/jobDb.ts')).at(-1);
      if (!url) throw new Error('Specs need the Vite development server');
      const { getJob } = await import(url);
      return (await getJob(id))?.design?.[key] ?? null;
    }, [jobId, which]);

  // Machine-only binding: the footer now homes, explicitly confirms the probe, then runs.
  const prepareMachine = async () => {
    const load = page.getByRole('button', { name: /^Load program/ }).first();
    if (await load.isEnabled().catch(() => false)) await load.click();
    const home = page.getByRole('button', { name: 'Home machine', exact: true });
    const probe = page.getByRole('button', { name: 'Probe Z', exact: true });
    const run = page.getByRole('button', { name: 'Run job', exact: true });
    if (await home.isVisible().catch(() => false)) {
      await home.click();
      await probe.or(run).waitFor({ timeout: 15000 });
    }
    if (await probe.isVisible().catch(() => false)) {
      await probe.click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Probe', exact: true }).click();
    }
    await run.waitFor({ timeout: 15000 });
    await page.waitForTimeout(900);
  };

  const step = async text => {
    const space = text.indexOf(' ');
    const verb = space < 0 ? text : text.slice(0, space);
    const rest = space < 0 ? '' : text.slice(space + 1);
    const args = rest.split(' ');
    switch (verb) {
      case 'key':
        await page.keyboard.press(rest);
        await page.waitForTimeout(40);
        return;
      case 'type':
        await page.keyboard.type(rest);
        return;
      case 'click':
        return click(point(rest));
      case 'rclick':
        return click(point(rest), { button: 'right' });
      case 'dblclick': {
        const [x, y] = await moveTo(point(rest));
        await page.mouse.dblclick(x, y);
        await page.waitForTimeout(80);
        return;
      }
      case 'shiftclick':
        await page.keyboard.down('Shift');
        await click(point(rest));
        await page.keyboard.up('Shift');
        return;
      case 'hover':
        await moveTo(point(rest));
        await page.waitForTimeout(80);
        return;
      case 'down':
        await moveTo(point(rest));
        await page.mouse.down();
        return;
      case 'move': {
        const [x, y] = await screen(point(rest));
        await page.mouse.move(x, y, { steps: 8 });
        cursor = [x, y];
        await page.waitForTimeout(60);
        return;
      }
      case 'up':
        await page.mouse.up();
        return;
      case 'drag':
        return drag(point(args[0]), point(args[1]));
      case 'wheel':
        await moveTo(point(args[0]));
        await page.mouse.wheel(0, Number(args[1]));
        await page.waitForTimeout(120);
        return;
      case 'tool':
        return chooseTool(rest);
      case 'button':
        await page.getByRole('button', { name: new RegExp(rest, 'i') }).first().click();
        return;
      case 'handle': {
        // handle <start|end> <point|segment>, optionally with Shift to add to the selection.
        const [end, part, add] = args;
        const target = page.locator(`[data-spline-handle-${part}="${end}"]`).first();
        const box = await target.boundingBox();
        if (add) await page.keyboard.down('Shift');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
        await page.mouse.down();
        await page.mouse.up();
        if (add) await page.keyboard.up('Shift');
        await page.waitForTimeout(80);
        return;
      }
      case 'uncheck':
        await page.getByLabel(rest, { exact: true }).uncheck();
        await page.waitForTimeout(80);
        return;
      case 'hold':
        await page.keyboard.down(rest);
        return;
      case 'release':
        await page.keyboard.up(rest);
        return;
      case 'selectdim':
      case 'editdim': {
        const label = page.locator('[data-dimension]').first();
        const box = await label.boundingBox();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y, { steps: 3 });
        if (verb === 'editdim') await page.mouse.dblclick(x, y);
        else await page.mouse.click(x, y);
        await page.waitForTimeout(100);
        return;
      }
      case 'addpart':
        await page.getByRole('button', { name: /add part|new part/i }).click();
        await settle();
        return;
      case 'line':
        await page.keyboard.press('l');
        await click(point(args[0]));
        await click(point(args[1]));
        return leaveTool();
      case 'rect':
        await page.keyboard.press('g');
        await click(point(args[0]));
        await click(point(args[1]));
        return leaveTool();
      case 'circle': {
        const [x, y] = point(args[0]);
        await page.keyboard.press('c');
        await click([x, y]);
        await click([x + Number(args[1]), y]);
        return leaveTool();
      }
      case 'arc':
        await page.keyboard.press('a');
        for (const at of args) await click(point(at));
        return leaveTool();
      case 'field': {
        const value = args.pop();
        const field = page.getByLabel(new RegExp(`^${args.join(' ')}`));
        await field.fill(value);
        await page.keyboard.press('Enter');
        return;
      }
      case 'fieldkeep': {
        const value = args.pop();
        await page.getByLabel(new RegExp(`^${args.join(' ')}`)).fill(value);
        await page.keyboard.press('Enter');
        return;
      }
      case 'reload':
        await settle();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        return;
      case 'reloadnow':
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        return;
      case 'goto':
        await settle();
        await page.getByRole('link', { name: new RegExp(rest) }).or(page.getByRole('button', { name: new RegExp(`^${rest}$`) })).first().click();
        await page.waitForTimeout(700);
        return;
      case 'start': {
        await prepareMachine();
        await page.getByRole('button', { name: /^Run job/ }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: /^Run( anyway)?$/ }).click({ timeout: 8000 });
        await page.getByText('Job started').first().waitFor({ timeout: 20000 });
        return;
      }
      case 'wait':
        await page.getByRole('button', { name: /Done, next/ }).waitFor({ timeout: 240000 });
        await page.waitForTimeout(800);
        return;
      case 'run': {
        // Only ever the demo's simulated controller: the adapter always enters demo mode above.
        await prepareMachine();
        await page.getByRole('button', { name: '16×', exact: true }).click();
        await page.getByRole('button', { name: /^Run job/ }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: /^Run( anyway)?$/ }).click({ timeout: 8000 });
        await page.getByText('Job started').first().waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: /Done, next/ }).waitFor({ timeout: 180000 });
        await page.waitForTimeout(500);
        return;
      }
      case 'edit':
        await page.getByText('Edit design', { exact: true }).first().click();
        await canvas.waitFor();
        await page.waitForTimeout(400);
        return;
      case 'finish':
        await settle();
        await page.getByRole('button', { name: /Finish sketch/ }).click();
        await page.waitForURL(u => !u.pathname.endsWith('/design'), { timeout: 8000 });
        await page.waitForTimeout(800);
        return;
      case 'cancel':
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        return;
      case 'design':
        await page.getByRole('link', { name: /Design/ }).first().click();
        await canvas.waitFor();
        await page.waitForTimeout(250);
        return;
      default:
        throw new Error(`Unknown step: ${text}`);
    }
  };

  const check = async expect => {
    const failures = [];
    const scene = await page.evaluate(readScene, cursor);
    const fail = (name, want, got) => failures.push(`${name}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    const sketchKeys = ['entities', 'entitiesInclude', 'entityCount', 'dimensions', 'dimensionsInclude', 'constraintsAtLeast', 'constraintsNone'];
    if (sketchKeys.some(key => key in expect)) {
      const design = await readDesign();
      const partIndex = expect.part ?? 0;
      const state = canonical(design?.parts?.[partIndex]);
      if ('entityCount' in expect && state.entities.length !== expect.entityCount) fail('entityCount', expect.entityCount, state.entities.length);
      for (const [key, exact] of [['entities', true], ['entitiesInclude', false]]) {
        if (!(key in expect)) continue;
        const { missing, extra } = unmatched(expect[key], state.entities, entityMatches);
        if (missing.length || (exact && extra.length)) fail(key, expect[key], state.entities);
      }
      for (const [key, exact] of [['dimensions', true], ['dimensionsInclude', false]]) {
        if (!(key in expect)) continue;
        const { missing, extra } = unmatched(expect[key], state.dimensions, dimensionMatches);
        if (missing.length || (exact && extra.length)) fail(key, expect[key], state.dimensions);
      }
      for (const [type, count] of Object.entries(expect.constraintsAtLeast ?? {})) {
        const got = state.constraints.filter(item => item === type).length;
        if (got < count) fail(`constraint ${type}`, `at least ${count}`, state.constraints);
      }
      for (const type of expect.constraintsNone ?? []) if (state.constraints.includes(type)) fail(`constraint ${type}`, 'none', state.constraints);
    }
    if ('acceptedEntityCount' in expect) {
      const accepted = await readDesign('accepted');
      const got = canonical(accepted?.parts?.[expect.part ?? 0]).entities.length;
      if (got !== expect.acceptedEntityCount) fail('acceptedEntityCount', expect.acceptedEntityCount, got);
    }
    if (expect.savedBoards) {
      const boards = await page.evaluate(async id => {
        const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/cam/jobDb.ts')).at(-1);
        const { getJob } = await import(url);
        return (await getJob(id))?.boards ?? [];
      }, jobId);
      const got = { count: boards.length, cut: boards.filter(b => b.cut).length, layout: boards.filter(b => b.layout).length };
      for (const key of Object.keys(expect.savedBoards)) if (got[key] !== expect.savedBoards[key]) fail(`savedBoards.${key}`, expect.savedBoards[key], got);
    }
    if ('regions' in expect && scene.regions !== expect.regions) fail('regions', expect.regions, scene.regions);
    if ('fieldTextNot' in expect) {
      const text = await page.evaluate(() => {
        const input = document.activeElement;
        if (input?.tagName !== 'INPUT') return null;
        const unit = [...(input.parentElement?.children ?? [])].filter(el => el !== input && getComputedStyle(el).display !== 'none').map(el => el.textContent).join(' ');
        return `${input.value} ${unit}`.trim();
      });
      if (text === null || new RegExp(expect.fieldTextNot, 'i').test(text)) fail('fieldTextNot', expect.fieldTextNot, text);
    }
    if (expect.labelAt) {
      const { text, at, tolPx = 25 } = expect.labelAt;
      const [x, y] = await screen(at);
      const found = scene.labelCentres?.find(label => new RegExp(text).test(label.text));
      if (!found || Math.hypot(found.x - x, found.y - y) > tolPx) fail('labelAt', { text, at, px: [x, y] }, found ?? scene.labels);
    }
    if ('labelText' in expect && !scene.labels.some(label => new RegExp(expect.labelText).test(label))) fail('labelText', expect.labelText, scene.labels);
    if ('tool' in expect) {
      const name = expect.tool.toLowerCase();
      if (!scene.pressed.some(label => label.toLowerCase().startsWith(name))) fail('tool', expect.tool, scene.pressed);
    }
    if ('status' in expect && !new RegExp(expect.status, 'i').test(scene.status)) fail('status', expect.status, scene.status.slice(0, 160));
    if ('readout' in expect && !new RegExp(expect.readout, 'i').test(scene.footer)) fail('readout', expect.readout, scene.footer);
    if ('focus' in expect && (expect.focus === 'input') !== scene.focusInput) fail('focus', expect.focus, scene.focusInput ? 'input' : 'canvas');
    if ('stage' in expect && scene.stage !== expect.stage) fail('stage', expect.stage, scene.stage);
    for (const [key, name] of [['canUndo', 'Undo (Ctrl or Command Z)'], ['canRedo', 'Redo (Ctrl or Command Shift Z)']]) {
      if (key in expect && (await page.getByRole('button', { name, exact: true }).isEnabled()) !== expect[key]) fail(key, expect[key], !expect[key]);
    }
    if ('canFinish' in expect && (await page.getByRole('button', { name: /Finish sketch/ }).isEnabled()) !== expect.canFinish) fail('canFinish', expect.canFinish, !expect.canFinish);
    if ('cursor' in expect) {
      const match = /(-?[\d.]+),\s*(-?[\d.]+)\s*mm/.exec(scene.footer);
      const got = match ? [Number(match[1]), Number(match[2])] : null;
      if (!got || !samePoint(expect.cursor, got, 1.5)) fail('cursor', expect.cursor, got);
    }
    if (expect.noFalseGrid && /\bgrid\b/i.test(scene.footer) && !scene.gridLines) fail('grid label', 'no label without a drawn grid', scene.footer);
    if ('pageText' in expect) {
      const text = await page.locator('body').innerText();
      if (!new RegExp(expect.pageText, 'i').test(text)) fail('pageText', expect.pageText, text.slice(0, 200));
    }
    if ('pageTextOnce' in expect) {
      const banner = await page.locator('[role=alert]').allInnerTexts();
      for (const text of banner) if (text.split(expect.pageTextOnce).length > 2) fail('pageTextOnce', expect.pageTextOnce, text);
    }
    if ('previewCount' in expect && scene.previewCount !== expect.previewCount) fail('previewCount', expect.previewCount, scene.previewCount);
    if (expect.strokePx) {
      const [low, high] = expect.strokePx;
      const widths = [...scene.previewWidths, ...scene.committedWidths];
      if (!widths.length) fail('strokePx', 'some strokes', 'none');
      if (widths.some(w => w < low || w > high)) fail('strokePx', expect.strokePx, widths.map(w => Math.round(w * 10) / 10));
    }
    if (expect.colors) {
      for (const [name, count] of Object.entries(expect.colors)) if (scene.colors[name] !== count) fail(`colors.${name}`, count, scene.colors);
    }
    if (expect.annotation) {
      const a = scene.annotation;
      if (!a) fail('annotation', expect.annotation, null);
      else {
        if (expect.annotation.nearCursorPx !== undefined && !(a.toCursor <= expect.annotation.nearCursorPx)) fail('annotation near cursor', expect.annotation.nearCursorPx, a);
        if (expect.annotation.onLinePx !== undefined && !(a.toLine !== null && a.toLine <= expect.annotation.onLinePx)) fail('annotation on its line', expect.annotation.onLinePx, a);
      }
    }
    return failures;
  };

  return { step, check, settle, frame: () => page.evaluate(readFrame) };
}
