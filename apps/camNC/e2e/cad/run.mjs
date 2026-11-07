import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const cases = {
  about: { description: 'Sidebar About page, full license disclosures, shipped notices/source and narrow layout' },
  'production-root': { description: 'Fresh no-key local root, demo choices, production WASM and Boards/reentry' },
  'free-sketch-growth': { description: 'Free press-drag rectangle, unconfirmed Width140→180, stable CAM placement, fitted growth and reload' },
  'modification-tools': { description: 'Linked signed Offset, Mirror diameter edits, two-pick line/arc Extend, previews at multiple zooms and reload' },
  'annotation-pan': { description: 'Right and middle pointer drags over Coincident and conic rho annotations preserve source geometry' },
  shelf: { description: 'Raw eight-line shelf side, driving dimensions, two-corner fillet, Finish/reentry', sourceAudit: true },
  'shelf-open': { description: 'Raw open shelf sections, trim, dimension and selection semantics', sourceAudit: true },
  conic: { description: 'Rho focus/edit, control drag, undo/redo, closure and reentry' },
  spline: { description: 'Independent fit points/end handles, added blue fit, closure and reentry' },
  bezier: { description: 'Control drag, black-polygon insertion, undo/redo, closure and reentry' },
  'periodic-spline': { description: 'One analytic periodic source, seam drag and reentry' },
  responsive: { description: 'Five viewport widths, independent family memory and keyboard menus' },
  'capsule-edit': { description: 'Replace a dimensioned capsule side with an inward notch' },
  'corbel-edit': { description: 'Replace a rounded corner with chamfer, then a different arc' },
  'jigsaw-edit': { description: 'Replace a major bulb arc with two lines and redimension' },
  'basics-source': { description: 'Eight line/arc/trim/point/drag/marquee/region/fillet cases', sourceAudit: true },
};

export function parseArgs(args) {
  const options = { baseURL: 'http://127.0.0.1:5180/', outputDir: fileURLToPath(new URL('../../../../output/playwright/cad-acceptance/', import.meta.url)), selected: Object.keys(cases), headed: false, list: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--list') options.list = true;
    else if (flag === '--headed') options.headed = true;
    else if (['--url', '--output', '--case'].includes(flag)) {
      const value = args[++index];
      assert(value && !value.startsWith('--'), `${flag} requires a value`);
      if (flag === '--url') options.baseURL = new URL(value).href;
      if (flag === '--output') options.outputDir = path.resolve(value);
      if (flag === '--case') options.selected = value === 'all' ? Object.keys(cases) : value.split(',');
    } else throw new Error(`Unknown option: ${flag}`);
  }
  assert(['http:', 'https:'].includes(new URL(options.baseURL).protocol), '--url must use HTTP(S)');
  for (const name of options.selected) assert(Object.hasOwn(cases, name), `Unknown case: ${name}`);
  return options;
}

function verifyResult(value, location = 'report') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'failure' && child) throw new Error(`${location}: ${child}`);
    if (['passed', 'pass'].includes(key)) assert(child, `${location} failed`);
    if (['errors', 'consoleErrors'].includes(key)) assert.equal(child.length, 0, `${location}.${key}: ${child.join('; ')}`);
    verifyResult(child, `${location}.${key}`);
  }
}

/** Fresh contexts and actual pointer/keyboard operations; no geometry or React-state injection. */
export async function runAcceptance(options) {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch({ headless: !options.headed });
  const summary = { baseURL: options.baseURL, startedAt: new Date().toISOString(), cases: [] };
  await mkdir(options.outputDir, { recursive: true });
  try {
    for (const name of options.selected) {
      const outputDir = path.join(options.outputDir, name);
      await mkdir(outputDir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      page.setDefaultNavigationTimeout(45_000);
      const record = { name, ...cases[name], pageErrors: [], consoleErrors: [] };
      summary.cases.push(record);
      page.on('pageerror', error => record.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') record.consoleErrors.push(message.text()); });
      console.log(`RUN ${name}`);
      try {
        // Root smoke must keep a genuinely fresh entry. Other cases explicitly opt into the simulated machine.
        if (name !== 'production-root') {
          await page.goto(new URL('/demo?camera=off', options.baseURL).href);
          await page.getByRole('region', { name: 'Demo mode', exact: true }).waitFor();
        }
        if (cases[name].sourceAudit) {
          const response = await context.request.get(new URL('/src/cam/jobDb.ts', options.baseURL).href);
          assert(response.ok() && /getJob/.test(await response.text()), `${name} needs the Vite development server for read-only source auditing; choose the deployable cases on production preview`);
        }
        const recipe = await import(`./cases/${name}.mjs`);
        record.result = await recipe.default(page, { baseURL: options.baseURL, outputDir });
        verifyResult(record.result);
        assert.equal(record.pageErrors.length, 0, record.pageErrors.join('; '));
        assert.equal(record.consoleErrors.length, 0, record.consoleErrors.join('; '));
        record.passed = true;
        console.log(`PASS ${name}`);
      } catch (error) {
        record.passed = false;
        record.failure = String(error);
        console.error(`FAIL ${name}: ${error.message}`);
        await page.screenshot({ path: path.join(outputDir, 'failure.png'), animations: 'disabled' }).catch(() => {});
      } finally {
        record.url = page.url();
        await context.tracing.stop({ path: path.join(outputDir, 'trace.zip') });
        await context.close();
        await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(record, null, 2) + '\n');
        await writeFile(path.join(options.outputDir, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
      }
    }
  } finally {
    await browser.close();
  }
  summary.finishedAt = new Date().toISOString();
  await writeFile(path.join(options.outputDir, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const [name, entry] of Object.entries(cases)) console.log(`${name}${entry.sourceAudit ? ' [Vite source audit]' : ''}: ${entry.description}`);
  } else {
    const report = await runAcceptance(options);
    if (report.cases.some(entry => !entry.passed)) process.exitCode = 1;
  }
}
