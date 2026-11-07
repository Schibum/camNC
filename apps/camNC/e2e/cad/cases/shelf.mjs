// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
export default async function run(page, { baseURL, outputDir }) {
  const output = outputDir;
  const report = { case: 'Shelf side: eight-line polygon', scenarios: [], errors: [], consoleErrors: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  const check = (name, passed, detail) => {
    report.scenarios.push({ name, passed, detail });
    if (!passed) throw new Error(name);
  };
  try {
    await page.goto(new URL('/cam', baseURL).href);
    await page.getByRole('button', { name: /^New design Sketch/ }).click();
    const canvas = page.locator('svg.cad-canvas'); await canvas.waitFor();
    const jobId = new URL(page.url()).pathname.split('/')[2]; report.jobId = jobId;
    const read = () => page.evaluate(async id => {
      const observed = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/cam/jobDb.ts')).at(-1);
      if (!observed) throw new Error('No observed jobDb module');
      const { getJob } = await import(observed); return (await getJob(id))?.design?.draft;
    }, jobId);
    const settle = async () => {
      await page.waitForFunction(() => { const text = document.querySelector('.cad-status')?.textContent; return text && !/Checking|Saving/.test(text); });
      await page.waitForTimeout(200);
    };
    const screen = (x, y) => canvas.evaluate((svg, point) => {
      const p = new DOMPoint(point.x, -point.y).matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y };
    }, { x, y });
    const click = async (x, y) => { const p = await screen(x, y); await page.mouse.click(p.x, p.y); };
    const select = async () => { await page.getByRole('button', { name: 'Select (Esc)', exact: true }).click(); await click(-20, -20); };
    const hit = async id => {
      const p = await canvas.evaluate((svg, id) => {
        const group = [...svg.querySelectorAll('.cad-entity')].find(element => element.getAttribute('data-entity-id') === id);
        const shape = group?.querySelector('line,path,circle'); if (!shape) throw new Error(`Missing curve ${id}`);
        const point = shape.getPointAtLength(shape.getTotalLength() / 2).matrixTransform(shape.getScreenCTM()); return { x: point.x, y: point.y };
      }, id); await page.mouse.click(p.x, p.y);
    };
    const state = async () => ({
      status: await page.locator('.cad-status').innerText(),
      alerts: await page.locator('[role=alert]').allTextContents(),
      canFinish: await page.getByRole('button', { name: /Finish sketch/ }).isEnabled(),
      fill: await canvas.locator('[data-sketch-region]').count(),
      dimensions: await canvas.locator('[data-dimension]').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label'))),
    });
    await page.getByRole('textbox', { name: 'Part name', exact: true }).fill('Shelf side fixture');
    await page.getByRole('textbox', { name: 'Part name', exact: true }).press('Enter');
    // Zoom through the UI, anchored at the origin, until the complete 500mm sketch fits.
    for (let i = 0; i < 35; i++) {
      const a = await screen(-45, -30), b = await screen(210, 530), bounds = await canvas.boundingBox();
      if ([a, b].every(p => p.x > bounds.x + 15 && p.x < bounds.x + bounds.width - 15 && p.y > bounds.y + 15 && p.y < bounds.y + bounds.height - 15)) break;
      const origin = await screen(0, 0); await page.mouse.move(origin.x, origin.y); await page.mouse.wheel(0, 100); await page.waitForTimeout(25);
    }
    await page.keyboard.press('l');
    for (const [x, y] of [[0, 0], [130, 0], [130, 470], [151, 470], [151, 350], [181, 350], [181, 500], [0, 500], [0, 0]]) await click(x, y);
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Fit F', exact: true }).click(); await settle();
    const original = await read(); report.original = original;
    const lines = original.parts[0].sketch.entities.filter(entity => entity.type === 'line');
    const points = new Map(original.parts[0].sketch.entities.filter(entity => entity.type === 'point').map(point => [point.id, point]));
    const expected = [[0, 0], [130, 0], [130, 470], [151, 470], [151, 350], [181, 350], [181, 500], [0, 500]];
    check('Eight lines form the expected closed outline', lines.length === 8 && lines.every((line, index) => Math.hypot(points.get(line.startId).x - expected[index][0], points.get(line.startId).y - expected[index][1]) < 1e-6), await state());
    check('Closed shelf has shading and Finish enabled before dimensions', (await state()).fill === 1 && (await state()).canFinish, await state());
    await page.screenshot({ path: `${output}/app-case1-01-raw.png` });
    // Place the short-step label in empty canvas; y=500 hits the top edge and selects a second D reference.
    for (const [index, value, x, y] of [[7, 500, -35, 250], [0, 130, 65, -25], [5, 150, 220, 425], [4, 30, 205, 330], [2, 21, 140, 485]]) {
      await select(); await page.keyboard.press('d'); await hit(lines[index].id); await click(x, y);
      await page.locator('#cad-edit-dimension').waitFor(); await page.locator('#cad-edit-dimension').fill(String(value)); await page.locator('#cad-edit-dimension').press('Enter'); await settle();
      check(`Driving length ${value}mm applied`, (await state()).dimensions.includes(`Edit Length: ${value} mm`), await state());
    }
    await select(); await page.keyboard.press('d');
    await page.getByRole('combobox', { name: 'Dimension type', exact: true }).selectOption('distanceY');
    await click(151, 470); await click(181, 500); await click(245, 485);
    await page.locator('#cad-edit-dimension').waitFor(); await page.locator('#cad-edit-dimension').fill('30'); await page.locator('#cad-edit-dimension').press('Enter'); await settle();
    check('Independent top-wall vertical thickness30 fully constrains the sketch', (await state()).dimensions.includes('Edit Vertical distance: 30 mm') && (await state()).status.includes('Fully constrained'), await state());
    for (const [before, after] of [[500, 510], [130, 135]]) {
      await page.getByRole('button', { name: `Edit Length: ${before} mm`, exact: true }).dblclick();
      await page.locator('#cad-edit-dimension').fill(String(after)); await page.locator('#cad-edit-dimension').press('Enter'); await settle();
      check(`Driving length ${before}→${after} edits without conflict`, (await state()).canFinish && !(await state()).alerts.length, await state());
    }
    await select();
    await page.keyboard.down('Shift'); await click(0, 0); await click(0, 510); await page.keyboard.up('Shift');
    const beforePreview = await read();
    await page.keyboard.press('Shift+f'); await page.getByRole('textbox', { name: 'Fillet radius', exact: true }).fill('10');
    check('Two-corner fillet preview does not commit source', JSON.stringify((await read()).parts) === JSON.stringify(beforePreview.parts));
    await page.getByRole('button', { name: 'Apply fillets', exact: true }).click(); await settle();
    const filleted = await read();
    check('One batch creates two real R10 arcs', filleted.parts[0].sketch.entities.filter(entity => entity.type === 'arc').length === 2 && (await state()).canFinish, await state());
    await page.getByRole('button', { name: 'Edit Fillet radius: 10 mm', exact: true }).dblclick();
    await page.locator('#cad-edit-dimension').fill('12'); await page.locator('#cad-edit-dimension').press('Enter'); await settle();
    const radii = doc => doc.parts[0].sketch.entities.filter(entity => entity.type === 'arc').map(entity => entity.radius);
    check('Editing R10→R12 drives both fillets', radii(await read()).length === 2 && radii(await read()).every(radius => Math.abs(radius - 12) < 1e-5), await state());
    await page.getByRole('button', { name: 'Undo (Ctrl or Command Z)', exact: true }).click(); await settle();
    check('Undo radius restores both R10 fillets', radii(await read()).every(radius => Math.abs(radius - 10) < 1e-5));
    await page.getByRole('button', { name: 'Undo (Ctrl or Command Z)', exact: true }).click(); await settle();
    check('One Undo removes the entire two-corner batch', radii(await read()).length === 0);
    await page.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)', exact: true }).click(); await settle();
    check('One Redo restores both R10 fillets', radii(await read()).length === 2 && radii(await read()).every(radius => Math.abs(radius - 10) < 1e-5));
    await page.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)', exact: true }).click(); await settle();
    check('Redo radius restores both R12 fillets', radii(await read()).every(radius => Math.abs(radius - 12) < 1e-5));
    report.edited = await read(); report.finalState = await state();
    check('Edited side remains shaded and accepts machining transition', report.finalState.fill === 1 && report.finalState.canFinish && !report.finalState.alerts.length, report.finalState);
    const shade = await canvas.evaluate(svg => { const fill = svg.querySelector('[data-sketch-region]'); return { body: fill.isPointInFill(new DOMPoint(50, -250)), gap: fill.isPointInFill(new DOMPoint(145, -400)), roundedCorner: fill.isPointInFill(new DOMPoint(1, -1)) }; });
    check('Shading covers the body and excludes the hook gap and rounded-away corner', shade.body && !shade.gap && !shade.roundedCorner, shade);
    await page.screenshot({ path: `${output}/app-case1-02-edited.png` });
    await page.getByRole('button', { name: /Finish sketch/ }).click(); await page.waitForURL(/\/boards/);
    await page.getByRole('region', { name: 'Board A drawing', exact: true }).waitFor({ timeout: 60000 });
    report.boardUrl = page.url(); await page.screenshot({ path: `${output}/app-case1-03-boards.png` });
    await page.getByRole('link', { name: '1 Design', exact: true }).click(); await canvas.waitFor(); await settle();
    const reentered = await read();
    check('Reentry retains all geometry IDs, dimensions, fillets and source revision', JSON.stringify(reentered.parts) === JSON.stringify(report.edited.parts), await state());
    await page.screenshot({ path: `${output}/app-case1-04-reentered.png` });
  } catch (error) {
    report.failure = String(error); report.url = page.url();
    await page.screenshot({ path: `${output}/app-case1-failure.png` });
  }
  return report;
}
