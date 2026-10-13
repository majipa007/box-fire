// Browser smoke test: join, start, enter the arena, report console errors and
// debug stats, screenshot. Usage: PORT=3100 node smoke.mjs <name> [steps.mjs]
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT;
const shot = process.argv[2] ?? 'smoke';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const [vw, vh] = (process.env.VIEW || '1280x720').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${port}/`) && !r.url().startsWith(`ws://localhost:${port}`)) problems.push(`error: external request ${r.url()}`); });

await page.goto(`http://localhost:${port}/?debug`);
await page.fill('#name', 'Tester');
await page.click('#join-form button');
await page.waitForSelector('#start:not([hidden])', { timeout: 5000 });
await page.click('#start');
await page.waitForSelector('#menu:not([hidden])', { timeout: 5000 });
await page.waitForTimeout(1500);

if (process.argv[3]) await (await import(path.resolve(dir, process.argv[3]))).default(page);

const stats = await page.textContent('#stats').catch(() => null);
await page.evaluate(() => { document.getElementById('menu').hidden = true; });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(process.env.OUT || path.join(process.env.WORK || '/home/sukuna/personal_projects/boxfire-work', 'shots'), `${shot}.png`) });
console.log(JSON.stringify({ stats, problems }, null, 1));
await browser.close();
process.exit(problems.some((p) => p.startsWith('pageerror') || p.startsWith('error')) ? 1 : 0);
