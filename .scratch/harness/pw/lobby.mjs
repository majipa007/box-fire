// The lobby: join, wait for the world to build behind the card, screenshot.
import { chromium } from 'playwright-core';
const port = process.env.PORT;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
await page.goto(`http://localhost:${port}/`);
await page.fill('#name', 'Lobbyist');
await page.click('#join-form button');
await page.waitForTimeout(6000);
await page.screenshot({ path: (process.env.OUT || '/home/sukuna/personal_projects/boxfire-work/shots') + '/lobby.png' });
console.log(JSON.stringify({ problems }));
await browser.close();
