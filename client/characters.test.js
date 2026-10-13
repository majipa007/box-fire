// The posed rig against the server's own hitboxes (bible §3.1): the helmet
// tops out where the hitbox does, standing and crouched; the body stays
// within 4 cm of the hitbox; boots stand on the ground; hands hold their
// grips at any aim. Plus the hit flash, name tags, the shadow fallback and
// the draw budget. Runs characters.js under Node with 'three' mapped to the
// vendored build, as the page's import map does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { hitboxes } from '../shared/weapons.js';
import { MAX_PLAYERS } from '../shared/constants.js';

const threeUrl = new URL('./vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'three' ? { url: threeUrl, shortCircuit: true } : next(spec, ctx)) });
const THREE = await import('three');
const C = await import('./characters.js');
const { syncPlayers, shatter, hitFlash, fireKick, muzzleOf, fired, nameTags, initCharacters, setShadows, charactersGroup, PARTS, GUNS } = C;

const floor = [{ min: [-20, -1, -20], max: [20, 0, 20] }];
initCharacters({ boxes: floor });
const meshes = charactersGroup.children;
const bodyMesh = meshes.find((o) => o.isInstancedMesh && o.material.isMeshLambertMaterial);
const isGun = (name) => PARTS.some((p) => p.weapon && p.name === name);
const holdsGun = (name) => isGun(name) || /Arm|hand/.test(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;

// Draw one player for some frames (long enough for the spawn assembly); returns its id and roster.
function show(state, frames = 1, boxes) {
  const id = nextId++;
  const p = { id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, shielded: false, hp: 100, weapon: 'rifle', ...state };
  const roster = new Map([[id, { name: `p${id}`, slot: id % 10 }]]);
  for (let i = 0; i < frames; i++) syncPlayers([p], roster, 1 / 60, ...(boxes ? [boxes] : []));
  return { id, p, roster };
}

// World bounds of some shatter boxes.
function bounds(cubes) {
  const box = new THREE.Box3();
  for (const c of cubes) {
    for (let corner = 0; corner < 8; corner++) {
      const v = new THREE.Vector3(corner & 1 ? 0.5 : -0.5, corner & 2 ? 0.5 : -0.5, corner & 4 ? 0.5 : -0.5);
      box.expandByPoint(v.multiply(c.scale).applyQuaternion(c.quaternion).add(c.position));
    }
  }
  return box;
}

test('26 lit parts, an unlit visor, 16 outlined; slot colour only on torso, helmet, knee pads, armbands and visor', () => {
  for (const weapon of Object.keys(GUNS)) {
    const mine = PARTS.filter((p) => !p.weapon || p.weapon === weapon);
    assert.equal(mine.filter((p) => !p.unlit).length, 26, weapon);
    assert.equal(mine.filter((p) => p.outline).length, 16, weapon);
    assert.deepEqual(mine.filter((p) => p.unlit).map((p) => p.name), ['visor']);
  }
  const slot = PARTS.filter((p) => p.paint === 'slot').map((p) => p.name.replace(/[LR]$/, ''));
  assert.deepEqual([...new Set(slot)].sort(), ['armband', 'helmet', 'kneePad', 'torso']);
  // Shoulder span, arms included, within the 0.6 m hitbox width.
  const arm = PARTS.find((p) => p.name === 'upperArmL');
  assert.ok(0.25 + arm.size[0] / 2 <= 0.3);
});

test('the helmet tops out on the hitbox, standing and crouched, and the head nods on its box', () => {
  for (const crouch of [false, true]) {
    const at = { x: 3, y: 0, z: -2, crouch };
    const cubes = shatter(show(at, 20).id, Infinity);
    const { head } = hitboxes(at);
    const top = bounds(cubes.filter((c) => !isGun(c.part))).max.y;
    assert.ok(Math.abs(top - head.max[1]) < 0.005, `crouch ${crouch}: top ${top}, hitbox ${head.max[1]}`);
    for (const pitch of [-1.2, -0.6, 0, 0.6, 1.2]) {
      for (const c of shatter(show({ ...at, pitch }, 20).id, Infinity).filter((c) => ['head', 'helmet'].includes(c.part))) {
        const off = Math.hypot(c.position.x - (head.min[0] + head.max[0]) / 2, c.position.z - (head.min[2] + head.max[2]) / 2);
        assert.ok(off < 0.07 + (crouch ? 0.03 : 0), `crouch ${crouch} pitch ${pitch}: ${c.part} ${off.toFixed(3)} m off the head box centre`);
      }
    }
  }
});

// Each part's world bounds against the hitbox it sits in (head box above the
// head box's floor, body box below), aiming level. The arms and gun reach
// forward to aim, as in any shooter, and are exempt (up to 33 cm out). The
// bible's 0.30 m helmet turned 45° spans 0.42 m, so it overhangs the 0.30 m
// head box by 6.2 cm there. Crouched, the pack's lower edge overhangs the
// back by up to 10.1 cm (see LOOK.leanCrouch).
test('the body stays within 4 cm of the hitbox at yaw 0° and 45°, aiming level', () => {
  for (const crouch of [false, true]) {
    for (const yaw of [0, Math.PI / 4]) {
      for (const weapon of Object.keys(GUNS)) {
        const at = { x: -2, y: 0, z: 4, yaw, crouch, weapon };
        const { head, body } = hitboxes(at);
        for (const c of shatter(show(at, 20).id, Infinity)) {
          if (holdsGun(c.part)) continue;
          const b = bounds([c]);
          const box = b.max.y > head.min[1] + 0.001 ? head : body;
          const over = Math.max(box.min[0] - b.min.x, b.max.x - box.max[0], box.min[2] - b.min.z, b.max.z - box.max[2], b.max.y - head.max[1]);
          const allowed = c.part === 'pack' && crouch ? 0.105 : yaw && c.part === 'helmet' ? 0.065 : 0.04;
          assert.ok(over <= allowed, `${weapon} crouch ${crouch} yaw ${yaw.toFixed(2)}: ${c.part} ${over.toFixed(3)} m outside`);
        }
      }
    }
  }
});

test('boots stand on the ground and nothing sinks into it', () => {
  for (const crouch of [false, true]) {
    const cubes = shatter(show({ crouch }, 20).id, Infinity);
    const soles = bounds(cubes.filter((c) => c.part.startsWith('boot'))).min.y;
    assert.ok(crouch || Math.abs(soles) < 0.01, `soles at ${soles}`);
    assert.ok(bounds(cubes).min.y > -0.025, `crouch ${crouch}: something below the ground`); // the kneeling knee rests on it
  }
});

test('a player on the edge of a crate stands on it; one above it bends hip and knee forward', () => {
  const crate = [...floor, { min: [1, -1, -1], max: [2, 1, 1] }];
  const thigh = {};
  for (const [y, airborne] of [[1, false], [1.5, true]]) {
    const { id } = show({ x: 0.85, y }, 20, crate);
    const cubes = shatter(id, Infinity);
    const soles = bounds(cubes.filter((c) => c.part.startsWith('boot'))).min.y;
    assert.ok(airborne || Math.abs(soles - y) < 0.01, `y ${y}: soles at ${soles}`);
    thigh[airborne] = cubes.find((c) => c.part === 'thighL').position.z - cubes.find((c) => c.part === 'belt').position.z;
  }
  assert.ok(thigh.true < thigh.false - 0.03, `thighs ${thigh.false.toFixed(3)} grounded, ${thigh.true.toFixed(3)} airborne (−z is forward)`);
});

test('running swings the legs; strafing swings them sideways', async () => {
  const boot = PARTS.filter((p) => !p.unlit && (!p.weapon || p.weapon === 'rifle')).findIndex((p) => p.name === 'bootL');
  for (const [vx, vz, axis] of [[0, -5.5, 2], [5.5, 0, 0]]) {
    const { p, roster } = show({}, 1);
    await sleep(260); // assembled
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 60; i++) {
      p.x += vx / 60;
      p.z += vz / 60;
      syncPlayers([p], roster, 1 / 60);
      const at = bodyMesh.instanceMatrix.array[boot * 16 + 12 + axis] - [p.x, 0, p.z][axis];
      min = Math.min(min, at);
      max = Math.max(max, at);
    }
    assert.ok(max - min > 0.3, `axis ${axis}: boot swing ${(max - min).toFixed(2)} m`);
  }
});

test('hands hold their grips for every weapon at any aim, kicked or not', () => {
  for (const weapon of Object.keys(GUNS)) {
    const first = PARTS.find((p) => p.weapon === weapon);
    for (const crouch of [false, true]) {
      for (const pitch of [-1.2, -0.6, 0, 0.6, 1.2]) {
        for (const kicked of [false, true]) {
          const { id, p, roster } = show({ weapon, crouch, pitch }, 20);
          if (kicked) {
            fired(id);
            syncPlayers([p], roster, 1 / 60);
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
  const { id } = show({ x: 1, z: 1 }, 20);
  const at = muzzleOf(id);
  assert.ok(at[2] < 1 - 0.4 && at[1] > 1 && at[1] < 1.6, `muzzle at ${at}`); // ahead (-z) at chest height
  const muzzle = new THREE.Vector3();
  assert.equal(fireKick(id, muzzle), true);
  assert.deepEqual(muzzle.toArray(), at);
  assert.equal(muzzleOf(nextId + 100), null);
  assert.equal(fireKick(nextId + 100, muzzle), false);
});

test('a death shatters into a bounded number of voxels and hides the player', () => {
  const { id, p, roster } = show({ x: 2, z: 5 }, 20);
  const cubes = shatter(id);
  assert.ok(cubes.length >= 40 && cubes.length <= 160, `${cubes.length} voxels`);
  for (const c of cubes) {
    assert.ok([c.position.x, c.position.y, c.position.z].every(Number.isFinite));
    assert.ok(c.scale.x > 0 && c.scale.y > 0 && c.scale.z > 0 && c.color.isColor && c.velocity.isVector3);
  }
  syncPlayers([p], roster, 1 / 60);
  assert.equal(bodyMesh.visible, false, 'the shattered player is still drawn');
  assert.deepEqual(shatter(id), [], 'a hidden player shatters twice');
});

test('a spawn assembles the body over 250 ms', async () => {
  const { p, roster } = show({}, 1);
  const size = () => new THREE.Vector3().setFromMatrixScale(new THREE.Matrix4().fromArray(bodyMesh.instanceMatrix.array, 16)).length();
  const early = size();
  await sleep(300);
  syncPlayers([p], roster, 1 / 60);
  assert.ok(early < 0.5 * size(), `${early} vs ${size()}`);
});

test('a drop in hp flashes the player toward white, and it fades within 150 ms', async () => {
  const { p, roster } = show({}, 1);
  await sleep(260); // assembled
  syncPlayers([p], roster, 1 / 60);
  const paint = bodyMesh.instanceColor.array.slice(0, 3);
  p.hp = 70;
  syncPlayers([p], roster, 1 / 60);
  const lit = bodyMesh.instanceColor.array.slice(0, 3);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(lit[i] - (paint[i] + 0.7 * (1 - paint[i]))) < 0.01, `channel ${i}: ${paint[i]} → ${lit[i]}`);
  await sleep(170);
  syncPlayers([p], roster, 1 / 60);
  assert.deepEqual(bodyMesh.instanceColor.array.slice(0, 3), paint, 'the flash never ends');
  hitFlash(p.id); // the hit event flashes too
  syncPlayers([p], roster, 1 / 60);
  assert.ok(bodyMesh.instanceColor.array[0] > paint[0] + 0.5);
});

test('name tags: near or under the crosshair, and only with a clear line to the head', () => {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  camera.updateMatrixWorld();
  const wall = { min: [-1, 0, -30.5], max: [1, 4, -29.5] };
  initCharacters({ boxes: [...floor, wall] });
  const near = show({ x: 0, z: -6 }, 1);
  const far = show({ x: 6, z: -25 }, 1); // 26 m, 14° off the crosshair
  const aimed = show({ x: 0.5, z: -25 }, 1); // 25 m, 1° off
  const hidden = show({ x: 0, z: -35 }, 1); // behind the wall
  syncPlayers([near.p, far.p, aimed.p, hidden.p], new Map([...near.roster, ...far.roster, ...aimed.roster, ...hidden.roster]), 1 / 60, camera);
  nameTags(camera, 1920, 1080);
  const tags = nameTags(camera, 1920, 1080);
  const ids = tags.map((t) => t.id);
  assert.ok(ids.includes(near.id) && ids.includes(aimed.id), JSON.stringify(tags));
  assert.ok(!ids.includes(far.id) && !ids.includes(hidden.id), JSON.stringify(tags));
  const tag = tags.find((t) => t.id === near.id);
  assert.ok(Math.abs(tag.x - 960) < 2 && tag.y < 540 && tag.alpha > 0 && tag.color.startsWith('#') && tag.name === `p${near.id}`);
  initCharacters({ boxes: floor });
});

test('shadows off: a player in a wall\'s lee is dimmed by the sun rays, eased', async () => {
  const sunDir = [-0.683, 0.643, 0.348];
  const wall = { min: [-2, 0, -5], max: [-1, 4, 5] };
  initCharacters({ boxes: [...floor, wall], sunDir });
  setShadows(false);
  const { p, roster } = show({ x: 0, z: 0, slot: 0 }, 1);
  await sleep(1000); // assembled, and the shade eased in
  syncPlayers([p], roster, 1 / 60);
  const shaded = bodyMesh.instanceColor.array[3]; // the torso, slot-coloured
  setShadows(true);
  syncPlayers([p], roster, 1 / 60);
  const lit = bodyMesh.instanceColor.array[3];
  assert.ok(Math.abs(shaded / lit - 0.62) < 0.02, `${shaded} / ${lit}`);
  assert.equal(bodyMesh.receiveShadow, true);
  initCharacters({ boxes: floor });
});

// (All three effects on all 10 at once, 10.6k, cannot happen: there is one Shield pad and a Shield lasts 8 s.)
test('ten players, each with a Shield and Nitro or slowed: 6 draws and at most 10k triangles', () => {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  camera.position.set(0, 1.6, 12);
  camera.updateMatrixWorld();
  const list = [];
  const roster = new Map();
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const id = nextId++;
    list.push({ id, x: i - 5, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, shielded: true, hp: 100, weapon: 'shotgun', bubble: true, nitro: i % 2 === 0, slowed: i % 2 === 1 });
    roster.set(id, { name: `n${i}`, slot: i });
  }
  for (let f = 0; f < 30; f++) {
    for (const p of list) p.x += 5 / 60;
    syncPlayers(list, roster, 1 / 60, camera);
  }
  assert.equal(meshes.length, 6);
  let triangles = 0;
  for (const m of meshes) {
    if (!m.visible) continue;
    const tris = (m.geometry.index ? (m.isInstancedMesh ? m.geometry.index.count : Math.min(m.geometry.drawRange.count, m.geometry.index.count)) : m.geometry.attributes.position.count) / 3;
    triangles += tris * (m.isInstancedMesh ? m.count : 1);
    assert.equal(m.castShadow, false);
    assert.equal(m.frustumCulled, false);
  }
  assert.ok(meshes.every((m) => m.visible), 'every effect drawn');
  assert.ok(triangles <= 10000, `${triangles} triangles`);
});
