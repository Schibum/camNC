// Reproduces the free-rectangle production failure using real input and public DOM/SVG evidence only.
import path from 'node:path';

export default async function run(page, { baseURL, outputDir }) {
  const report = { case: 'Free rectangle: unconfirmed width and fitted-stock growth', checks: [] };
  const check = (name, passed, detail) => {
    report.checks.push({ name, passed, ...(detail && { detail }) });
    if (!passed) throw new Error(name);
  };
  const canvas = page.getByTestId('cad-canvas');
  const settle = () => page.waitForFunction(() => {
    const status = document.querySelector('.cad-status')?.textContent;
    return status && !/Checking|Saving/.test(status) && document.querySelector('.cad-editor')?.getAttribute('aria-busy') !== 'true';
  });
  const curves = () => canvas.locator('.cad-entity').evaluateAll(groups => groups.map(group => ({
    id: group.getAttribute('data-entity-id'), type: group.querySelector('title')?.textContent,
  })));
  const screenPoint = (x, y) => canvas.evaluate((svg, point) => {
    const at = new DOMPoint(point.x, -point.y).matrixTransform(svg.getScreenCTM());
    return { x: at.x, y: at.y };
  }, { x, y });
  const readBoard = () => page.getByRole('region', { name: 'Board A drawing', exact: true }).evaluate(section => {
    const stock = section.querySelector('[data-board-frame] > rect');
    const body = section.querySelector('g[data-item]');
    const bounds = body?.querySelector('path')?.getBBox();
    const text = section.textContent ?? '';
    return {
      id: section.getAttribute('data-board-drop'),
      size: { w: Number(stock?.getAttribute('width')), h: Number(stock?.getAttribute('height')) },
      itemId: body?.getAttribute('data-item'),
      at: bounds && { x: bounds.x, y: bounds.y },
      bodySize: bounds && { w: bounds.width, h: bounds.height },
      rotated: !!bounds && bounds.height > bounds.width,
      yield: Number(text.match(/Yield\s+([\d.]+)\s*%/)?.[1] ?? 0),
      unplaced: section.querySelectorAll('[data-unplaced]').length,
      fitWarning: /don[’']t fit|doesn[’']t fit|would not be cut/i.test(text),
      settings: {
        material: section.querySelector('[aria-label="Material"]')?.textContent?.trim(),
        thickness: section.querySelector('[aria-label="Stock thickness"]')?.value,
      },
    };
  });
  const waitBoard = async (w, h) => {
    await page.waitForURL(/\/boards(?:\?|$)/);
    await page.getByRole('region', { name: 'Board A drawing', exact: true }).waitFor({ timeout: 60_000 });
    await page.waitForFunction(({ w, h }) => {
      const section = document.querySelector('[data-board-drawing]');
      const stock = section?.querySelector('[data-board-frame] > rect');
      return Number(stock?.getAttribute('width')) === w && Number(stock?.getAttribute('height')) === h && /Yield\s+[\d.]+\s*%/.test(section.textContent ?? '');
    }, { w, h }, { timeout: 60_000 });
    const board = await readBoard();
    check(`Fitted stock is ${w} × ${h}, has positive yield and no missing part`, board.size.w === w && board.size.h === h && board.yield > 0 && board.unplaced === 0 && !board.fitWarning, board);
    return board;
  };
  const toBoards = () => page.getByRole('link', { name: /2\s*Boards/ }).click();
  const toDesign = async () => {
    await page.getByRole('link', { name: /1\s*Design/ }).click();
    await canvas.waitFor();
    await settle();
  };

  await page.goto(new URL('/cam', baseURL).href);
  await page.getByRole('button', { name: /^New design Sketch/ }).click();
  await canvas.waitFor();
  await settle();
  report.jobId = new URL(page.url()).pathname.split('/')[2];

  await canvas.press('g');
  const start = await screenPoint(24, 98), end = await screenPoint(176, 7);
  report.gesture = { world: { start: { x: 24, y: 98 }, end: { x: 176, y: 7 } }, css: { start, end } };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  const passiveWidth = page.getByRole('button', { name: 'Rectangle width: 152 mm. Enter a value', exact: true });
  await passiveWidth.waitFor();
  const originalCurves = await curves();
  check('The exact press–drag–release gesture creates four lines', originalCurves.length === 4 && originalCurves.every(curve => curve.type === 'line'), originalCurves);
  await passiveWidth.click();
  const creationWidth = page.getByRole('textbox', { name: 'Rectangle width value', exact: true });
  await creationWidth.fill('140');
  check('Width 140 stays unconfirmed before the Boards click', await creationWidth.inputValue() === '140' && await canvas.locator('[data-dimension]').count() === 0);
  await page.screenshot({ path: path.join(outputDir, '01-free-width-140-unconfirmed.png'), animations: 'disabled' });
  await toBoards();
  const firstBoard = await waitBoard(105, 154);
  check('The initial fitted part is rotated 90 degrees', firstBoard.rotated, firstBoard);
  report.firstBoard = firstBoard;
  await page.screenshot({ path: path.join(outputDir, '02-free-width-140-boards.png'), animations: 'disabled' });

  await toDesign();
  const dimension140 = page.getByRole('button', { name: 'Edit Horizontal distance: 140 mm', exact: true });
  await dimension140.waitFor();
  report.dimensionId = await dimension140.getAttribute('data-dimension');
  check('Undo survives Finish and Design reentry within this session', await page.getByRole('button', { name: 'Undo (Ctrl or Command Z)', exact: true }).isEnabled());
  await dimension140.dblclick();
  const value = page.locator('#cad-edit-dimension');
  await value.waitFor();
  await value.fill('180');
  check('Dimension 180 stays unconfirmed before the next Boards click', await value.inputValue() === '180');
  await page.screenshot({ path: path.join(outputDir, '03-free-width-180-unconfirmed.png'), animations: 'disabled' });
  await toBoards();
  const grown = await waitBoard(105, 194);
  check('Growing the part preserves the same board, instance, CAM placement and settings', grown.id === firstBoard.id && grown.itemId === firstBoard.itemId && grown.rotated === firstBoard.rotated && JSON.stringify(grown.at) === JSON.stringify(firstBoard.at) && JSON.stringify(grown.settings) === JSON.stringify(firstBoard.settings), grown);
  report.grownBoard = grown;
  await page.screenshot({ path: path.join(outputDir, '04-free-width-180-boards.png'), animations: 'disabled' });

  await page.reload();
  const reloaded = await waitBoard(105, 194);
  check('Reload retains the fitted board, instance, placement and settings', reloaded.id === firstBoard.id && reloaded.itemId === firstBoard.itemId && reloaded.rotated === firstBoard.rotated && JSON.stringify(reloaded.at) === JSON.stringify(firstBoard.at) && JSON.stringify(reloaded.settings) === JSON.stringify(firstBoard.settings), reloaded);
  report.reloadedBoard = reloaded;
  await page.screenshot({ path: path.join(outputDir, '05-free-width-180-reloaded.png'), animations: 'disabled' });
  await toDesign();
  const dimension180 = page.getByRole('button', { name: 'Edit Horizontal distance: 180 mm', exact: true });
  await dimension180.waitFor();
  const finalCurves = await curves();
  check('Reload and Design reentry retain the dimension and four source line identities', await dimension180.getAttribute('data-dimension') === report.dimensionId && finalCurves.length === 4 && finalCurves.every(curve => curve.type === 'line') && JSON.stringify(finalCurves.map(curve => curve.id).sort()) === JSON.stringify(originalCurves.map(curve => curve.id).sort()), finalCurves);
  check('The reentered 180 mm rectangle is closed and accepted', await canvas.locator('[data-sketch-region]').count() === 1 && await page.getByRole('button', { name: /Finish sketch/ }).isEnabled());
  await page.screenshot({ path: path.join(outputDir, '06-free-width-180-reentered.png'), animations: 'disabled' });
  report.url = page.url();
  return report;
}
