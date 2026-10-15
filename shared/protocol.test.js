import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeClient, byScore, entityTuple, readEntity, POWERUP_IDS } from './protocol.js';
import { KEY } from './movement.js';

test('malformed or untyped messages decode to null', () => {
  for (const raw of ['', '{', 'null', '42', '[]', '"join"', '{"t":"nope"}', '{"name":"Sam"}']) {
    assert.equal(decodeClient(raw), null, raw);
  }
});

test('join trims the name and accepts 1 to 16 characters', () => {
  assert.deepEqual(decodeClient('{"t":"join","name":"  Sam  "}'), { t: 'join', name: 'Sam', bot: false });
  assert.deepEqual(decodeClient('{"t":"join","name":"bot3","bot":true}'), { t: 'join', name: 'bot3', bot: true });
  assert.equal(decodeClient('{"t":"join","name":"abcdefghijklmnop"}').name, 'abcdefghijklmnop');
  for (const name of ['', '   ', 'abcdefghijklmnopq', 'a\u0007b', 42, null]) {
    assert.equal(decodeClient(JSON.stringify({ t: 'join', name })), null, String(name));
  }
});

const input = { t: 'input', s: 7, rt: 120.5, k: 9, y: 1.25, p: -0.5, f: 1, n: 3, w: 1 };

test('input decodes every field', () => {
  assert.deepEqual(decodeClient(JSON.stringify(input)), { t: 'input', s: 7, rt: 120.5, keys: 9, yaw: 1.25, pitch: -0.5, fire: true, shot: 3, slot: 1 });
});

test('input pitch is clamped to ±89°', () => {
  const limit = (89 * Math.PI) / 180;
  assert.equal(decodeClient(JSON.stringify({ ...input, p: 3 })).pitch, limit);
  assert.equal(decodeClient(JSON.stringify({ ...input, p: -3 })).pitch, -limit);
});

test('input with a non-finite, missing or out-of-range field is dropped', () => {
  for (const bad of [{ s: 1.5 }, { s: -1 }, { s: '7' }, { k: 1 << 16 }, { k: 0.5 }, { n: -2 }, { w: 2 }, { y: undefined }, { rt: 'x' }]) {
    assert.equal(decodeClient(JSON.stringify({ ...input, ...bad })), null, JSON.stringify(bad));
  }
  // 1e999 parses to Infinity, the one way a non-finite number survives JSON
  assert.equal(decodeClient('{"t":"input","s":1,"rt":1,"k":0,"y":1e999,"p":0,"f":0,"n":0,"w":0}'), null);
});

test('loadout accepts only the two primaries', () => {
  assert.deepEqual(decodeClient('{"t":"loadout","primary":"shotgun"}'), { t: 'loadout', primary: 'shotgun' });
  assert.deepEqual(decodeClient('{"t":"loadout","primary":"rifle"}'), { t: 'loadout', primary: 'rifle' });
  for (const primary of ['pistol', 'bazooka', 1, null]) assert.equal(decodeClient(JSON.stringify({ t: 'loadout', primary })), null);
});

test('a vote names a listed map id and nothing else', () => {
  assert.deepEqual(decodeClient('{"t":"vote","map":"arena_02","x":1}'), { t: 'vote', map: 'arena_02' });
  for (const map of ['arena_03', '../maps/arena_01', 'arena_01.json', 'ARENA_01', 'constructor', '__proto__', '', ['arena_01'], { id: 'arena_01' }, 1, null, undefined]) {
    assert.equal(decodeClient(JSON.stringify({ t: 'vote', map })), null, JSON.stringify(map));
  }
});

test('players rank by kills, then by fewer deaths', () => {
  const players = [{ id: 1, kills: 3, deaths: 5 }, { id: 2, kills: 7, deaths: 1 }, { id: 3, kills: 3, deaths: 2 }];
  assert.deepEqual([...players].sort(byScore).map((p) => p.id), [2, 3, 1]);
});

test('power-up use and cycle ride the input keys and still fit the 16-bit check', () => {
  const keys = KEY.FORWARD | KEY.USE | KEY.CYCLE;
  assert.equal(decodeClient(JSON.stringify({ ...input, k: keys })).keys, keys);
  assert.ok(KEY.USE <= 0xffff && KEY.CYCLE <= 0xffff && KEY.USE !== KEY.CYCLE);
  for (const bit of Object.values(KEY)) assert.ok(bit === KEY.USE || bit === KEY.CYCLE || !(bit & (KEY.USE | KEY.CYCLE)));
});

test('a power-up entity survives the snapshot tuple, rounded to the centimetre', () => {
  const mine = { id: 4, kind: 'mine', owner: 7, x: 1.23456, y: 0.004, z: -9.8765, vx: 0, vy: -0.26, vz: 0, armed: true };
  assert.deepEqual(readEntity(entityTuple(mine)), { id: 4, kind: 'mine', owner: 7, x: 1.23, y: 0, z: -9.88, vx: 0, vy: -0.3, vz: 0, armed: true });
  const shunt = readEntity(JSON.parse(JSON.stringify(entityTuple({ id: 9, kind: 'shunt', owner: 2, x: 0, y: 1.6, z: 0, vx: 16, vy: 0, vz: 0 }))));
  assert.deepEqual([shunt.kind, shunt.armed, shunt.vx], ['shunt', false, 16]);
  assert.deepEqual(POWERUP_IDS.map((k) => readEntity(entityTuple({ id: 1, kind: k, owner: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })).kind), POWERUP_IDS);
});

test('start and end_match carry no payload', () => {
  assert.deepEqual(decodeClient('{"t":"start","extra":1}'), { t: 'start' });
  assert.deepEqual(decodeClient('{"t":"end_match","why":"x"}'), { t: 'end_match' });
});
