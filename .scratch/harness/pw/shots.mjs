// Fixed-angle screenshots for before/after comparisons.
// Usage: PORT=3100 node shots.mjs <prefix>   (server and bots already running)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.env.OUT || path.join(process.env.WORK || '/home/sukuna/personal_projects/boxfire-work', 'shots');
fs.mkdirSync(dir, { recursive: true });
const port = process.env.PORT;
const prefix = process.argv[2] ?? 'shot';
export const ANGLES = {
  overview: '-19,9,-19,-2.356,-0.38',
  lane: '0,1.6,-17,3.1416,0.02',
  side: '15,1.6,-18,3.1416,0',
  crates: '-6,1.6,8,-0.9,-0.05',
};
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
for (const [name, cam] of Object.entries(ANGLES)) {
  const [vw, vh] = (process.env.VIEW || '1280x720').split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  await page.goto(`http://localhost:${port}/?debug&cam=${cam}`);
  await page.fill('#name', `cam-${name}`);
  await page.click('#join-form button');
  await page.waitForTimeout(400);
  if (await page.isVisible('#start')) await page.click('#start');
  await page.waitForSelector('#menu:not([hidden])', { timeout: 8000 });
  await page.addStyleTag({ content: '#menu, #stats { display: none !important; }' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(dir, `${prefix}-${name}.png`) });
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : `shots saved: ${prefix}-*`);
