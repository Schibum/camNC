import assert from 'node:assert/strict';
import path from 'node:path';

/** Real-button panning over annotations; source and selections are never injected. */
export default async function run(page, { baseURL, outputDir }) {
  const result = { case: 'annotation-pan', checks: [] };
  const canvas = page.getByTestId('cad-canvas');
  const settle = () => page.waitForFunction(() => {
    const status = document.querySelector('.cad-status')?.textContent ?? '';
    return !/Checking|Solving|Saving/.test(status)
      && document.querySelector('.cad-editor')?.getAttribute('aria-busy') === 'false';
  });
  const click = async (x, y) => {
    const at = await canvas.evaluate((svg, [x, y]) => {
      const p = new DOMPoint(x, -y).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    }, [x, y]);
    await page.mouse.click(at.x, at.y);
  };
  const snapshot = () => canvas.evaluate(svg => {
    const geometry = [...svg.querySelectorAll('[data-visible-curve], circle.cad-point')].map(node => ({
      id: node.closest('[data-entity-id]')?.getAttribute('data-entity-id'),
      tag: node.tagName,
      coordinates: Object.fromEntries(['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'd', 'points']
        // Marker radius is hover/selection styling, not the point's source geometry.
        .filter(name => node.hasAttribute(name) && !(name === 'r' && node.classList.contains('cad-point')))
        .map(name => [name, node.getAttribute(name)])),
    }));
    const annotations = [...svg.querySelectorAll('[data-constraint-id], [data-conic-rho]')].map(node => ({
      id: node.getAttribute('data-constraint-id') ?? node.getAttribute('data-conic-rho'),
      text: node.getAttribute('aria-label'),
      position: node.getAttribute('transform'),
    }));
    return { geometry, annotations };
  });

  await page.goto(new URL('/cam', baseURL).href);
  await page.getByRole('button', { name: /^New design Sketch/ }).click();
  await canvas.waitFor();
  await settle();
  await page.getByRole('button', { name: 'Snap on', exact: true }).click();
  await canvas.press('g');
  await click(20, 20); await click(100, 80);
  await canvas.press('Escape'); await canvas.press('Escape');
  await page.getByRole('button', { name: await page.getByRole('button', { name: 'Drawing tools', exact: true }).count() ? 'Drawing tools' : 'Arc tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Conic', exact: true }).click();
  await click(140, 20); await click(220, 20); await click(180, 100);
  const rho = page.getByRole('textbox', { name: 'Conic rho', exact: true });
  await rho.fill('0.7'); await rho.press('Enter');
  await settle();
  await canvas.press('Escape'); await canvas.press('Escape');
  const coincident = canvas.locator('[data-inline-constraint="coincident"]').first();
  const rhoLabel = page.getByRole('button', { name: 'Edit conic rho: 0.7', exact: true });
  await coincident.waitFor(); await rhoLabel.waitFor();
  const source = await snapshot();
  assert.equal(source.geometry.filter(entity => entity.tag === 'line').length, 4);
  assert.equal(source.geometry.filter(entity => entity.tag === 'path').length, 1);

  for (const [name, target] of [['Coincident glyph', coincident], ['conic rho', rhoLabel]]) {
    for (const [button, dx, dy] of [['right', 28, 18], ['middle', -28, -18]]) {
      const bounds = await target.boundingBox();
      assert(bounds, `${name} has no live pointer bounds`);
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      const before = await canvas.getAttribute('viewBox');
      await page.mouse.move(x, y);
      await page.mouse.down({ button });
      try { await page.mouse.move(x + dx, y + dy, { steps: 8 }); }
      finally { await page.mouse.up({ button }); }
      await page.waitForFunction(view => document.querySelector('[data-testid="cad-canvas"]')?.getAttribute('viewBox') !== view, before);
      await settle();
      const after = await canvas.getAttribute('viewBox');
      assert.deepEqual(after.split(/\s+/).slice(2), before.split(/\s+/).slice(2), `${name}: pan changed zoom`);
      assert.deepEqual(await snapshot(), source, `${name}: ${button} pan changed geometry or annotation values/positions`);
      assert.equal(await page.getByRole('menu').count(), 0, `${name}: ${button} pan opened a menu`);
      assert.equal(await rho.count(), 0, `${name}: ${button} pan opened rho editing`);
      result.checks.push({ name: `${button} pan from ${name}`, passed: true, before, after });
    }
  }
  await page.screenshot({ path: path.join(outputDir, 'annotation-pan.png'), animations: 'disabled' });
  result.url = page.url();
  return result;
}
