// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
export default async function run(page, { baseURL, outputDir }) {
  const out = outputDir;
  const report = { checks: [], errors: [], consoleErrors: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  const check = (name, pass) => { report.checks.push({name, pass}); if (!pass) throw Error(name); };
  await page.goto(new URL('/', baseURL).href);
  await page.getByRole('region', {name:'Demo mode', exact:true}).waitFor();
  await page.getByRole('button', {name:'Connected Idle', exact:true}).waitFor();
  check('Fresh root opens a simulated demo without a Clerk key', await page.getByRole('button', {name:'Connected Idle', exact:true}).isVisible());
  await page.screenshot({path: `${out}/app-production-root.png`});
  await page.goto(new URL('/demo', baseURL).href);
  await page.getByRole('heading', {name:'Try camNC without a machine', exact:true}).waitFor();
  check('Bare demo retains its entry choices', await page.getByRole('link', {name:'Without a camera', exact:true}).isVisible());
  await page.getByRole('link', {name:'Without a camera', exact:true}).click();
  await page.getByRole('region', {name:'Demo mode', exact:true}).waitFor();
  await page.goto(new URL('/cam', baseURL).href);
  await page.getByRole('button', {name:/^New design Sketch/}).click();
  const canvas = page.getByTestId('cad-canvas'); await canvas.waitFor();
  const settle = async () => page.waitForFunction(() => {
    const text = document.querySelector('.cad-status')?.textContent;
    return text && !/Checking|Saving/.test(text) && document.querySelector('.cad-editor')?.getAttribute('aria-busy') !== 'true';
  });
  const click = async (x, y) => { const p = await canvas.evaluate((svg, p) => { const point = new DOMPoint(p[0], -p[1]).matrixTransform(svg.getScreenCTM()); return {x:point.x, y:point.y}; }, [x,y]); await page.mouse.click(p.x,p.y); };
  await page.getByRole('textbox', {name:'Part name', exact:true}).fill('Production preview plate');
  await page.getByRole('textbox', {name:'Part name', exact:true}).press('Enter');
  await canvas.press('g'); await click(20,20); await click(200,140); await canvas.press('Escape'); await canvas.press('Escape');
  await canvas.press('c'); await click(100,80); await click(120,80); await canvas.press('Escape'); await canvas.press('Escape'); await settle();
  check('Production WASM validates a rectangle and circular hole', await page.getByRole('button', {name:/Finish sketch/}).isEnabled());
  await page.getByRole('button', {name:/Finish sketch/}).click(); await page.waitForURL(/\/boards/);
  await page.getByRole('region', {name:'Board A drawing', exact:true}).waitFor({timeout:60000});
  check('Finished sketch opens the board editor', true);
  await page.screenshot({path:`${out}/app-production-boards.png`});
  await page.getByRole('link', {name:/1\s*Design/}).click(); await canvas.waitFor(); await settle();
  check('Production CAD reentry retains four lines and a circle', await canvas.locator('.cad-entity').evaluateAll(groups => groups.filter(group => group.querySelector('title')?.textContent === 'line').length) === 4 && await canvas.locator('.cad-entity').evaluateAll(groups => groups.filter(group => group.querySelector('title')?.textContent === 'circle').length) === 1);
  await page.getByRole('button', {name:'Arc tools', exact:true}).click();
  check('Production toolbar exposes Arc, Tangent arc and Conic together', await page.getByRole('menuitem', {name:'Arc (A)', exact:true}).isVisible() && await page.getByRole('menuitem', {name:'Tangent arc (Shift+A)', exact:true}).isVisible() && await page.getByRole('menuitem', {name:'Conic', exact:true}).isVisible());
  await page.screenshot({path:`${out}/app-production-cad-reentry.png`, animations:'disabled'});
  await page.keyboard.press('Escape');
  report.url = page.url();
  return report;
}
