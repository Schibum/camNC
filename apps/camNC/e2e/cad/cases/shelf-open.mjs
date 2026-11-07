// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
export default async function run(page, { baseURL, outputDir }) {
  const output = outputDir;
  const report = { cases: [], errors: [], consoleErrors: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  let current;
  const check = (name, passed, detail) => { current.scenarios.push({ name, passed, detail }); if (!passed) throw new Error(name); };
  const setup = async name => {
    await page.goto(new URL('/cam',baseURL).href);
    await page.getByRole('button', { name: /^New design Sketch/ }).click();
    const canvas = page.locator('svg.cad-canvas'); await canvas.waitFor();
    const jobId = new URL(page.url()).pathname.split('/')[2]; current.jobId = jobId;
    const read = () => page.evaluate(async id => {
      const observed = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/cam/jobDb.ts')).at(-1);
      const { getJob } = await import(observed); return (await getJob(id))?.design?.draft;
    }, jobId);
    const settle = async () => { await page.waitForFunction(() => { const text = document.querySelector('.cad-status')?.textContent; return text && !/Checking|Saving/.test(text); }); await page.waitForTimeout(200); };
    const screen = (x, y) => canvas.evaluate((svg, point) => { const p = new DOMPoint(point.x, -point.y).matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; }, { x, y });
    const click = async (x, y) => { const p = await screen(x, y); await page.mouse.click(p.x, p.y); };
    const select = async () => { await page.getByRole('button', { name: 'Select (Esc)', exact: true }).click(); await click(-20, -20); };
    const state = async () => ({ status: await page.locator('.cad-status').innerText(), alerts: await page.locator('[role=alert]').allTextContents(), fill: await canvas.locator('[data-sketch-region]').count(), canFinish: await page.getByRole('button', { name: /Finish sketch/ }).isEnabled() });
    const hit = async id => {
      const p = await canvas.evaluate((svg, id) => { const group = [...svg.querySelectorAll('.cad-entity')].find(element => element.getAttribute('data-entity-id') === id); const shape = group.querySelector('line,path'); const p = shape.getPointAtLength(shape.getTotalLength() / 2).matrixTransform(shape.getScreenCTM()); return { x: p.x, y: p.y }; }, id);
      await page.mouse.click(p.x, p.y);
    };
    const dimension = async (id, value, x, y) => {
      await select(); await page.keyboard.press('d'); await hit(id); await click(x, y);
      await page.locator('#cad-edit-dimension').waitFor(); await page.locator('#cad-edit-dimension').fill(String(value)); await page.locator('#cad-edit-dimension').press('Enter'); await settle();
    };
    const editDimension = async value => { await canvas.locator('[data-dimension]').first().dblclick(); await page.locator('#cad-edit-dimension').fill(String(value)); await page.locator('#cad-edit-dimension').press('Enter'); await settle(); };
    const undo = async () => { await page.getByRole('button', { name: 'Undo (Ctrl or Command Z)', exact: true }).click(); await settle(); };
    const redo = async () => { await page.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)', exact: true }).click(); await settle(); };
    const reenter = async () => { await page.goBack(); await page.getByRole('button', { name: /^New design Sketch/ }).waitFor(); await page.goForward(); await canvas.waitFor(); await settle(); };
    const fit = async () => { await page.getByRole('button', { name: 'Fit F', exact: true }).click(); await settle(); };
    await page.getByRole('textbox', { name: 'Part name', exact: true }).fill(name); await page.getByRole('textbox', { name: 'Part name', exact: true }).press('Enter');
    return { canvas, read, settle, screen, click, select, state, hit, dimension, editDimension, undo, redo, reenter, fit };
  };
  const lineLength = (document, index = 0) => { const sketch = document.parts[0].sketch, lines = sketch.entities.filter(entity => entity.type === 'line'), points = new Map(sketch.entities.filter(entity => entity.type === 'point').map(point => [point.id, point])); const a = points.get(lines[index].startId), b = points.get(lines[index].endId); return Math.hypot(b.x - a.x, b.y - a.y); };
  try {
    current = { case: 'Single open line section', scenarios: [] }; report.cases.push(current);
    const ui = await setup('Open line section fixture');
    await page.keyboard.press('l'); await ui.click(0, 0); await ui.click(0, 100); await page.keyboard.press('Escape'); await ui.settle();
    let source = await ui.read(); const lineId = source.parts[0].sketch.entities.find(entity => entity.type === 'line').id;
    const expectedLength = Number('479.97085834500897'); // Keep full precision in the dimension fixture.
    await ui.dimension(lineId, expectedLength, 25, 50); await ui.fit();
    current.original = await ui.read();
    check('Line retains the full-precision fixture length', Math.abs(lineLength(current.original) - expectedLength) < 1e-6, { length: lineLength(current.original), ...await ui.state() });
    check('Open section has no region and correctly blocks Finish', (await ui.state()).fill === 0 && !(await ui.state()).canFinish && !(await ui.state()).alerts.length, await ui.state());
    await page.screenshot({ path: `${output}/app-case2-01-open-section.png` });
    await ui.editDimension(490);
    check('Open section length edits to490 without a geometry conflict', Math.abs(lineLength(await ui.read()) - 490) < 1e-6 && !(await ui.state()).alerts.length, await ui.state());
    await ui.undo(); check('Undo restores the full-precision section length', Math.abs(lineLength(await ui.read()) - expectedLength) < 1e-6);
    await ui.redo(); check('Redo restores490 length', Math.abs(lineLength(await ui.read()) - 490) < 1e-6);
    const beforeReentry = await ui.read(); await ui.reenter();
    check('Open draft reentry preserves source IDs and driving dimensions', JSON.stringify((await ui.read()).parts) === JSON.stringify(beforeReentry.parts), await ui.state());
    await ui.select(); await page.keyboard.press('Shift+s'); await ui.click(0, 245); await page.keyboard.press('Escape'); await ui.settle();
    const withPoint = await ui.read(); const midpoint = withPoint.parts[0].sketch.entities.find(entity => entity.type === 'point' && entity.standalone && Math.abs(entity.x) < 1e-6 && Math.abs(entity.y - 245) < 1e-6);
    check('Standalone midpoint carries a persistent midpoint relation', !!midpoint && withPoint.parts[0].sketch.constraints.some(constraint => constraint.type === 'midpoint' && constraint.pointId === midpoint.id));
    await page.keyboard.press('m'); await ui.click(0, 100); await page.keyboard.press('Escape'); await ui.settle();
    current.trimmed = await ui.read();
    check('Trim removes only the lower half and retains midpoint identity', Math.abs(lineLength(current.trimmed) - 245) < 1e-6 && current.trimmed.parts[0].sketch.entities.some(entity => entity.id === midpoint.id), await ui.state());
    check('Trim removes the old whole-line driving dimension', !current.trimmed.parts[0].sketch.constraints.some(constraint => constraint.type === 'distance' && constraint.sourceEntityId === lineId));
    await page.screenshot({ path: `${output}/app-case2-02-point-trim.png` });
    await ui.undo(); check('One Undo restores the entire pre-trim point and line graph', JSON.stringify((await ui.read()).parts) === JSON.stringify(withPoint.parts));
  } catch (error) { current.failure = String(error); await page.screenshot({ path: `${output}/app-case2-failure.png` }); }
  try {
    current = { case: 'Two open diagonal line sections', scenarios: [] }; report.cases.push(current);
    const ui = await setup('Open diagonal section fixture');
    await page.getByRole('button', { name: 'Snap on', exact: true }).click();
    for (let i = 0; i < 30; i++) {
      const top = await ui.screen(115, 390), bounds = await ui.canvas.boundingBox();
      if (top.y > bounds.y + 20 && top.x < bounds.x + bounds.width - 20) break;
      const origin = await ui.screen(0, 0); await page.mouse.move(origin.x, origin.y); await page.mouse.wheel(0, 100); await page.waitForTimeout(25);
    }
    const expected = [[104.8, 235.3647253932049, 0, 370.0857123033839], [105, 0, 0, 134.9780880302367]];
    for (const [x1, y1, x2, y2] of expected) { await page.getByRole('button', { name: 'Select (Esc)', exact: true }).click(); await page.keyboard.press('l'); await ui.click(x1, y1); await ui.click(x2, y2); await page.keyboard.press('Escape'); }
    await ui.fit(); current.original = await ui.read();
    const sketch = current.original.parts[0].sketch, lines = sketch.entities.filter(entity => entity.type === 'line'), points = new Map(sketch.entities.filter(entity => entity.type === 'point').map(point => [point.id, point]));
    const error = Math.max(...lines.flatMap((line, index) => { const a = points.get(line.startId), b = points.get(line.endId), e = expected[index]; return [Math.hypot(a.x - e[0], a.y - e[1]), Math.hypot(b.x - e[2], b.y - e[3])]; }));
    check('Two fixture lines retain exact coordinates with Snapoff and no unintended axis constraints', lines.length === 2 && error < 5e-5 && sketch.constraints.length === 0, { maximumCoordinateError: error, ...await ui.state() });
    check('Intentional0.2mm start-point X offset remains distinct', Math.abs(Math.abs(points.get(lines[0].startId).x - points.get(lines[1].startId).x) - 0.2) < 5e-5);
    check('Open diagonal sections stay unfilled with Finish blocked', (await ui.state()).fill === 0 && !(await ui.state()).canFinish, await ui.state());
    await page.screenshot({ path: `${output}/app-case3-01-exact-lines.png` });
    const lengths = expected.map(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1));
    await ui.dimension(lines[0].id, lengths[0], 70, 320); await ui.dimension(lines[1].id, lengths[1], 75, 70);
    const beforeEdit = await ui.read();
    await ui.editDimension(lengths[0] + 5); current.edited = await ui.read();
    check('A diagonal driving length edit stays valid without inventing a closed contour', Math.abs(lineLength(current.edited) - lengths[0] - 5) < 1e-5 && !(await ui.state()).alerts.length && !(await ui.state()).canFinish, await ui.state());
    await ui.undo(); check('Undo restores the entire pre-edit source graph', JSON.stringify((await ui.read()).parts) === JSON.stringify(beforeEdit.parts));
    await ui.redo(); check('Redo reapplies the diagonal length edit', Math.abs(lineLength(await ui.read()) - lengths[0] - 5) < 1e-5);
    await ui.undo(); const beforeBox = await ui.read(); await ui.select();
    const start = await ui.screen(-10, -10), end = await ui.screen(115, 380);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
    const selected = await ui.canvas.locator('.cad-entity').evaluateAll(groups => groups.filter(group => [...group.querySelectorAll('line,path')].some(shape => shape.getAttribute('stroke') === '#ff9b23')).length);
    check('Window drag selects both whole lines', selected === 2, { selected });
    await page.keyboard.press('Delete'); await ui.settle(); check('Delete removes just the selected lines', !(await ui.read()).parts[0].sketch.entities.some(entity => entity.type === 'line'));
    await ui.undo(); check('One Undo restores both lines and their dimensions', JSON.stringify((await ui.read()).parts) === JSON.stringify(beforeBox.parts));
    const beforeReentry = await ui.read(); await ui.reenter(); current.restored = await ui.read();
    check('Draft reentry retains both open diagonal curves and dimension references', JSON.stringify(current.restored.parts) === JSON.stringify(beforeReentry.parts), await ui.state());
    await page.screenshot({ path: `${output}/app-case3-02-dimensioned-reentered.png` });
  } catch (error) { current.failure = String(error); await page.screenshot({ path: `${output}/app-case3-failure.png` }); }
  return report;
}
