// Ticket 20, for smoke.mjs (which has joined as host and started on arena_01):
// the scoreboard vote switches to arena_02; a late joiner and a rejoin by name
// land on it mid-match; End match, vote arena_01 by key, the switch back.
// The client's map is the id its collision was built from (the ?debug stats
// line); the host's is the card marked as playing, and each joiner's welcome.
//   BOTS=2 VIEW=640x360 serve.sh pw/smoke.mjs t20 /abs/path/steps20.mjs
import assert from 'node:assert/strict';

const clientMap = (page) => page.evaluate(() => document.getElementById('stats').textContent.split(' · ')[0]);
const waitMap = (page, id) => page.waitForFunction((id) => document.getElementById('stats')?.textContent.startsWith(`${id} ·`), id, { timeout: 30000 });
const hostMap = (page) => page.$eval('#lobby-maps', (el) => [...el.children].find((c) => c.textContent.includes('Now playing'))?.dataset.map);

async function endMatch(page) {
  await page.evaluate(() => document.exitPointerLock());
  await page.click('#end-match', { timeout: 5000 });
  await page.waitForSelector('#scoreboard.over:not([hidden]) #sb-maps [data-map]');
  assert.equal(await page.isVisible('#menu'), false, 'the pause menu waits under the scoreboard');
}

async function waitOut(page, id) {
  await page.waitForSelector('#scoreboard', { state: 'hidden', timeout: 25000 });
  await waitMap(page, id);
  assert.equal(await hostMap(page), id, `host on ${id}`);
  assert.equal(await clientMap(page), id, `client on ${id}`);
}

// A second tab joining as `name`, with its own error listeners and its welcome.
async function join(page, name, problems) {
  const p = await page.context().browser().newPage({ viewport: page.viewportSize() });
  const seen = { welcome: null };
  p.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}: ${m.text()}`); });
  p.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  p.on('websocket', (ws) => ws.on('framereceived', ({ payload }) => {
    if (String(payload).startsWith('{"t":"welcome"')) seen.welcome = JSON.parse(payload);
  }));
  await p.goto(page.url());
  await p.fill('#name', name);
  await p.click('#join-form button');
  await p.waitForSelector('#hud:not([hidden])', { timeout: 20000 });
  return { p, welcome: () => seen.welcome };
}

export default async (page) => {
  const problems = [];
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
  console.log('switched back to arena_01: host, client and the rejoined tab');
  assert.deepEqual(problems, [], 'no console errors on the other tabs');
};
