// Ticket 20, for smoke.mjs (which has joined as host and started on arena_01):
// the scoreboard vote switches to arena_02; a late joiner and a rejoin by name
// land on it mid-match; End match, vote arena_01 by key, the switch back.
// The client's map is the id its collision was built from (the ?debug stats
// line); the host's is the card marked as playing, and each joiner's welcome.
//   BOTS=2 VIEW=640x360 serve.sh pw/smoke.mjs t20 /abs/path/steps20.mjs
//
// The joiners run on the Low preset. A mid-match joiner builds its stage in one
// long task while snapshots pour in; past the heartbeat's DEAD_MS (5 s) the host
// drops it as dead. Real GPUs compile in under a second, but SwiftShader on a
// busy machine takes 10 s or more at Default (the base commit does the same).
// Each joiner must still be hearing lobby messages 6 s after its HUD shows.
import assert from 'node:assert/strict';

const clientMap = (page) => page.evaluate(() => document.getElementById('stats').textContent.split(' · ')[0]);
const waitMap = (page, id) => page.waitForFunction((id) => document.getElementById('stats')?.textContent.startsWith(`${id} ·`), id, { timeout: 60000 });
const hostMap = (page) => page.$eval('#lobby-maps', (el) => [...el.children].find((c) => c.textContent.includes('Now playing'))?.dataset.map);

async function endMatch(page) {
  await page.evaluate(() => document.exitPointerLock());
  await page.click('#end-match', { timeout: 5000 });
  await page.waitForSelector('#scoreboard.over:not([hidden]) #sb-maps [data-map]');
  assert.equal(await page.isVisible('#menu'), false, 'the pause menu waits under the scoreboard');
}

async function waitOut(page, id) {
  await page.waitForSelector('#scoreboard', { state: 'hidden', timeout: 60000 });
  await waitMap(page, id);
  assert.equal(await hostMap(page), id, `host on ${id}`);
  assert.equal(await clientMap(page), id, `client on ${id}`);
}

// A second tab joining as `name` (Low preset), with its own error listeners,
// its welcome, and proof its socket outlived the stage build.
async function join(page, name, problems) {
  const p = await page.context().browser().newPage({ viewport: page.viewportSize() });
  const seen = { welcome: null, lastLobby: 0, closed: false };
  await p.addInitScript(() => {
    localStorage.setItem('boxfire.settings', JSON.stringify({ v: 2, quality: 'low', shadows: false }));
    window.longestTask = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.longestTask = Math.max(window.longestTask, e.duration); }).observe({ type: 'longtask', buffered: true });
  });
  p.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  p.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  p.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      const s = String(payload);
      if (s.startsWith('{"t":"welcome"')) seen.welcome = JSON.parse(s);
      else if (s.startsWith('{"t":"lobby"')) seen.lastLobby = Date.now();
    });
    ws.on('close', () => { seen.closed = true; });
  });
  const view = page.viewportSize();
  await page.setViewportSize({ width: 160, height: 90 }); // the host draws less while this tab builds
  await p.goto(page.url());
  await p.fill('#name', name);
  await p.click('#join-form button');
  await p.waitForSelector('#hud:not([hidden])', { timeout: 60000 });
  await page.setViewportSize(view);
  const alive = async () => {
    await p.waitForTimeout(6000);
    const longest = Math.round(await p.evaluate(() => window.longestTask));
    assert.ok(!seen.closed && Date.now() - seen.lastLobby < 2500, `${name} is still connected (longest task ${longest} ms)`);
    console.log(`${name}: connected, longest task ${longest} ms`);
  };
  await alive();
  return { p, welcome: () => seen.welcome, alive };
}

export default async (page) => {
  const problems = [];
  page.on('console', (m) => { if (m.text().startsWith('world: map baked')) console.log(`host ${m.text()}`); }); // the switch's AO bake, at Default
  await waitMap(page, 'arena_01');

  // 1. The scoreboard vote: arena_02 by click, then the automatic restart.
  await endMatch(page);
  await page.click('#sb-maps [data-map=arena_02]');
  await page.waitForSelector('#sb-maps [data-map=arena_02][aria-pressed=true]');
  console.log('voted arena_02, tally:', await page.textContent('#sb-maps [data-map=arena_02] .mc-count'));
  await waitOut(page, 'arena_02');
  console.log('switched to arena_02: client and host');

  // 3. A late joiner, then a rejoin by name, mid-match on arena_02.
  const late = await join(page, 'Late', problems);
  await waitMap(late.p, 'arena_02');
  assert.equal(late.welcome().map, 'arena_02', 'the late joiner is welcomed onto arena_02');
  const id = late.welcome().id;
  await late.p.close();
  await page.waitForTimeout(500);
  const back = await join(page, 'late', problems);
  await waitMap(back.p, 'arena_02');
  assert.deepEqual([back.welcome().id, back.welcome().map], [id, 'arena_02'], 'the rejoin gets its player back, on arena_02');
  console.log('late joiner and rejoin by name on arena_02');

  // 2. End match as host, vote arena_01 with its number key, wait it out.
  await endMatch(page);
  await page.keyboard.press('Digit1');
  await page.waitForSelector('#sb-maps [data-map=arena_01][aria-pressed=true]');
  await waitOut(page, 'arena_01');
  await waitMap(back.p, 'arena_01');
  await back.alive();
  console.log('switched back to arena_01: host, client and the rejoined tab');
  assert.deepEqual(problems, [], 'no console errors on the other tabs');
};
