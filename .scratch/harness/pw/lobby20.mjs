// Ticket 20, the lobby leg: two tabs vote 1 to 1 (the host for arena_02),
// Start goes to the host's pick, and both clients switch. Also the 960x540
// check that a full lobby card still scrolls to Start, and 1280x720 stills of
// the lobby and scoreboard cards as $OUT/t20-lobby.png and t20-scoreboard.png.
//   BOTS=8 serve.sh /abs/path/lobby20.mjs   (8 bots + 2 tabs: a full game)
import { chromium } from '/home/sukuna/personal_projects/game/.scratch/harness/pw/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';

const port = process.env.PORT;
const out = process.env.OUT || '/home/sukuna/personal_projects/boxfire-work/shots';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
const lastLobby = new Map(); // page → its last lobby message: the server's word
const waitMap = (page, id) => page.waitForFunction((id) => document.getElementById('stats')?.textContent.startsWith(`${id} ·`), id, { timeout: 60000 });

async function open(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('websocket', (ws) => ws.on('framereceived', ({ payload }) => {
    if (String(payload).startsWith('{"t":"lobby"')) lastLobby.set(page, JSON.parse(payload));
  }));
  page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${port}/`) && !r.url().startsWith(`ws://localhost:${port}`)) problems.push(`${name}: external request ${r.url()}`); });
  await page.goto(`http://localhost:${port}/?debug`);
  await page.fill('#name', name);
  await page.click('#join-form button');
  await page.waitForSelector('#lobby-maps [data-map=arena_02]');
  return page;
}

try {
  const host = await open('Tester');
  const ally = await open('Ally');
  await host.click('#lobby-maps [data-map=arena_02]');
  await ally.click('#lobby-maps [data-map=arena_02]');
  await ally.click('#lobby-maps [data-map=arena_01]'); // a changed vote
  await host.waitForFunction(() => [...document.querySelectorAll('#lobby-maps .mc-count')].map((e) => e.textContent).join() === '1,1');
  assert.equal(await host.getAttribute('#lobby-maps [data-map=arena_02]', 'aria-pressed'), 'true');
  assert.equal(await ally.getAttribute('#lobby-maps [data-map=arena_01]', 'aria-pressed'), 'true');
  assert.equal(await host.locator('#lobby-players li').count(), 10, 'a full game');
  await waitMap(host, 'arena_01');
  await host.locator('#lobby-maps').scrollIntoViewIfNeeded();
  await host.screenshot({ path: path.join(out, 't20-lobby.png') });

  // A full lobby at 960x540 still scrolls to Start.
  await host.setViewportSize({ width: 960, height: 540 });
  await host.locator('#start').scrollIntoViewIfNeeded();
  const box = await host.locator('#start').boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= 540, `Start in view at 960x540: ${JSON.stringify(box)}`);
  await host.screenshot({ path: path.join(out, 't20-lobby-960.png') });
  await host.click('#start');

  // 1 to 1: the host's pick. Both clients build on it.
  await waitMap(host, 'arena_02');
  await waitMap(ally, 'arena_02');
  assert.equal(lastLobby.get(host).map, 'arena_02', 'the host is on arena_02');
  assert.equal(await host.$eval('#lobby-maps', (el) => [...el.children].find((c) => c.textContent.includes('Now playing'))?.dataset.map), 'arena_02', 'its card says so');
  assert.equal(await host.textContent('#lobby-maps [data-map=arena_02] .mc-count'), '0', 'votes cleared at the start');
  console.log('lobby Start: tie went to the host\'s pick, both clients on arena_02');

  // The scoreboard's cards, with a vote on each, at 1280x720.
  await host.setViewportSize({ width: 1280, height: 720 });
  await host.click('#end-match');
  await host.waitForSelector('#scoreboard.over:not([hidden])');
  await ally.click('#sb-maps [data-map=arena_01]');
  await host.click('#sb-maps [data-map=arena_02]');
  await host.waitForFunction(() => [...document.querySelectorAll('#sb-maps .mc-count')].map((e) => e.textContent).join() === '1,1');
  await host.screenshot({ path: path.join(out, 't20-scoreboard.png') });
  console.log('scoreboard cards ok');
} finally {
  console.log(JSON.stringify({ problems }));
  await browser.close();
}
process.exit(problems.length ? 1 : 0);
