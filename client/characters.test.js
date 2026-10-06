// The posed rig against the server's own hitboxes: the head tops out where
// the head box does, standing and crouched; boots stand on the ground; hands
// hold their grips at any aim. Runs characters.js under Node with 'three'
// mapped to the vendored build, as the page's import map does, and a stub
// canvas for the name tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { hitboxes } from '../shared/weapons.js';

const threeUrl = new URL('./vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'three' ? { url: threeUrl, shortCircuit: true } : next(spec, ctx)) });
globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 100 }), strokeText() {}, fillText() {} }) }) };
const THREE = await import('three');
const { syncPlayers, shatter, hitFlash, fireKick, charactersGroup, PARTS, GUNS } = await import('./characters.js');

const floor = [{ min: [-20, -1, -20], max: [20, 0, 20] }];
const bodyMesh = charactersGroup.children.find((o) => o.isInstancedMesh && o.material.isMeshLambertMaterial);
const isGun = (name) => PARTS.some((p) => p.weapon && p.name === name);
let nextId = 1;

// Draw one player for a frame or two; returns its id and roster.
function show(state, frames = 1) {
  const id = nextId++;
  const p = { id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, shielded: false, weapon: 'rifle', ...state };
  const roster = new Map([[id, { name: `p${id}`, slot: id % 10 }]]);
  for (let i = 0; i < frames; i++) syncPlayers([p], roster, 1 / 60, floor);
  return { id, p, roster };
}

// World bounds of some shatter boxes.
function bounds(cubes) {
  const box = new THREE.Box3();
  for (const c of cubes) {
    for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const v = new THREE.Vector3(corner & 1 ? 0.5 : -0.5, corner & 2 ? 0.5 : -0.5, corner & 4 ? 0.5 : -0.5);
      box.expandByPoint(v.multiply(c.scale).applyQuaternion(c.quaternion).add(c.position));
    }
  }
  return box;
}

test('the head tops out on the head hitbox, standing and crouched', () => {
  for (const crouch of [false, true]) {
    const at = { x: 3, y: 0, z: -2, crouch };
    const cubes = shatter(show(at).id, Infinity);
    const { head } = hitboxes(at);
    const top = bounds(cubes.filter((c) => !isGun(c.part))).max.y;
    assert.ok(Math.abs(top - head.max[1]) < 0.005, `crouch ${crouch}: top ${top}, hitbox ${head.max[1]}`);
    const drawnHead = bounds(cubes.filter((c) => ['head', 'helmet', 'visor'].includes(c.part)));
    ['x', 'y', 'z'].forEach((a, i) => {
      assert.ok(drawnHead.min[a] > head.min[i] - 0.02 && drawnHead.max[a] < head.max[i] + 0.02, `crouch ${crouch}: head ${a} outside its hitbox`);
    });
  }
});

test('boots stand on the ground and nothing sinks into it', () => {
  for (const crouch of [false, true]) {
    const cubes = shatter(show({ crouch }).id, Infinity);
    const soles = bounds(cubes.filter((c) => c.part.startsWith('boot'))).min.y;
    assert.ok(Math.abs(soles) < 0.01, `crouch ${crouch}: soles at ${soles}`);
    assert.ok(bounds(cubes).min.y > -0.01, `crouch ${crouch}: something below the ground`);
  }
});

test('hands hold their grips for every weapon at any aim, kicked or not', () => {
  for (const weapon of Object.keys(GUNS)) {
    const first = PARTS.find((p) => p.weapon === weapon);
    for (const crouch of [false, true]) {
      for (const pitch of [-1.2, -0.6, 0, 0.6, 1.2]) {
        for (const kicked of [false, true]) {
          const { id, p, roster } = show({ weapon, crouch, pitch });
          if (kicked) {
            fireKick(id);
            syncPlayers([p], roster, 1 / 60, floor);
          }
          const cubes = shatter(id, Infinity);
          // The gun bone, recovered from its first part.
          const g = cubes.find((c) => c.part === first.name);
          const origin = new THREE.Vector3(...first.at).applyQuaternion(g.quaternion).negate().add(g.position);
          for (const [hand, grip] of [['handL', GUNS[weapon].left], ['handR', GUNS[weapon].right]]) {
            const want = new THREE.Vector3(...grip).applyQuaternion(g.quaternion).add(origin);
            const gap = cubes.find((c) => c.part === hand).position.distanceTo(want);
            assert.ok(gap < 0.01, `${weapon} crouch ${crouch} pitch ${pitch} kicked ${kicked}: ${hand} ${gap.toFixed(3)} m off its grip`);
          }
        }
      }
    }
  }
});

test('the muzzle is at the front of the drawn gun', () => {
  const { id } = show({ x: 1, z: 1 });
  const muzzle = new THREE.Vector3();
  assert.equal(fireKick(id, muzzle), true);
  assert.ok(muzzle.z < 0.4 && muzzle.y > 1 && muzzle.y < 1.6, `muzzle at ${muzzle.toArray()}`); // ahead (-z) at chest height
  assert.equal(fireKick(nextId + 100, muzzle), false);
});

test('a death shatters into a bounded number of voxels and hides the player', () => {
  const { id, p, roster } = show({ x: 2, z: 5 });
  const cubes = shatter(id);
  assert.ok(cubes.length >= 40 && cubes.length <= 160, `${cubes.length} voxels`);
  for (const c of cubes) {
    assert.ok([c.position.x, c.position.y, c.position.z].every(Number.isFinite));
    assert.ok(c.scale.x > 0 && c.scale.y > 0 && c.scale.z > 0 && c.color.isColor && c.velocity.isVector3);
  }
  syncPlayers([p], roster, 1 / 60, floor);
  assert.equal(bodyMesh.visible, false, 'the shattered player is still drawn');
  assert.deepEqual(shatter(id), [], 'a hidden player shatters twice');
});

test('a hit flashes the player for a moment', async () => {
  const { id, p, roster } = show({});
  const paint = bodyMesh.instanceColor.array[0];
  hitFlash(id);
  syncPlayers([p], roster, 1 / 60, floor);
  assert.ok(bodyMesh.instanceColor.array[0] > 1, 'no flash');
  await new Promise((r) => setTimeout(r, 80));
  syncPlayers([p], roster, 1 / 60, floor);
  assert.equal(bodyMesh.instanceColor.array[0], paint, 'the flash never ends');
});
