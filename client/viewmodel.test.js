// The viewmodel in Node: its springs and model data, and frames stepped
// against a stand-in camera, scene and our own player's state, checked
// against the bible's numbers (§3.2).
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
  const DEG = Math.PI / 180;

  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  camera.rotation.order = 'YXZ';
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight('#ffd3a1', 3.3);
  sun.position.set(-41, 38.6, 20.9);
  const sky = new THREE.HemisphereLight('#a6c1ee', '#d2b78e', 1.8);
  scene.add(sky, sun);
  scene.updateMatrixWorld();
  const gun = vm.viewScene.getObjectByName('viewmodel');
  const rig = (name) => vm.viewScene.getObjectByName(name);
  const bone = (weapon, i) => rig(weapon).skeleton.bones[i]; // 0 body, 1 part, 2 left, 3 slide, 4 shell
  const viewLight = (type) => vm.viewScene.children.find((o) => o[type]);
  let now = 0;
  function frames(n, each) {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      vm.updateViewmodel(now, camera, scene);
      each?.(i);
    }
  }
  // A fresh life, settled.
  function spawn(primary) {
    Object.assign(self, freshLife(0, 0, 0, primary));
    camera.rotation.set(0, 0, 0);
    vm.setSunShade(0);
    vm.setGun(primary, false);
    frames(1);
    vm.setGun(primary, true);
    frames(90);
  }
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

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

  test('each weapon is one skinned mesh in the bible palette, resting where §3.2 puts it', () => {
    assert.deepEqual(Object.keys(vm.MODELS).sort(), Object.keys(WEAPONS).sort());
    assert.deepEqual(Object.keys(vm.GUN_SHAPES).sort(), Object.keys(WEAPONS).sort()); // other players' guns
    const rests = { rifle: [0.2, -0.19, -0.6], pistol: [0.17, -0.17, -0.5], shotgun: [0.2, -0.2, -0.58] };
    for (const [name, m] of Object.entries(vm.MODELS)) {
      assert.deepEqual(m.rest.slice(0, 3), rests[name]);
      assert.ok(m.boxes.every((b) => b.color in vm.LOOK.colors), `${name} names an unknown colour`);
      const mesh = rig(name);
      assert.ok(mesh.isSkinnedMesh && mesh.children.length === 1, name); // the root bone only: one draw
      assert.equal(mesh.geometry.attributes.position.count, m.boxes.length * 24);
      // The arms: 1.15 × third person, the armband in the slot colour.
      for (const side of ['body', 'left']) {
        const arm = m.boxes.filter((b) => b.part === side && b.from);
        assert.deepEqual(arm.find((b) => b.color === 'slot')?.size, [0.12, 0.12], `${name} ${side} armband`);
        assert.deepEqual(arm.find((b) => b.color === 'kit')?.size, [0.115, 0.115], `${name} ${side} forearm`);
      }
    }
    assert.deepEqual(vm.LOOK.colors.metal + vm.LOOK.colors.tan + vm.LOOK.colors.dark, '#2e3136#b9a27a#1b1d22');
  });

  test('at peak, with the flash up and casings flying, the view pass is ≤ 4 draws and ≤ 1.5k triangles', () => {
    for (const w of ['rifle', 'pistol', 'shotgun']) {
      spawn(w);
      vm.gunKick();
      frames(28); // the shotgun's shell is out at the pump
      vm.gunKick();
      frames(1);
      let draws = 0;
      let tris = 0;
      vm.viewScene.traverseVisible((o) => {
        if (!o.isMesh) return;
        draws++;
        tris += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.instanceMatrix.count : 1); // every casing live
      });
      assert.ok(rig('flash').visible && rig('casings').visible, w);
      assert.ok(draws <= 4 && tris <= 1500, `${w}: ${draws} draws, ${tris} triangles`);
      frames(60);
    }
  });

  test('a rifle shot kicks 35 mm back and 2.5° up, flashes two frames, glows and settles', () => {
    spawn('rifle');
    const z = gun.position.z;
    const pitch = gun.rotation.x;
    const flash = rig('flash');
    const hemi = viewLight('isHemisphereLight');
    const base = hemi.intensity;
    vm.gunKick();
    let back = 0;
    let up = 0;
    const shown = [];
    frames(1);
    assert.ok(hemi.intensity > base * 1.29, 'the sky light rises 30%');
    for (let i = 0; i < 20; i++) {
      shown.push(flash.visible && flash.material.uniforms.star.value === 1);
      back = Math.max(back, gun.position.z - z);
      up = Math.max(up, gun.rotation.x - pitch);
      frames(1);
    }
    near(back, 0.035, 0.005, 'back');
    near(up, 2.5 * DEG, 0.4 * DEG, 'pitch');
    assert.deepEqual(shown.slice(0, 3), [true, true, false], 'the star shows two frames');
    assert.ok(!flash.visible && Math.abs(hemi.intensity - base) < 1e-9, 'glow and light gone by 50 ms');
    frames(60);
    assert.ok(Math.abs(gun.position.z - z) < 1e-3, 'settled');
  });

  test('own casings fly out right and up, live 0.45 s; the shotgun throws its shell at the pump', () => {
    spawn('rifle');
    const casings = rig('casings');
    vm.gunKick();
    frames(2);
    assert.equal(casings.count, 1);
    const p = new THREE.Vector3();
    const m = new THREE.Matrix4();
    casings.getMatrixAt(0, m);
    const start = p.setFromMatrixPosition(m).clone();
    frames(8);
    casings.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    assert.ok(p.x > start.x + 0.1 && p.y > start.y, 'right and up');
    frames(20);
    assert.equal(casings.count, 0, 'gone after 0.45 s');
    assert.ok(!casings.visible);
    spawn('shotgun');
    vm.gunKick();
    frames(20); // 0.33 s
    assert.equal(casings.count, 0, 'not yet: the pump is still going back');
    frames(10); // 0.5 s
    assert.equal(casings.count, 1, 'out at the pump');
  });

  test('the reload timer drops the magazine and seats it again', () => {
    spawn('rifle');
    const mag = bone('rifle', 1);
    const seated = mag.position.clone();
    self.arsenal.reload = WEAPONS.rifle.reload * 0.6; // 40% through: the new magazine is on its way
    frames(30);
    assert.ok(mag.position.y < seated.y - 0.15, 'dropped');
    self.arsenal.reload = 0;
    frames(60);
    assert.ok(mag.position.distanceTo(seated) < 1e-3, 'seated');
  });

  test('the shotgun racks its pump 0.07 m between 300 and 560 ms after a shot', () => {
    spawn('shotgun');
    const pump = bone('shotgun', 1);
    const forward = pump.position.z;
    const cycle = 1 / WEAPONS.shotgun.rps;
    self.arsenal.cooldown = cycle - 0.2;
    frames(5);
    near(pump.position.z, forward, 0.002, 'still forward at 0.2 s');
    self.arsenal.cooldown = cycle - 0.43;
    frames(20);
    near(pump.position.z, forward + 0.07, 0.003, 'back at 0.43 s');
    self.arsenal.cooldown = 0;
    frames(60);
    near(pump.position.z, forward, 1e-3, 'forward again');
  });

  test('a new slot lowers the old gun over 150 ms, swaps, and raises the new one with a 4% overshoot', () => {
    spawn('rifle');
    const up = gun.position.y;
    self.arsenal.slot = 1;
    self.arsenal.switching = SWITCH_SECONDS;
    vm.setGun('pistol', true);
    frames(1);
    assert.ok(rig('rifle').visible && !rig('pistol').visible, 'still the rifle');
    frames(7); // 133 ms
    assert.ok(rig('rifle').visible && gun.position.y < up - 0.2, 'rifle lowered');
    frames(2); // 167 ms
    assert.ok(rig('pistol').visible && !rig('rifle').visible, 'swapped at the bottom');
    const low = Math.min(...Array.from({ length: 25 }, (_, i) => vm.switchLow(0.15 + i * 0.01)));
    near(low, -0.04, 0.002, 'overshoot');
    self.arsenal.switching = 0;
    frames(60);
    const rest = vm.MODELS.pistol;
    assert.ok(Math.abs(gun.position.y - rest.base[1]) < 0.004, 'pistol raised');
  });

  test('a power-up gun lock casts instead of switching: a 0.04 m dip and 4° roll inside 120 ms', () => {
    spawn('rifle');
    const y = gun.position.y;
    const roll = gun.rotation.z;
    self.arsenal.switching = 0.005; // a correction nudging the timer is no lock
    frames(4);
    near(gun.position.y, y, 0.004, 'no cast for a nudge');
    self.arsenal.switching = 0.25; // the lock, with no new slot: the arsenal alone starts the cast
    let dip = 0;
    let turn = 0;
    frames(8, (i) => {
      if (i === 3) vm.powerCast('shunt'); // the server's event, a few frames late: no second dip
      dip = Math.max(dip, y - gun.position.y);
      turn = Math.max(turn, gun.rotation.z - roll);
    });
    near(dip, 0.04, 0.004, 'dip');
    near(turn, 4 * DEG, 0.5 * DEG, 'roll');
    near(gun.position.y, y, 0.004, 'done inside 133 ms');
    assert.ok(rig('rifle').visible, 'never lowered for a switch');
    self.arsenal.switching = 0;
    frames(30);
    near(gun.position.y, y, 0.004, 'back'); // within the breath
  });

  test('turning sways the gun, clamped at 3°; strafing rolls it 4° and bobs it', () => {
    spawn('rifle');
    const yaw = gun.rotation.y;
    for (let i = 0; i < 10; i++) {
      camera.rotation.y -= 0.02; // turning right, 1.2 rad/s
      frames(1);
    }
    assert.ok(gun.rotation.y > yaw + 0.003, 'barrel trails to the left');
    for (let i = 0; i < 20; i++) {
      camera.rotation.y -= 0.2; // a flick, 12 rad/s
      frames(1);
    }
    assert.ok(gun.rotation.y - yaw <= 3 * DEG + 1e-9 && gun.rotation.y - yaw > 2.5 * DEG, `clamped (${(gun.rotation.y - yaw) / DEG}°)`);
    frames(60);
    assert.ok(Math.abs(gun.rotation.y - yaw) < 1e-3);
    camera.rotation.y = 0;
    frames(1);
    self.mover.vx = 5.5; // strafing right at run speed
    const ys = [];
    frames(120, () => ys.push(gun.position.y));
    near(gun.rotation.z - vm.MODELS.rifle.base[5], -4 * DEG, 0.6 * DEG, 'roll'); // plus the bob's share
    assert.ok(Math.max(...ys.slice(60)) - Math.min(...ys.slice(60)) > 0.005, 'bobs');
  });

  test('a landing dips min(0.03, 0.006 × fall speed), down in 70 ms and back in 140 ms', () => {
    for (const [fall, depth] of [[4, 0.024], [8, 0.03]]) {
      spawn('rifle');
      const y = gun.position.y;
      Object.assign(self.mover, { grounded: false, vy: -fall });
      frames(1);
      Object.assign(self.mover, { grounded: true, vy: 0 });
      let low = Infinity;
      frames(5, () => { low = Math.min(low, gun.position.y); });
      near(y - low, depth, 0.003, `dip at ${fall} m/s`);
      frames(9);
      near(gun.position.y, y, 0.002, 'back by 210 ms');
    }
  });

  test('the world lights are mirrored, and the sun drops to 0.45 in its shadow', () => {
    spawn('rifle');
    const copy = viewLight('isDirectionalLight');
    assert.ok(viewLight('isHemisphereLight').color.equals(sky.color));
    assert.equal(copy.intensity, sun.intensity);
    assert.ok(copy.color.equals(sun.color));
    assert.ok(copy.position.clone().normalize().distanceTo(sun.position.clone().normalize()) < 1e-9);
    vm.setSunShade(1);
    frames(60);
    near(copy.intensity, 0.45 * sun.intensity, 1e-3, 'shaded');
    vm.setSunShade(0);
    frames(60);
    assert.ok(copy.intensity > 0.99 * sun.intensity);
    const roof = { min: [-1, 3, -1], max: [1, 4, 1] };
    assert.equal(vm.sunBlocked([1.5, 1.6, -0.5], [roof]), true);
    assert.equal(vm.sunBlocked([5, 1.6, 0], [roof]), false);
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
    camera.position.set(0, 0, 0);
  });

  test('setLighting takes the bible LIGHTS in place of the world scene', () => {
    vm.setLighting({ sunColor: '#ffd3a1', sunIntensity: 3.3, sunDir: [-0.683, 0.643, 0.348], skyColor: '#a6c1ee', groundColor: '#d2b78e', hemiIntensity: 1.8 });
    frames(1, () => {});
    spawn('rifle');
    const copy = viewLight('isDirectionalLight');
    near(copy.intensity, 3.3, 1e-9, 'sun');
    assert.ok(copy.position.clone().normalize().distanceTo(new THREE.Vector3(-0.683, 0.643, 0.348).normalize()) < 1e-9);
    near(viewLight('isHemisphereLight').intensity, 1.8, 1e-9, 'sky');
  });
}
