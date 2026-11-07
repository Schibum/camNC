import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';

export default async function run(page, { baseURL, outputDir }) {
  const checks = [];
  const check = (name, pass) => { assert(pass, name); checks.push(name); };
  await page.goto(new URL('/cam', baseURL).href);
  await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await page.waitForURL('**/about');
  await page.getByRole('heading', { name: 'About camNC', level: 1, exact: true }).waitFor();
  check('About is reachable through application navigation', true);
  const summary = page.getByText('Read PlaneGCS 1.3.0 license', { exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  const text = page.getByRole('region', { name: 'PlaneGCS 1.3.0 license', exact: true });
  await text.waitFor();
  check('Keyboard disclosure displays the full LGPL text in the application', (await text.textContent()).includes('GNU LESSER GENERAL PUBLIC LICENSE') && (await text.textContent()).includes('END OF TERMS AND CONDITIONS'));
  const manifestLink = page.getByRole('link', { name: 'View source provenance and checksums', exact: true });
  const manifestResponse = await page.request.get(new URL(await manifestLink.getAttribute('href'), baseURL).href);
  assert(manifestResponse.ok());
  const manifest = await manifestResponse.json();
  for (const filename of Object.keys(manifest.files)) {
    const response = await page.request.get(new URL(`/licenses/planegcs/${filename}`, baseURL).href);
    assert(response.ok(), filename);
    check(`Shipped ${filename} matches its recorded checksum`, createHash('sha256').update(await response.body()).digest('hex') === manifest.files[filename]);
  }
  const licenseLinks = page.getByRole('link', { name: /^Download .* license$/ });
  check('Application and five component license downloads are visible', await licenseLinks.count() === 6);
  for (const link of await licenseLinks.all()) {
    const response = await page.request.get(new URL(await link.getAttribute('href'), baseURL).href);
    check(`${await link.textContent()} serves full text`, response.ok() && (await response.text()).length > 1000);
  }
  const notices = await page.request.get(new URL('/licenses/planegcs/THIRD_PARTY_NOTICES.md', baseURL).href);
  check('Shipped notices identify native source and separate dependency licenses', notices.ok() && (await notices.text()).includes('FreeCAD'));
  await page.screenshot({ path: path.join(outputDir, 'about-wide.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 520, height: 800 });
  check('About and expanded license text fit a narrow viewport', await page.getByRole('main').evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: path.join(outputDir, 'about-narrow.png'), animations: 'disabled' });
  return { checks };
}
