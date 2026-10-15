// Every listed map is playable data: its spawns and pads stand clear of the
// boxes and on something, inside the arena that client/world.js dresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareMap, overlaps } from './collision.js';
import { MAPS, POWER_PAD_BOX, POWERS, PLAYER_WIDTH, STAND_HEIGHT } from './constants.js';

const load = async (id) => JSON.parse(await readFile(new URL(`./maps/${id}.json`, import.meta.url)));

for (const id of MAPS) {
  test(`${id}: names, spawns and pads`, async () => {
    const json = await load(id);
    const { boxes, spawns, pads } = prepareMap(json);
    assert.ok(json.name && json.tagline, 'a name and a tagline for the vote cards');
    assert.ok(spawns.length >= 12, `${spawns.length} spawns: one per player plus spares`);
    for (const [x, y, z] of spawns) {
      const at = `spawn at ${x}, ${y}, ${z}`;
      assert.ok(Math.abs(x) < 19.4 && Math.abs(z) < 19.4, `${at} is inside the walls`);
      assert.ok(!overlaps({ x, y, z }, PLAYER_WIDTH / 2, STAND_HEIGHT, boxes), `${at} is clear`);
      assert.ok(overlaps({ x, y: y - 0.01, z }, PLAYER_WIDTH / 2, 0.02, boxes), `${at} stands on something`);
    }
    assert.equal(pads.length, 9, 'nine pads, as POWERS is balanced for');
    const [w, h] = POWER_PAD_BOX;
    for (const { pos: [x, y, z], pool, respawn } of pads) {
      const at = `pad at ${x}, ${y}, ${z}`;
      assert.ok(pool.length && pool.every((k) => k in POWERS), `${at}: ${pool}`);
      assert.ok(respawn > 0, `${at}: respawn`);
      assert.ok(!overlaps({ x, y, z }, w / 2, h, boxes), `${at} is clear`);
      assert.ok(overlaps({ x, y: y - 0.01, z }, w / 2, 0.02, boxes), `${at} stands on something`);
    }
    assert.ok(Array.isArray(json.lanes ?? []), 'lanes is a list of x positions');
  });
}
