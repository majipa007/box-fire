// The viewmodel in Node: its springs and model data, and frames stepped
// against a stand-in camera, scene and our own player's state.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

// The browser finds 'three' through index.html's import map; a resolve hook
// does the same here, and module.registerHooks needs Node 22.15 or later.
if (nodeModule.registerHooks) await suite();
else test('viewmodel', { skip: 'needs module.registerHooks, Node 22.15 or later' }, () => {});

async function suite() {
  const vendor = new URL('./vendor/', import.meta.url).href;
  nodeModule.registerHooks({
    resolve: (spec, ctx, next) => next(spec === 'three' ? `${vendor}three.module.js` : spec.startsWith('three/') ? vendor + spec.slice(6) : spec, ctx),
  });
  const THREE = await import('three');
  const vm = await import('./viewmodel.js');
  const { self } = await import('./net.js');
  const { freshLife } = await import('../shared/weapons.js');
  const { WEAPONS, SWITCH_SECONDS } = await import('../shared/constants.js');

  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  camera.rotation.order = 'YXZ';
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  sun.position.set(0, 30, 0);
  scene.add(new THREE.HemisphereLight('#dfe8f2', '#5a5f6a', 2.4), sun);
  scene.updateMatrixWorld();
  const gun = vm.viewScene.getObjectByName('viewmodel');
  const rig = (name) => vm.viewScene.getObjectByName(name);
  let now = 0;
  function frames(n, each) {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      vm.updateViewmodel(now, camera, scene);
      each?.();
    }
  }
  // A fresh life, settled.
  function spawn(primary) {
    Object.assign(self, freshLife(0, 0, 0, primary));
    camera.rotation.set(0, 0, 0);
    vm.setGun(primary, false);
    frames(1);
    vm.setGun(primary, true);
    frames(90);
  }

  test('the spring gives the same answer at any frame rate and never overshoots', () => {
    const a = vm.spring(1);
    const b = vm.spring(1);
    for (let i = 0; i < 30; i++) vm.springStep(a, [1], 0.1, 1 / 30);
    for (let i = 0; i < 144; i++) vm.springStep(b, [1], 0.1, 1 / 144);
    assert.ok(Math.abs(a.x[0] - b.x[0]) < 1e-9, `${a.x[0]} vs ${b.x[0]}`);
    const c = vm.spring(1);
    let max = 0;
    for (let i = 0; i < 600; i++) {
      vm.springStep(c, [1], 0.05, 1 / 120);
      max = Math.max(max, c.x[0]);
    }
    assert.ok(max <= 1 && c.x[0] > 0.999);
  });

  test('an impulse peaks at the height asked for, then returns to rest', () => {
    const s = vm.spring(1);
    s.v[0] = vm.impulse(0.04, 0.05);
    let max = 0;
    for (let i = 0; i < 1000; i++) {
      vm.springStep(s, null, 0.05, 0.0005);
      max = Math.max(max, s.x[0]);
    }
    assert.ok(Math.abs(max - 0.04) < 1e-5, `${max}`);
    assert.ok(Math.abs(s.x[0]) < 1e-4);
  });

  test('tracks hit their keys, ease between them and hold past the ends', () => {
    const out = new Float64Array(6);
    const track = [[0.2, 1], [0.6, 3, 0, 0, 0.5]];
    assert.equal(vm.sampleTrack(track, 0, out)[0], 1);
    assert.equal(vm.sampleTrack(track, 0.4, out)[0], 2);
    assert.ok(vm.sampleTrack(track, 0.3, out)[0] < 1.5); // eased, not linear
    assert.deepEqual([...vm.sampleTrack(track, 1, out)], [3, 0, 0, 0.5, 0, 0]);
    assert.deepEqual([...vm.sampleTrack(undefined, 0.5, out)], [0, 0, 0, 0, 0, 0]);
  });

  test('every weapon is 15 to 25 boxes: a gun, a moving part and two arms', () => {
    assert.deepEqual(Object.keys(vm.MODELS).sort(), Object.keys(WEAPONS).sort());
    assert.deepEqual(Object.keys(vm.GUN_SHAPES).sort(), Object.keys(WEAPONS).sort()); // other players' guns
    for (const [name, m] of Object.entries(vm.MODELS)) {
      assert.ok(m.boxes.length >= 15 && m.boxes.length <= 25, `${name}: ${m.boxes.length} boxes`);
      for (const part of ['body', 'part', 'left']) assert.ok(m.boxes.some((b) => b.part === part), `${name} has no ${part}`);
      assert.ok(m.boxes.every((b) => b.color in vm.VM_COLORS), `${name} names an unknown colour`);
      assert.equal(m.rest.length, 6);
      // Three merged meshes, every box's 24 vertices in them.
      const meshes = rig(name).children;
      assert.equal(meshes.length, 3);
      assert.equal(meshes.reduce((n, mesh) => n + mesh.geometry.attributes.position.count, 0), m.boxes.length * 24);
    }
  });

  test('magazine reloads start and end at rest, so they never pop', () => {
    const out = new Float64Array(6);
    for (const name of ['rifle', 'pistol']) {
      for (const track of Object.values(vm.MODELS[name].reload)) {
        assert.ok(vm.sampleTrack(track, 0, out).every((v) => v === 0), name);
        assert.ok(vm.sampleTrack(track, 1, out).every((v) => v === 0), name);
      }
    }
  });

  test('a shot kicks the gun back and up, flashes, pulses one frame and settles', () => {
    spawn('rifle');
    const z = gun.position.z;
    const pitch = gun.rotation.x;
    const flash = rig('flash');
    const { emissive } = rig('rifle').getObjectByName('body').material;
    vm.gunKick();
    frames(1);
    assert.ok(flash.visible, 'flash shows');
    assert.ok(emissive.r > 0, 'emissive pulses');
    frames(1);
    assert.equal(emissive.r, 0, 'for one frame only');
    assert.ok(gun.position.z > z + 0.01 && gun.rotation.x > pitch + 0.02, 'kicked back and up');
    frames(2);
    assert.ok(!flash.visible, 'flash gone');
    frames(60);
    assert.ok(Math.abs(gun.position.z - z) < 1e-3, 'settled');
  });

  test('the reload timer drops the magazine and seats it again', () => {
    spawn('rifle');
    const mag = rig('rifle').getObjectByName('part');
    const seated = mag.position.clone();
    self.arsenal.reload = WEAPONS.rifle.reload * 0.6;
    frames(30);
    assert.ok(mag.position.y < seated.y - 0.2, 'dropped');
    self.arsenal.reload = 0;
    frames(60);
    assert.ok(mag.position.distanceTo(seated) < 1e-3, 'seated');
  });

  test('the shotgun pumps after a shot', () => {
    spawn('shotgun');
    const pump = rig('shotgun').getObjectByName('part');
    const forward = pump.position.z;
    self.arsenal.cooldown = 0.6 / WEAPONS.shotgun.rps; // 40% through the cycle
    frames(20);
    assert.ok(pump.position.z > forward + 0.05, 'racked back');
    self.arsenal.cooldown = 0;
    frames(60);
    assert.ok(Math.abs(pump.position.z - forward) < 1e-3, 'forward again');
  });

  test('a switch lowers the old gun, swaps at the bottom and raises the new one', () => {
    spawn('rifle');
    const up = gun.position.y;
    self.arsenal.slot = 1;
    self.arsenal.switching = SWITCH_SECONDS;
    vm.setGun('pistol', true);
    frames(1);
    assert.ok(rig('rifle').visible && !rig('pistol').visible, 'still the rifle');
    self.arsenal.switching = SWITCH_SECONDS * 0.55;
    frames(15);
    assert.ok(rig('rifle').visible && gun.position.y < up - 0.15, 'rifle lowered');
    self.arsenal.switching = SWITCH_SECONDS * 0.45;
    frames(1);
    assert.ok(rig('pistol').visible && !rig('rifle').visible, 'swapped');
    self.arsenal.switching = 0;
    frames(60);
    assert.ok(Math.abs(gun.position.y - vm.MODELS.pistol.rest[1]) < 0.01, 'pistol raised');
  });

  test('turning makes the gun trail the view, then settle', () => {
    spawn('rifle');
    const yaw = gun.rotation.y;
    for (let i = 0; i < 10; i++) {
      camera.rotation.y -= 0.02; // turning right
      frames(1);
    }
    assert.ok(gun.rotation.y > yaw + 0.01, 'barrel trails to the left');
    frames(60);
    assert.ok(Math.abs(gun.rotation.y - yaw) < 1e-3);
  });

  test('strafing banks and bobs the gun; a hard landing dips it', () => {
    spawn('rifle');
    self.mover.vx = 5.5; // strafing right at run speed
    const ys = [];
    frames(120, () => ys.push(gun.position.y));
    assert.ok(Math.max(...ys.slice(60)) - Math.min(...ys.slice(60)) > 0.004, 'bobs');
    assert.ok(gun.rotation.z < -0.03, 'banks right');
    self.mover.vx = 0;
    frames(90);
    const y = gun.position.y;
    Object.assign(self.mover, { grounded: false, vy: -6 });
    frames(1);
    Object.assign(self.mover, { grounded: true, vy: 0 });
    let low = Infinity;
    frames(20, () => { low = Math.min(low, gun.position.y); });
    assert.ok(low < y - 0.015, `dips (${low} vs ${y})`);
    frames(60);
    assert.ok(Math.abs(gun.position.y - y) < 0.006, 'recovers');
  });

  test('the world lights are mirrored, and the sun dims in its shadow', () => {
    spawn('rifle');
    const copy = vm.viewScene.children.find((o) => o.isDirectionalLight);
    assert.ok(copy && vm.viewScene.children.some((o) => o.isHemisphereLight));
    assert.equal(copy.intensity, sun.intensity);
    assert.ok(copy.color.equals(sun.color));
    assert.ok(copy.position.clone().normalize().distanceTo(sun.position.clone().normalize()) < 1e-9);
    vm.setSunShade(1);
    frames(60);
    assert.ok(copy.intensity < 0.05 * sun.intensity);
    vm.setSunShade(0);
    frames(60);
    assert.ok(copy.intensity > 0.95 * sun.intensity);
    const roof = { min: [-1, 3, -1], max: [1, 4, 1] };
    assert.equal(vm.sunBlocked([0, 1.6, 0], [roof]), true);
    assert.equal(vm.sunBlocked([3, 1.6, 0], [roof]), false);
  });

  test('muzzleWorld lands on the pixel where the muzzle is drawn', () => {
    spawn('rifle');
    camera.position.set(3, 1.6, 4);
    camera.rotation.set(-0.2, 0.7, 0);
    frames(1);
    camera.updateMatrixWorld();
    vm.viewScene.updateMatrixWorld();
    const drawn = rig('flash').getWorldPosition(new THREE.Vector3()).project(vm.viewCamera);
    const world = vm.muzzleWorld(camera).project(camera);
    assert.ok(Math.abs(drawn.x - world.x) < 1e-6 && Math.abs(drawn.y - world.y) < 1e-6);
  });
}
