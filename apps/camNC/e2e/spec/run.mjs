import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const options = { url: null, only: '', headed: false, list: false, update: false, workers: 4 };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--') continue;
    if (flag === '--url') options.url = args[++i];
    else if (flag === '--only') options.only = args[++i];
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--list') options.list = true;
    else if (flag === '--update-goldens') options.update = true;
    else if (flag === '--workers') options.workers = Math.max(1, Number(args[++i]) || 1);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

/** A port nothing is using, so runs from different worktrees don't collide. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function loadScenarios(only) {
  const scenarios = [];
  const base = path.join(root, 'scenarios');
  for (const domain of await readdir(base)) {
    for (const file of (await readdir(path.join(base, domain))).filter(name => name.endsWith('.json')).sort()) {
      const list = JSON.parse(await readFile(path.join(base, domain, file), 'utf8'));
      for (const scenario of list) {
        assert(scenario.id?.startsWith(`${domain}/`), `${file}: ${scenario.id} must start with ${domain}/`);
        assert(scenario.title && scenario.evidence, `${scenario.id} needs a title and evidence`);
        assert(!scenarios.some(other => other.id === scenario.id), `Duplicate scenario ${scenario.id}`);
        scenarios.push(scenario);
      }
    }
  }
  return scenarios.filter(scenario => scenario.id.startsWith(only));
}

/** Same drawing within 2 px: same elements in the same order, every number close. */
function sameSvg(actual, golden) {
  const tokens = text => text.split(/(-?\d+(?:\.\d+)?)/);
  const a = tokens(actual);
  const b = tokens(golden);
  if (a.length !== b.length) return false;
  return a.every((token, i) => (i % 2 ? Math.abs(Number(token) - Number(b[i])) <= 2 : token === b[i]));
}

async function compareFrame(scenario, name, svg, options, outDir) {
  const file = `${scenario.id.replaceAll('/', '.')}.${name}.svg`;
  const golden = path.join(root, 'goldens', scenario.id.split('/')[0], file);
  await writeFile(path.join(outDir, file), svg);
  if (options.update) {
    await mkdir(path.dirname(golden), { recursive: true });
    await writeFile(golden, svg);
    return null;
  }
  if (!existsSync(golden)) return null;
  return sameSvg(svg, await readFile(golden, 'utf8')) ? null : `frame ${name} differs from its golden; see ${path.join(outDir, file)}`;
}

async function runScenario(browser, scenario, options, outDir) {
  const { createAdapter } = await import(`./adapters/${scenario.id.split('/')[0]}.mjs`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  // A cold Vite server can still compile lazy editor modules after DOMContentLoaded.
  page.setDefaultTimeout(45000);
  const runtime = [];
  page.on('pageerror', error => runtime.push(`page error: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') runtime.push(`console error: ${message.text()}`);
  });
  const failures = [];
  let phase = 'bootstrap';
  try {
    const adapter = await createAdapter(page, options.url);
    page.setDefaultTimeout(8000);
    for (const [index, step] of scenario.steps.entries()) {
      phase = `step ${index + 1}`;
      if (typeof step === 'object') {
        await adapter.settle();
        failures.push(...(await adapter.check(step.expect)).map(failure => `step ${index + 1}: ${failure}`));
      } else if (step.startsWith('frame ')) {
        await adapter.settle();
        const failure = await compareFrame(scenario, step.slice(6), await adapter.frame(), options, outDir);
        if (failure) failures.push(failure);
      } else {
        await adapter.step(step);
      }
    }
    await adapter.settle();
  } catch (error) {
    failures.push(`stopped during ${phase}: ${String(error.message).split('\n').slice(0, 12).join('\n        ')}`);
  }
  failures.push(...runtime);
  if (failures.length) await page.screenshot({ path: path.join(outDir, `${scenario.id.replaceAll('/', '.')}.png`) }).catch(() => {});
  await context.close();
  return failures;
}

const options = parseArgs(process.argv.slice(2));
const scenarios = await loadScenarios(options.only);
if (options.list) {
  for (const scenario of scenarios) console.log(`${scenario.id}  ${scenario.title}`);
  process.exit(0);
}
const outDir = fileURLToPath(new URL('../../../../output/playwright/spec/', import.meta.url));
await mkdir(outDir, { recursive: true });
let server = null;
if (!options.url) {
  // Own a server unless given one, so one command runs everything, locally and in CI.
  const port = await freePort();
  options.url = `http://127.0.0.1:${port}`;
  server = spawn('pnpm', ['vite', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], {
    cwd: path.resolve(root, '../..'),
    env: { ...process.env, CAMNC_SKIP_TYPECHECK: '1' },
    stdio: 'ignore',
    detached: true,
  });
  const started = Date.now();
  for (;;) {
    const ready = await fetch(options.url).then(response => response.ok).catch(() => false);
    if (ready) break;
    assert(Date.now() - started < 120_000, 'The dev server did not start');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: !options.headed });
const counts = { PASS: 0, FAIL: 0, XFAIL: 0, XPASS: 0 };
const results = [];
const run = async (scenario, index) => {
  const failures = await runScenario(browser, scenario, options, outDir);
  const result = failures.length ? (scenario.known ? 'XFAIL' : 'FAIL') : scenario.known ? 'XPASS' : 'PASS';
  counts[result]++;
  results[index] = { id: scenario.id, result, failures };
  const lines = [`${result.padEnd(5)} ${scenario.id}`];
  if (result === 'FAIL') lines.push(...failures.map(failure => `        ${failure}`));
  if (result === 'XFAIL') lines.push(`        known: ${scenario.known}`);
  if (result === 'XPASS') lines.push(`        now passes; remove known: ${scenario.known}`);
  console.log(lines.join('\n'));
};
// The first scenario runs alone, so the dev server's cold start can't eat into the timeouts of several at once.
if (scenarios.length) await run(scenarios[0], 0);
// Rewriting goldens stays serial, so a run can be compared with what it replaced in order.
const workers = options.update ? 1 : options.workers;
let next = 1;
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (next < scenarios.length) {
      const index = next++;
      await run(scenarios[index], index);
    }
  })
);
await browser.close();
if (server) process.kill(-server.pid);
await writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`\n${scenarios.length} scenarios: ${counts.PASS} pass, ${counts.FAIL} fail, ${counts.XFAIL} known gaps, ${counts.XPASS} newly passing`);
if (counts.FAIL || counts.XPASS) process.exitCode = 1;
