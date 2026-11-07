import assert from 'node:assert/strict';
import path from 'node:path';

/** Full-app, real-pointer modification regressions; no injected geometry or selections. */
export default async function run(page, { baseURL, outputDir }) {
  const result = { case: 'modification-tools', checks: [] };
  const canvas = () => page.getByTestId('cad-canvas');
  const world = (x, y) => canvas().evaluate((svg, [x, y]) => {
    const p = new DOMPoint(x, -y).matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y };
  }, [x, y]);
  const click = async (x, y) => { const p = await world(x, y); await page.mouse.click(p.x, p.y); };
  const move = async (x, y) => { const p = await world(x, y); await page.mouse.move(p.x, p.y); };
  const drag = async (x, y, tx, ty) => {
    const p = await world(x, y), q = await world(tx, ty);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 12 }); await page.mouse.up();
  };
  const key = value => canvas().press(value);
  const settled = () => page.waitForFunction(() => {
    const status = document.querySelector('.cad-status')?.textContent ?? '';
    return !/Checking sketch|Solving/.test(status) && document.querySelector('.cad-editor')?.getAttribute('aria-busy') === 'false';
  });
  const fresh = async name => {
    await page.goto(new URL('/cam', baseURL).href);
    await page.getByRole('button', { name: /^New design Sketch/ }).click(); await canvas().waitFor(); await settled();
    await page.getByRole('textbox', { name: 'Part name', exact: true }).fill(name);
    await page.getByRole('textbox', { name: 'Part name', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Snap on', exact: true }).click();
  };
  const lines = () => canvas().locator('.cad-entity').filter({ has: page.locator('line[data-visible-curve]') }).evaluateAll(list => list.filter(e => !e.closest('[data-modification-preview]')).map(e => {
    const line = e.querySelector('line[data-visible-curve]');
    return { id: e.getAttribute('data-entity-id'), a: [Number(line.getAttribute('x1')), -Number(line.getAttribute('y1'))], b: [Number(line.getAttribute('x2')), -Number(line.getAttribute('y2'))] };
  }));
  const checkWeights = async name => {
    const values = await canvas().locator('[data-modification-preview] [data-visible-curve]').evaluateAll(list => list.map(e => ({ vector: getComputedStyle(e).vectorEffect, width: parseFloat(getComputedStyle(e).strokeWidth) })));
    assert(values.length, `${name} has no live preview`);
    assert(values.every(v => v.vector === 'non-scaling-stroke' && v.width === 1.5), `${name} preview line weight differs: ${JSON.stringify(values)}`);
    result.checks.push(`${name} preview uses 1.5px non-scaling strokes`);
  };
  const screenshot = name => page.screenshot({ path: path.join(outputDir, `${name}.png`) });

  await fresh('Offset plate');
  await key('g'); await click(40, 30); await click(140, 90); await key('Escape'); await key('Escape');
  const sourceLineIds = new Set((await lines()).map(line => line.id));
  await drag(20, 110, 160, 10); await key('o');
  await canvas().locator('[data-modification-preview] [data-visible-curve]').first().waitFor({ state: 'attached' });
  assert.equal(await canvas().locator('[data-modification-preview] [data-visible-curve]').count(), 4);
  const controlRows = await page.locator('.cad-offset-controls button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)));
  assert.equal(new Set(controlRows).size, 1, 'Offset value, accept and cancel must remain on one compact row');
  await checkWeights('Offset default'); await screenshot('offset-default-preview');
  await move(90, 60); await page.mouse.wheel(0, -480); await checkWeights('Offset zoomed'); await screenshot('offset-zoom-preview');
  await key('1'); await page.keyboard.type('0'); await page.keyboard.press('Enter'); await settled();
  assert.equal((await lines()).length, 8); result.checks.push('Four selected edges offset in one operation');
  await key('Escape'); await key('Escape');
  await page.getByRole('button', { name: 'Edit Offset: 10 mm', exact: true }).dblclick();
  const value = page.getByRole('textbox', { name: 'Offset mm', exact: true });
  await value.fill('-10'); await value.press('Enter'); await settled();
  const finalLines = await lines();
  const bounds = list => { const points = list.flatMap(line => [line.a, line.b]); return { minX: Math.min(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxX: Math.max(...points.map(p => p[0])), maxY: Math.max(...points.map(p => p[1])) }; };
  const sourceBounds = bounds(finalLines.filter(line => sourceLineIds.has(line.id))), outerBounds = bounds(finalLines.filter(line => !sourceLineIds.has(line.id)));
  // Free sketches may move as a relation is solved; inspect both actual linked profiles.
  assert(Math.abs(sourceBounds.minX - outerBounds.minX - 10) < .001);
  assert(Math.abs(sourceBounds.minY - outerBounds.minY - 10) < .001);
  assert(Math.abs(outerBounds.maxX - sourceBounds.maxX - 10) < .001);
  assert(Math.abs(outerBounds.maxY - sourceBounds.maxY - 10) < .001);
  result.offsetBounds = { source: sourceBounds, copy: outerBounds };
  result.checks.push('Signed shared offset edits reverse all four edges'); await screenshot('offset-outward-edit');
  await key('Control+z'); await settled(); await page.getByRole('button', { name: 'Edit Offset: 10 mm', exact: true }).waitFor();
  await key('Control+y'); await settled(); await page.getByRole('button', { name: 'Edit Offset: -10 mm', exact: true }).waitFor();
  result.checks.push('Offset edit Undo and Ctrl+Y Redo');
  await page.getByRole('button', { name: '✓ Finish sketch', exact: true }).click(); await page.waitForURL(/\/boards/);
  await page.getByRole('link', { name: '1 Design', exact: true }).click(); await canvas().waitFor();
  await page.getByRole('button', { name: 'Edit Offset: -10 mm', exact: true }).waitFor();
  await page.reload(); await canvas().waitFor(); await page.getByRole('button', { name: 'Edit Offset: -10 mm', exact: true }).waitFor();
  assert.equal((await lines()).length, 8); result.checks.push('Offset source and editable dimension survive Finish, reentry and reload');

  await fresh('Mirror holes');
  await key('l'); await click(100, 10); await click(100, 110); await key('Escape'); await key('Escape');
  await click(100, 60); await key('q'); await key('Space');
  await key('c'); await click(60, 60); await click(80, 60); await key('Escape'); await key('Escape');
  await click(80, 60); await page.getByRole('button', { name: 'Mirror', exact: true }).click();
  await move(100, 60); await checkWeights('Mirror'); await screenshot('mirror-axis-preview');
  await click(100, 60); await key('Escape'); await key('Escape'); await settled();
  assert.equal(await canvas().locator('circle[data-visible-curve]').count(), 2);
  await key('d'); await click(80, 60); await click(40, 100);
  const diameter = page.getByRole('textbox', { name: /mm$/ }).last();
  await diameter.fill('25'); await diameter.press('Enter'); await settled();
  const radii = await canvas().locator('circle[data-visible-curve]').evaluateAll(list => list.map(e => Number(e.getAttribute('r'))));
  assert(radii.every(radius => Math.abs(radius - 12.5) < .001)); result.checks.push('Mirrored circle remains linked to source diameter'); await screenshot('mirror-source-diameter-25');

  await fresh('Extend contours');
  await key('l'); await click(20, 40); await click(80, 40); await key('Escape'); await key('Escape');
  await key('l'); await click(120, 10); await click(120, 90); await key('Escape'); await key('Escape');
  await key('x'); await click(75, 40);
  const before = await lines();
  assert(before.some(line => Math.abs(line.b[0] - 80) < .001 && Math.abs(line.b[1] - 40) < .001));
  assert.equal(await canvas().locator('[data-modification-preview]').count(), 0);
  result.checks.push('First Extend pick leaves committed geometry unchanged');
  await key('Escape');
  assert.equal(await page.getByRole('button', { name: 'Select (Esc)', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await lines(), before);
  result.checks.push('One Escape cancels pending Extend and returns to Select');
  await key('x'); await click(75, 40);
  await move(120, 60); await checkWeights('Extend line'); await screenshot('extend-line-preview');
  await click(120, 60); await settled();
  assert((await lines()).some(line => Math.abs(line.a[0] - 20) < .001 && Math.abs(line.b[0] - 120) < .001 && Math.abs(line.b[1] - 40) < .001));
  result.checks.push('Off-axis boundary pick extends line to finite intersection');
  await key('Control+z'); await settled();
  assert((await lines()).some(line => Math.abs(line.b[0] - 80) < .001)); result.checks.push('Extend is one Undo');
  await key('Control+a'); await key('Delete'); await settled();
  await key('a'); await click(120, 40); await click(80, 40); await click(100, 60); await key('Escape'); await key('Escape');
  await key('l'); await click(100, 5); await click(100, 30); await key('Escape'); await key('Escape');
  await key('x'); await click(83, 50); await move(100, 25); await checkWeights('Extend arc'); await screenshot('extend-arc-preview');
  await click(100, 25); await settled();
  const arc = await canvas().locator('path[data-visible-curve]').getAttribute('d');
  const arcNumbers = arc.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  [120, -40, 20, 20, 0, 1, 0, 100, -20].forEach((expected, index) => assert(Math.abs(arcNumbers[index] - expected) < .001, `Arc coordinate ${index}: ${arcNumbers[index]}`));
  result.checks.push('Extended arc keeps center and radius through three-quarter sweep'); await screenshot('extend-arc-committed');
  return result;
}
