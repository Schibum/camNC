import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { installSyntheticCamera } from './synthetic-camera.mjs';
import { installSyntheticFluidNc } from './synthetic-fluidnc.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const defaultOutput = fileURLToPath(new URL('../../../output/playwright/setup-smoke/', import.meta.url));

/** Exercises deployed application UI and real OpenCV workers in a fresh, signed-out context. */
export async function runSetupSmoke(
  browser,
  { baseURL = 'https://run.camnc.app/', outputDir = defaultOutput, onProgress = message => console.log(message) } = {}
) {
  const target = new URL(baseURL);
  assert(['https:', 'http:'].includes(target.protocol), 'CAMNC_SMOKE_URL must be an HTTP(S) URL');
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(installSyntheticCamera);
  await context.addInitScript(installSyntheticFluidNc);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(45_000);
  const pageErrors = [];
  const consoleErrors = [];
  const consoleMessages = [];
  const report = { baseURL: target.href, startedAt: new Date().toISOString(), checks: [], failedRequests: [], websockets: [] };
  const urlParts = value => {
    const url = new URL(value);
    return { origin: url.origin, path: url.pathname };
  };
  const redactURLs = text =>
    text.replace(/(?:https?|wss?):\/\/[^\s)]+/g, value => {
      try {
        const { origin, path } = urlParts(value);
        return `${origin}${path}`;
      } catch {
        return '[invalid URL]';
      }
    });
  const observePage = (observed, label) => {
    observed.on('pageerror', error => pageErrors.push(`${label}: ${redactURLs(error.message)}`));
    observed.on('console', message => {
      const text = redactURLs(message.text()).slice(0, 2000);
      consoleMessages.push({ page: label, type: message.type(), text });
      if (consoleMessages.length > 100) consoleMessages.shift();
      if (message.type() === 'error') consoleErrors.push(`${label}: ${text}`);
    });
    observed.on('requestfailed', request => {
      report.failedRequests.push({
        page: label,
        ...urlParts(request.url()),
        method: request.method(),
        failure: redactURLs(request.failure()?.errorText || 'Unknown request failure'),
      });
    });
    observed.on('websocket', socket => {
      const record = { page: label, ...urlParts(socket.url()), createdAt: new Date().toISOString(), sent: 0, received: 0, errors: [] };
      report.websockets.push(record);
      socket.on('framesent', () => record.sent++);
      socket.on('framereceived', () => record.received++);
      socket.on('socketerror', error => record.errors.push(redactURLs(String(error))));
      socket.on('close', () => (record.closedAt = new Date().toISOString()));
    });
  };
  observePage(page, 'main');
  await mkdir(outputDir, { recursive: true });
  await context.tracing.start({ screenshots: true, snapshots: true });

  // Production still shows the title of the former separate top view page.
  const topViewTitle = /^Top View( \(Orthographic\))?$/;
  const check = message => {
    report.checks.push(message);
    onProgress(`PASS ${message}`);
  };
  const savedState = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem('settings');
      return raw ? JSON.parse(raw).json.state : null;
    });
  const navigate = async name => {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
    await page.getByRole('link', { name, exact: true }).click();
    await page.keyboard.press('Escape');
  };
  const waitForSavedCamera = async field => {
    await page.waitForFunction(field => {
      const raw = localStorage.getItem('settings');
      if (!raw) return false;
      const state = JSON.parse(raw).json.state;
      return Boolean(state.camSources[state.activeCamId]?.[field]);
    }, field);
    const state = await savedState();
    return state.camSources[state.activeCamId];
  };
  const darkCanvasPixels = async () => {
    // Read the composited screenshot: WebGL's drawing buffer may be cleared
    // between frames, so canvas.toDataURL() is not reliable for this assertion.
    const screenshot = await page.locator('canvas').screenshot();
    return page.evaluate(async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Near-black only: the marker squares are black, the view's dark backdrop (#0b0e13 and lighter) is not.
        if (Math.max(data[i], data[i + 1], data[i + 2]) < 12) dark++;
      }
      return dark;
    }, screenshot.toString('base64'));
  };
  const waitForCanvasChange = async predicate => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pixels = await darkCanvasPixels();
      if (predicate(pixels)) return pixels;
    }
    throw new Error('The synthetic scene change did not reach the rendered top-view canvas');
  };

  try {
    await page.goto(target.href);
    await page.getByRole('tab', { name: 'Webcam', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name of camera/machine setup' }).fill('Setup smoke camera');
    await page.getByText('camNC smoke camera', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth === 960);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForURL('**/setup/camera-calibration');
    await page.getByRole('button', { name: 'Capture frame (Space)', exact: true }).waitFor();
    check('camera selection opens live calibration');

    const poseCount = await page.evaluate(() => window.__camncSmokeCamera.poses.length);
    for (let pose = 0; pose < poseCount; pose++) {
      await page.evaluate(pose => window.__camncSmokeCamera.setPose(pose), pose);
      await page.waitForFunction(count => Number(document.querySelector('.recent-capture-count')?.textContent || 0) >= count, pose + 1);
      onProgress(`Captured chessboard pose ${pose + 1}/${poseCount}`);
    }
    check(`${poseCount} distinct chessboard views detected and captured by OpenCV`);
    await page.getByAltText('Recent capture').click();
    await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
    await page.getByRole('button', { name: 'Use this calibration', exact: true }).waitFor({ timeout: 45_000 });
    const rmsText = await page.getByText(/Reprojection Error \(RMS\):/).innerText();
    report.calibrationRms = Number(rmsText.split(':').at(-1));
    assert(report.calibrationRms < 1, `Calibration RMS must be below 1 px: ${rmsText}`);
    await page.screenshot({ path: path.join(outputDir, 'calibration.png') });
    await page.getByRole('button', { name: 'Use this calibration', exact: true }).click();
    await page.waitForURL('**/setup/machine-bounds');
    const calibrated = await waitForSavedCamera('calibration');
    const matrix = calibrated.calibration.calibration_matrix;
    for (const index of [0, 4]) assert(Math.abs(matrix[index] - 900) < 45, `Recovered focal length ${matrix[index]} differs from fixture`);
    assert(Math.abs(matrix[6] - 480) < 20 && Math.abs(matrix[7] - 360) < 20, 'Recovered optical center differs from fixture');
    check('calibration solver recovers the known camera and saves its result');

    await page.getByRole('spinbutton', { name: 'xmin', exact: true }).fill('0');
    await page.getByRole('spinbutton', { name: 'xmax', exact: true }).fill('-1');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByText('xmax must be greater than xmin', { exact: true }).waitFor();
    assert(new URL(page.url()).pathname === '/setup/machine-bounds');
    for (const [name, value] of Object.entries({ xmin: 0, xmax: 600, ymin: 0, ymax: 500 })) {
      await page.getByRole('spinbutton', { name, exact: true }).fill(String(value));
    }
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForURL('**/setup/marker-positions');
    check('machine bounds reject invalid input and accept the fixture bounds');

    const markers = await page.evaluate(() => window.__camncSmokeCamera.markers);
    await page.locator('input[name="arucoTagSize"]').fill(String(markers.tagSize));
    for (const [index, position] of markers.positions.entries()) {
      for (const [axis, value] of ['x', 'y', 'z'].map((axis, i) => [axis, position[i]])) {
        await page.locator(`input[name="markers.${index}.${axis}"]`).fill(String(value));
      }
    }
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForURL('**/setup/point-selection');
    await page.evaluate(() => window.__camncSmokeCamera.setScene('markers'));
    await page.getByRole('button', { name: 'Detect Arucos', exact: true }).click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'Save');
      return button && !button.disabled;
    });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Updated camera extrinsics', { exact: true }).waitFor();
    const positioned = await waitForSavedCamera('extrinsics');
    const state = await savedState();
    report.poseReprojectionError = state.pnpResult.lastReprojectionError;
    assert(report.poseReprojectionError < 2, `Pose reprojection error is ${report.poseReprojectionError} px`);
    assert.equal(positioned.markerPosInCam.length, 16);
    assert.deepEqual(positioned.markerPositions, markers.positions);
    check('four rendered ArUco tags are detected and a low-error camera pose is saved');

    await navigate('FluidNC');
    await page.getByText('Connect to FluidNC', { exact: true }).waitFor();
    await page.getByText('Not connected', { exact: true }).waitFor();
    // The camera is fully set up by now, so Continue skips the remaining setup steps.
    await page.getByRole('button', { name: 'Continue to top view', exact: true }).click();
    await page.waitForURL('**/visualize/2DView');
    check('optional machine connection can be skipped, straight to the top view once the camera is set up');

    await navigate('FluidNC');
    await page.getByLabel('Controller IP address').fill('192.168.77.7');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.getByText(/FluidNC 3\.9\.9/).waitFor();
    await navigate('Machine Bounds');
    await page.waitForURL('**/setup/machine-bounds');
    const readSettings = page.getByRole('button', { name: 'Read FluidNC Settings', exact: true });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'Read FluidNC Settings');
      return button && !button.disabled;
    });
    // Imported bounds differ from saved bounds, so a form reset cannot pass.
    for (const [name, value] of Object.entries({ xmin: 1, xmax: 599, ymin: 2, ymax: 498 })) {
      await page.getByRole('spinbutton', { name, exact: true }).fill(String(value));
    }
    await readSettings.click();
    await page.waitForFunction(() =>
      ['xmin', 'xmax', 'ymin', 'ymax'].every(
        (name, index) => document.querySelector(`input[name="${name}"]`)?.value === ['0', '700', '0', '550'][index]
      )
    );
    report.fluidncRequests = await page.evaluate(() => window.__camncSmokeFluidNc.requests);
    // Single config items only: a full $Config/Dump is slow on 3.9.x and has coincided with controller resets.
    assert(report.fluidncRequests.includes('$/axes/x/max_travel_mm'));
    assert(!report.fluidncRequests.includes('$Config/Dump'));
    assert.deepEqual(await page.evaluate(() => window.__camncSmokeFluidNc.rejected), []);
    check('connects to a simulated FluidNC 3.9.9 on port 81 and reads its bounds from single config items');

    await navigate('Top View');
    await page.getByLabel('breadcrumb').getByText(topViewTitle).waitFor();
    await page.reload();
    await page.getByLabel('breadcrumb').getByText(topViewTitle).waitFor();
    await page.evaluate(() => window.__camncSmokeCamera.setScene('markers'));
    const reloaded = await waitForSavedCamera('extrinsics');
    assert.deepEqual(reloaded.calibration, positioned.calibration);
    assert.deepEqual(reloaded.extrinsics, positioned.extrinsics);
    assert.deepEqual(reloaded.machineBounds, { min: [0, 0], max: [600, 500] });
    check('complete setup survives a page reload and opens the top view');

    // At the fixed viewport the four tags cover about 20k dark pixels. Wait
    // for them before taking a baseline; an initial white/black WebGL frame
    // must not race the scene-change assertion on slower CI machines.
    const markerPixels = await waitForCanvasChange(pixels => pixels > 8000 && pixels < 150_000);
    await page.evaluate(() => window.__camncSmokeCamera.setScene('blank'));
    const blankPixels = await waitForCanvasChange(pixels => markerPixels - pixels > 2000);
    await page.evaluate(() => window.__camncSmokeCamera.setScene('markers'));
    await waitForCanvasChange(pixels => pixels - blankPixels > 2000);
    check('top-view canvas renders live camera scene changes');

    const fileChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open gcode File', exact: true }).click();
    await (
      await fileChooser
    ).setFiles({
      name: 'smoke.nc',
      mimeType: 'text/plain',
      buffer: Buffer.from('G21\nG90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X100 Y0\nG1 X100 Y80\nG1 X0 Y80\nG1 X0 Y0\nG0 Z5\n'),
    });
    await page.getByRole('button', { name: 'Color Legend', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Info', exact: true }).click();
    for (const bounds of ['X: [0.00, 100.00]', 'Y: [0.00, 80.00]', 'Z: [-1.00, 5.00]']) {
      await page.getByText(bounds, { exact: true }).waitFor();
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Pause Video', exact: true }).click();
    await page.getByRole('button', { name: 'Play Video', exact: true }).click();
    await page.getByRole('button', { name: 'Pause Video', exact: true }).waitFor();
    check('G-code uploads with correct bounds and video pause/resume works');
    for (const [name, value] of [
      ['Tool Diameter', '3.2'],
      ['Stock Height', '5'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name, exact: true }).fill(value);
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert((await page.getByRole('button', { name, exact: true }).innerText()).includes(`${value}mm`));
    }
    check('tool diameter and stock height dialogs accept changes');
    await page.screenshot({ path: path.join(outputDir, 'top-view.png') });

    // The smoke also runs against production for pull requests, before the 3D views are deployed there.
    const threeDViewButton = page.getByRole('button', { name: '3D View', exact: true });
    if (await threeDViewButton.count()) {
      await threeDViewButton.click();
      const inspector = page.getByRole('region', { name: 'Depth Inspector', exact: true });
      await inspector.getByRole('button', { name: /^-1\.00\s*360mm$/ }).click();
      // Matches the depth summary of both the current and the previous panel layout.
      await inspector.getByText(/^Min Z/).waitFor();
      // Let the camera finish moving into the view for the screenshots.
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outputDir, 'depth-3d.png') });
      await page.getByRole('button', { name: 'Front View (XZ)', exact: true }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outputDir, 'depth-front.png') });
      await page.getByRole('button', { name: 'Top View', exact: true }).click();
      await inspector.waitFor({ state: 'detached' });
      check('3D views list cut levels of the loaded toolpath and switch back to the top view');
    } else {
      onProgress('SKIP 3D views are not deployed at this URL yet');
    }

    await navigate('Debug');
    const configuration = JSON.parse(await page.getByRole('textbox', { name: 'Camera Source Configuration', exact: true }).inputValue());
    assert.deepEqual(configuration.machineBounds, [0, 0, 600, 500]);
    assert.deepEqual(configuration.markerPositions, markers.positions);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exportedFile = path.join(outputDir, 'camera-source.json');
    await (await downloading).saveAs(exportedFile);
    const exported = JSON.parse(await readFile(exportedFile, 'utf8'));
    assert.equal(exported.json.name, 'Setup smoke camera');
    // A changed name makes completion observable: re-importing identical data
    // could otherwise pass before the application's FileReader had run.
    exported.json.name = 'Imported smoke camera';
    const importedFile = path.join(outputDir, 'camera-source-import.json');
    await writeFile(importedFile, JSON.stringify(exported));
    const importing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await (await importing).setFiles(importedFile);
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('settings');
      if (!raw) return false;
      const state = JSON.parse(raw).json.state;
      return state.camSources[state.activeCamId]?.name === 'Imported smoke camera';
    });
    const imported = await waitForSavedCamera('extrinsics');
    assert.deepEqual(imported.calibration, reloaded.calibration);
    assert.deepEqual(imported.extrinsics, reloaded.extrinsics);
    await navigate('Top View');
    await page.getByLabel('breadcrumb').getByText(topViewTitle).waitFor();
    check('camera configuration exports and imports through the UI');
    assert.deepEqual(pageErrors, [], `Uncaught browser errors: ${pageErrors.join('; ')}`);
    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join('; ')}`);
    report.finishedAt = new Date().toISOString();
    report.consoleErrors = consoleErrors;
    report.camera = imported;
    await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
    await context.tracing.stop();
    return report;
  } catch (error) {
    report.error = error.stack || String(error);
    report.pageErrors = pageErrors;
    report.consoleErrors = consoleErrors;
    report.consoleMessages = consoleMessages;
    report.url = page.url();
    await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
    await context.tracing.stop({ path: path.join(outputDir, 'failure-trace.zip') }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({
    headless: process.env.CAMNC_SMOKE_HEADED !== '1',
    // Allow Chromium's software WebGL fallback on CI machines without a GPU.
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const report = await runSetupSmoke(browser, {
      baseURL: process.env.CAMNC_SMOKE_URL || 'https://run.camnc.app/',
      outputDir: process.env.CAMNC_SMOKE_OUTPUT || defaultOutput,
    });
    console.log(
      JSON.stringify({
        status: 'passed',
        checks: report.checks.length,
        calibrationRms: report.calibrationRms,
        poseReprojectionError: report.poseReprojectionError,
      })
    );
  } finally {
    await browser.close();
  }
}
