// The static world: lights, sky, fog, the colour grade, the baked map and the
// skyline beyond the walls. Look numbers live in LOOK and LIGHTS (the art and
// feel bible, §2); costs are for an Iris Xe at 1080p.
import * as THREE from 'three';
import { meshMap, skyline, farRidge, clouds, decals, FAR } from './bake.js';
import { makeTexture, makeDecalAtlas, makeFenceTexture, makeRockTexture, ROCK } from './textures.js';

// Late-afternoon sun (40° up, azimuth 243° clockwise from north = −z) and a bounce-lit sky fill.
export const LIGHTS = {
  sunColor: '#ffd3a1', sunIntensity: 3.3, sunDir: [-0.683, 0.643, 0.348],
  skyColor: '#a6c1ee', groundColor: '#d2b78e', hemiIntensity: 1.8, exposure: 1.08,
};
// Older names other branches still import (characters' main.js, every render.js before the merge).
export const SUN_DIR = LIGHTS.sunDir;
export const GRADE = { exposure: LIGHTS.exposure };

export const LOOK = {
  // Static sun shadow: rendered once (0 draws per frame), 5 PCF taps (~0.3 ms). Orthographic
  // bounds in light space, fitted around the map; 2.8 × 2.0 cm texels.
  shadow: { size: 2048, radius: 1.5, intensity: 0.76, bias: -0.0004, normalBias: 0.02, x: 28.3, y: 20.3, near: 20, far: 100, distance: 60 },
  // Sky dome (1 draw, drawn last): horizon (warmer toward the sun) → mid at 30° → zenith,
  // a 0.8° sun disc and a 12° halo. Not tone mapped: its horizon is exactly the fog colour.
  sky: { zenith: '#2b5aa8', mid: '#6a96d0', midElevation: 30, horizon: '#d6dbdf', warm: '#f3dcb8', warmPower: 8, disc: '#fff6e0', discRadius: 0.8, halo: '#ffe7c4', haloStrength: 0.35, haloRadius: 12 },
  fog: { near: 30, far: 160 }, // radial, smoothstep falloff, in sky.horizon; players opt out (fog: false)
  // Baked AO (~20 ms at load): faces cut to `cell` m, `rays` rays per vertex reaching `radius` m.
  ao: { cell: 0.75, rays: 16, lowRays: 8, radius: 1.5, strength: 0.6 },
  // Clouds drift toward azimuth 60° and wrap (shrinking away) at `wrap` m from the camera.
  clouds: { speed: 1.5, azimuth: 60, wrap: 140, fade: 25 },
  // Dust motes (1 draw, first to cut): points in a box around the camera, drifting with the wind.
  motes: { count: 160, box: 24, color: '#fff2d6', opacity: 0.15, size: 2, speed: 0.15 },
};

// Map materials by box `color` (§2.6): the textures.js recipe, the footstep surface and bake
// options (vTop: v of top faces, in the wall texture's coping band or a plain stretch; tile:
// face-local UVs; top: the top face's own material). One draw each, plus the dock top.
const MAP_MATERIALS = [
  { name: 'slab', surface: 'concrete' },
  { name: 'board', surface: 'concrete', vTop: 3.85 },
  { name: 'precast', surface: 'concrete', vTop: 2 },
  { name: 'plywood', surface: 'wood', tile: 1.2 },
  { name: 'dock', surface: 'concrete', top: 'dock-top' },
  { name: 'rust', surface: 'steel' },
];
// Edge treatment (§2.5): a chipped arris brightens the outer `arris` m, then a darker band to `band` m.
const EDGE = { arris: 0.01, arrisGain: 1.08, band: 0.04, bandGain: 0.85 };
// Contact creases (the overview's "dark AO bands at wall bases"): within `width` m of another
// box the light falls by up to `indirect` and `direct`, from the baked `crease` distance, so the
// band is crisp whatever the AO grid. The coarse baked AO still gives the soft falloff.
const CREASE = { width: 0.3, indirect: 0.5, direct: 0.35 };
// Sand drifts (mixed toward #d8c39a), from the baked crease and `along` distances, all exact
// on the coarse grid: a `fillet` m strip along every foot on the floor, a 45° heap `corner` m
// along each wall in inside corners, and on the walls a `lip` m strip up the foot that climbs
// `climb` m more into the corner. The edge wanders by ±`ragged` in 1/8 m steps.
const SAND = '#d8c39a';
const DRIFT = { fillet: 0.15, corner: 1.5, lip: 0.06, climb: 0.45, ragged: 0.35, cell: 0.125, opacity: 0.85 };
const HAZARD = { width: 0.3, stripe: 0.15, colors: ['#ad9862', '#3a3c40'] }; // the dock top's border

// ---- Shader chunks, patched at import, before any material compiles.
// Radial fog depth, so the haze does not swing as the camera turns.
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n#endif';
// The grade: Neutral, saturation 1.08, a cool shadow tint and a warm highlight tint (≈0 ms, inline).
const STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const GRADE_GLSL = `vec3 CustomToneMapping( vec3 color ) { // BOXFIRE_GRADE
  color = NeutralToneMapping( color );
  float y = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = max( mix( vec3( y ), color, 1.08 ), 0.0 );
  color = mix( color, vec3( 0.0122, 0.0242, 0.0578 ), 0.07 * ( 1.0 - smoothstep( 0.0, 0.25, y ) ) );
  return mix( color, vec3( 1.0, 0.8714, 0.6724 ), 0.05 * smoothstep( 0.7, 1.0, y ) );
}`;
const graded = THREE.ShaderChunk.tonemapping_pars_fragment.includes(STUB);
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(STUB, GRADE_GLSL);

// render.js switches sun.castShadow and re-arms sun.shadow.needsUpdate with the setting.
export const sun = new THREE.DirectionalLight(LIGHTS.sunColor, LIGHTS.sunIntensity);
{
  const s = LOOK.shadow;
  sun.position.set(...LIGHTS.sunDir).multiplyScalar(s.distance);
  sun.shadow.mapSize.setScalar(s.size);
  Object.assign(sun.shadow, { radius: s.radius, intensity: s.intensity, bias: s.bias, normalBias: s.normalBias });
  Object.assign(sun.shadow.camera, { left: -s.x, right: s.x, bottom: -s.y, top: s.y, near: s.near, far: s.far });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.autoUpdate = false; // static: rendered only when needsUpdate is armed
  sun.shadow.needsUpdate = true;
}

let quality = 'default';
// 'default' | 'low'. Call before buildWorld.
export function setQuality(q) {
  quality = q === 'low' ? 'low' : 'default';
}

let msaa = true; // the canvas's real antialias attribute: the fence picks its alpha path by it
export function configureRenderer(renderer) {
  msaa = renderer.getContextAttributes()?.antialias ?? false;
  if (!graded) console.warn('world.js: three.js changed its CustomToneMapping stub; using plain Neutral');
  renderer.toneMapping = graded ? THREE.CustomToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = LIGHTS.exposure;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

let boxes = []; // prepared map boxes with their surface, for surfaceAt
export function buildWorld(scene, map) {
  const world = new THREE.Group();
  scene.background = new THREE.Color(LOOK.sky.horizon); // clear colour only: the dome covers it
  scene.fog = new THREE.Fog(LOOK.sky.horizon, LOOK.fog.near, LOOK.fog.far);
  scene.add(new THREE.HemisphereLight(LIGHTS.skyColor, LIGHTS.groundColor, LIGHTS.hemiIntensity), sun);
  world.add(sky());

  const started = performance.now();
  const ao = { ...LOOK.ao, rays: quality === 'low' ? LOOK.ao.lowRays : LOOK.ao.rays, sunDir: LIGHTS.sunDir };
  const { meshes, triangles } = meshMap(map.boxes.map((b) => ({ ...b, ...materialOf(b) })), ao);
  if (debug) console.log(`world: map baked in ${Math.round(performance.now() - started)} ms, ${triangles} triangles`);
  const textures = {};
  for (const [name, arrays] of Object.entries(meshes)) {
    const recipe = name === 'dock-top' ? 'slab' : name;
    const mesh = new THREE.Mesh(geometry(arrays), mapMaterial((textures[recipe] ??= makeTexture(recipe)), name === 'dock-top'));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.renderOrder = name === 'slab' ? 1 : 0; // the floor after the walls, so early-z rejects hidden floor
    world.add(mesh);
  }
  const solid = new THREE.Mesh(quadGeometry(skyline()), skylineMaterial());
  solid.castShadow = solid.receiveShadow = true;
  world.add(solid, buildFar(), buildMotes(), buildDecals(map), buildFence());
  scene.add(world);
  boxes = map.boxes.map((b) => ({ min: b.pos.map((p, i) => p - b.size[i] / 2), max: b.pos.map((p, i) => p + b.size[i] / 2), surface: materialOf(b).surface }));
}

const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
const materialOf = (box) => {
  const m = MAP_MATERIALS[box.color] ?? MAP_MATERIALS[0];
  return { mat: m.name, top: m.top, vTop: m.vTop, tile: m.tile, surface: m.surface };
};

// Per frame: the far group and the motes follow the camera; clouds drift, blades turn.
const bladeQ = new THREE.Quaternion();
const bladeRoll = new THREE.Quaternion();
const bladeM = new THREE.Matrix4();
const bladeP = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
export function updateWorld(now, camera) {
  if (!far) return;
  far.position.set(camera.position.x, 0, camera.position.z);
  motes.uniforms.moteCam.value.copy(camera.position);
  if (quality === 'low') return; // no motion on Low
  const t = now / 1000;
  far.uniforms.cloudTime.value = t;
  motes.uniforms.moteTime.value = t;
  poseBlades(t);
}
function poseBlades(t) {
  const spin = (t * FAR.turbines.rpm * Math.PI) / 30;
  for (let i = 0; i < far.hubs.length; i++) {
    const h = far.hubs[i];
    bladeQ.setFromAxisAngle(Y, h.yaw);
    for (let k = 0; k < 3; k++) {
      bladeRoll.setFromAxisAngle(Z, spin + (k * 2 * Math.PI) / 3 + i);
      bladeM.compose(bladeP.set(h.x, h.y, h.z), bladeRoll.premultiply(bladeQ), ONE);
      far.blades.setMatrixAt(i * 3 + k, bladeM);
    }
  }
  far.blades.instanceMatrix.needsUpdate = true;
}

// The far group (3 draws), locked to the camera's x/z, unlit and unfogged with colours
// pre-hazed toward the horizon: the ridge and turbine towers, the blades, the clouds.
let far = null;
function buildFar() {
  const unlit = (o = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, ...o });
  const group = new THREE.Group();
  const ridge = farRidge(LIGHTS.sunDir);
  const T = FAR.turbines;
  const blade = new THREE.BoxGeometry(...T.blade).translate(0, T.blade[1] / 2, 0);
  const blades = new THREE.InstancedMesh(blade, unlit({ vertexColors: false, color: ridge.color }), ridge.hubs.length * 3);
  const C = LOOK.clouds;
  const uniforms = {
    cloudTime: { value: 0 },
    cloudDrift: { value: new THREE.Vector2(Math.sin(THREE.MathUtils.degToRad(C.azimuth)), -Math.cos(THREE.MathUtils.degToRad(C.azimuth))).multiplyScalar(C.speed) },
    cloudWrap: { value: C.wrap },
    cloudFade: { value: C.fade },
  };
  const cloudMaterial = unlit();
  cloudMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 centre;\nuniform float cloudTime, cloudWrap, cloudFade;\nuniform vec2 cloudDrift;')
      .replace('#include <begin_vertex>', `
        // Drift the cluster, wrap it along the wind within the wrap circle, shrink it near the edge.
        vec2 windDir = normalize( cloudDrift );
        vec2 c = centre.xz + cloudDrift * cloudTime;
        float along = dot( c, windDir );
        vec2 across = c - along * windDir;
        float chord = sqrt( max( cloudWrap * cloudWrap - dot( across, across ), 4.0 * cloudFade * cloudFade ) );
        along = mod( along + chord, 2.0 * chord ) - chord;
        vec2 xz = across + along * windDir;
        vec3 transformed = vec3( xz.x, centre.y, xz.y ) + ( position - centre ) * smoothstep( chord, chord - cloudFade, abs( along ) );`);
  };
  const ridgeMesh = new THREE.Mesh(quadGeometry(ridge.quads), unlit());
  const cloudMesh = new THREE.Mesh(quadGeometry(clouds(LIGHTS.sunDir)), cloudMaterial);
  for (const m of [ridgeMesh, blades, cloudMesh]) m.frustumCulled = false; // a ring around the camera, or moved in the shader
  group.add(ridgeMesh, blades, cloudMesh);
  far = Object.assign(group, { blades, hubs: ridge.hubs, uniforms });
  poseBlades(0);
  return group;
}

// Dust motes: wrapped into a box around the camera in the shader, so 0 work per frame.
let motes = null;
function buildMotes() {
  const M = LOOK.motes;
  const position = new Float32Array(M.count * 3).map(() => Math.random() * M.box);
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(position, 3));
  const material = new THREE.PointsMaterial({ color: M.color, size: M.size, sizeAttenuation: false, transparent: true, opacity: M.opacity, depthWrite: false, fog: false, toneMapped: false });
  const wind = THREE.MathUtils.degToRad(LOOK.clouds.azimuth);
  const uniforms = { moteCam: { value: new THREE.Vector3() }, moteTime: { value: 0 }, moteDrift: { value: new THREE.Vector3(Math.sin(wind), 0.2, -Math.cos(wind)).multiplyScalar(M.speed) } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 moteCam, moteDrift;\nuniform float moteTime;')
      .replace('#include <begin_vertex>', `vec3 transformed = mod( position + moteDrift * moteTime - moteCam + ${(M.box / 2).toFixed(1)}, ${M.box.toFixed(1)} ) - ${(M.box / 2).toFixed(1)} + moteCam;`);
  };
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = quality !== 'low';
  motes = Object.assign(points, { uniforms });
  return points;
}

// Decals (1 draw): lit, shadowed, fogged quads from the atlas, tinted by vertex colour.
function buildDecals(map) {
  const { texture, cells } = makeDecalAtlas();
  const list = decals(map.boxes);
  const position = new Float32Array(list.length * 12);
  const normal = new Float32Array(list.length * 12);
  const uv = new Float32Array(list.length * 8);
  const color = new Float32Array(list.length * 16);
  const index = new Uint32Array(list.length * 6);
  const c = new THREE.Color();
  const [n, up, right, p] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  list.forEach((d, i) => {
    const [u0, v0, u1, v1, aspect] = cells[d.cell];
    const w = d.w ?? d.h * aspect;
    n.fromArray(d.n);
    up.fromArray(d.up);
    right.crossVectors(up, n);
    c.set(d.color);
    [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]].forEach(([sx, sy, u, v], k) => {
      p.fromArray(d.c).addScaledVector(right, (sx * w) / 2).addScaledVector(up, (sy * d.h) / 2).addScaledVector(n, 0.005);
      p.toArray(position, i * 12 + k * 3);
      n.toArray(normal, i * 12 + k * 3);
      uv.set([u, v], i * 8 + k * 2);
      color.set([c.r, c.g, c.b, d.alpha], i * 16 + k * 4);
    });
    index.set([0, 1, 2, 0, 2, 3].map((v) => v + i * 4), i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(color, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  const material = new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Chain-link on the wall tops (1 draw): alpha to coverage with MSAA. Without MSAA (Low, or
// the MSAA setting off), a screen-door discard against interleaved gradient noise: crisp
// wires up close, and past ~10 m, where mipmapping averages the 1 px wires to α ≈ 0.25, that
// share of pixels still draws, so the fence fades instead of vanishing under a 0.5 test.
const FENCE = { y: 4, height: 1.4, at: 20.5, length: 42 };
function buildFence() {
  const F = FENCE;
  const quads = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([sx, sz]) => {
    const along = [sz !== 0 ? 1 : 0, sx !== 0 ? 1 : 0]; // x for the north and south walls, z for east and west
    const c = [sx * F.at, sz * F.at];
    const half = F.length / 2;
    const a = [c[0] - along[0] * half, c[1] - along[1] * half];
    const b = [c[0] + along[0] * half, c[1] + along[1] * half];
    return { p: [a[0], F.y, a[1], b[0], F.y, b[1], b[0], F.y + F.height, b[1], a[0], F.y + F.height, a[1]], n: [sx, 0, sz], color: '#ffffff' };
  });
  const g = quadGeometry(quads);
  const tiles = F.length / F.height;
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(quads.flatMap(() => [0, 0, tiles, 0, tiles, 1, 0, 1])), 2));
  g.deleteAttribute('color');
  const material = new THREE.MeshLambertMaterial({ map: makeFenceTexture(), side: THREE.DoubleSide, alphaToCoverage: msaa });
  if (!msaa) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',
        'if ( diffuseColor.a < fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) ) discard;');
    };
  }
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

// The skyline: Lambert with vertex colours, and the rock tile over cut rock (the `rock`
// attribute), on world-space UVs: along the face and up, one repeat per ROCK.size metres.
function skylineMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rockMap = { value: makeRockTexture() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = rockMap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rock;\nvarying float vRock;\nvarying vec2 vRockUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRock = rock;
        vRockUv = vec2( dot( position.xz, vec2( -normal.z, normal.x ) ) / ${ROCK.size[0].toFixed(1)}, position.y / ${ROCK.size[1].toFixed(2)} );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D rockMap;\nvarying float vRock;\nvarying vec2 vRockUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 rockUv = vRockUv + vec2( fract( sin( floor( vRockUv.y ) * 91.7 ) * 43758.5 ), 0.0 ); // each band slides the tile along
        diffuseColor.rgb *= mix( 1.0, texture2D( rockMap, rockUv ).r * 1.9922, vRock ); // 128 = ×1`);
  };
  return material;
}

// Quads ({ p, n, color (one hex or 4), centre?, rock? }) → an indexed geometry with flat normals and linear vertex colours.
function quadGeometry(quads) {
  const n = quads.length;
  const position = new Float32Array(n * 12);
  const normal = new Float32Array(n * 12);
  const color = new Float32Array(n * 12);
  const centre = quads[0]?.centre ? new Float32Array(n * 12) : null;
  const rock = quads.some((q) => q.rock) ? new Float32Array(n * 4) : null;
  const index = new Uint32Array(n * 6);
  const colors = new Map();
  quads.forEach((q, i) => {
    position.set(q.p, i * 12);
    for (let k = 0; k < 4; k++) {
      const hex = Array.isArray(q.color) ? q.color[k] : q.color;
      if (!colors.has(hex)) colors.set(hex, new THREE.Color(hex).toArray());
      normal.set(q.n, i * 12 + k * 3);
      color.set(colors.get(hex), i * 12 + k * 3);
      centre?.set(q.centre, i * 12 + k * 3);
    }
    rock?.fill(q.rock ?? 0, i * 4, i * 4 + 4);
    index.set([0, 1, 2, 0, 2, 3].map((v) => v + i * 4), i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  if (centre) g.setAttribute('centre', new THREE.BufferAttribute(centre, 3));
  if (rock) g.setAttribute('rock', new THREE.BufferAttribute(rock, 1));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// The footstep surface under a point (feet at y): the top of the box it stands on.
export function surfaceAt(x, y, z) {
  let best = null;
  for (const b of boxes) {
    if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && b.max[1] <= y + 0.1 && (!best || b.max[1] > best.max[1])) best = b;
  }
  return best?.surface ?? 'concrete';
}

const SIZES = { position: 3, normal: 3, uv: 2, ao: 1, along: 2, crease: 1, sun: 1, face: 4 };
function geometry({ index, ...attributes }) {
  const g = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(attributes)) g.setAttribute(name, new THREE.BufferAttribute(array, SIZES[name]));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// Lambert with the baked AO, contact creases, sand drifts and per-vertex sun (used only without a shadow
// map), and the edge treatment from the face-local `face` attribute. All map materials
// share one program; the dock top switches its hazard border on with a uniform.
const glsl = (hex) => `vec3( ${new THREE.Color(hex).toArray().map((v) => v.toFixed(4)).join(', ')} )`; // linear
function mapMaterial(map, hazard) {
  // Sun-facing faces go into the shadow map, not three's default back faces: a floor point at
  // the foot of a shaded wall then compares against the wall's top and outer face, a wall's
  // thickness nearer the sun, instead of the inner face it touches (a 1 px lit seam there).
  const material = new THREE.MeshLambertMaterial({ map, shadowSide: THREE.FrontSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hazard = { value: hazard ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float ao, crease, sun;
        attribute vec2 along;
        attribute vec4 face;
        varying float vAo, vCrease, vSun;
        varying vec2 vAlong;
        varying vec4 vFace;
        varying vec3 vMapPos;
        varying float vUp;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAo = ao; vAlong = along; vCrease = crease; vSun = sun; vFace = face; vMapPos = position; vUp = normal.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float hazard;
        varying float vAo, vCrease, vSun;
        varying vec2 vAlong;
        varying vec4 vFace;
        varying vec3 vMapPos;
        varying float vUp;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if ( vAlong.x >= 0.0 ) {
          // Value noise along x and z, stepped to 1/8 m pixels, 0.5 m between knots.
          vec2 t = floor( vMapPos.xz / ${DRIFT.cell.toFixed(3)} ) * 0.25;
          vec2 k = floor( t );
          vec2 f = smoothstep( 0.0, 1.0, t - k );
          vec2 n = mix( fract( sin( k * 12.9898 ) * 43758.5453 ), fract( sin( ( k + 1.0 ) * 12.9898 ) * 43758.5453 ), f );
          float edge = 1.0 + ${DRIFT.ragged.toFixed(2)} * ( n.x + n.y - 1.0 );
          float sandAt = vUp > 0.5
            ? min( vCrease / ${DRIFT.fillet.toFixed(3)}, ( vAlong.x + vAlong.y ) / ${DRIFT.corner.toFixed(3)} )
            : vAlong.y / ( ${DRIFT.lip.toFixed(3)} + ${DRIFT.climb.toFixed(3)} * max( 0.0, 1.0 - vAlong.x / ${DRIFT.corner.toFixed(3)} ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, ${glsl(SAND)}, ${DRIFT.opacity.toFixed(2)} * ( 1.0 - smoothstep( 0.75 * edge, edge, sandAt ) ) );
        }
        vec2 edgeNear = min( vFace.xy, vFace.zw - vFace.xy );
        float edgeDist = min( edgeNear.x, edgeNear.y );
        if ( hazard > 0.5 && edgeDist < ${HAZARD.width.toFixed(3)} ) {
          diffuseColor.rgb = mod( floor( ( vFace.x + vFace.y ) / ${(HAZARD.stripe * Math.SQRT2).toFixed(4)} ), 2.0 ) < 0.5 ? ${glsl(HAZARD.colors[0])} : ${glsl(HAZARD.colors[1])};
        }
        float edgePx = fwidth( edgeDist );
        float band = max( ${EDGE.band.toFixed(3)}, edgePx ); // never thinner than a pixel: crisp box edges at range
        diffuseColor.rgb *= mix( ${EDGE.bandGain.toFixed(3)}, 1.0, smoothstep( band - 0.5 * edgePx, band + 0.5 * edgePx, edgeDist ) );
        diffuseColor.rgb *= mix( ${(EDGE.arrisGain / EDGE.bandGain).toFixed(4)}, 1.0, smoothstep( ${EDGE.arris.toFixed(3)} - 0.5 * edgePx, ${EDGE.arris.toFixed(3)} + 0.5 * edgePx, edgeDist ) );`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float creaseK = 1.0 - smoothstep( 0.0, ${CREASE.width.toFixed(3)}, vCrease );
        reflectedLight.indirectDiffuse *= vAo * ( 1.0 - ${CREASE.indirect.toFixed(3)} * creaseK );
        reflectedLight.directDiffuse *= ( 0.85 + 0.15 * vAo ) * ( 1.0 - ${CREASE.direct.toFixed(3)} * creaseK );
        #ifndef USE_SHADOWMAP
          reflectedLight.directDiffuse *= mix( 0.24, 1.0, vSun );
        #endif`);
  };
  material.customProgramCacheKey = () => 'world-map';
  return material;
}

// A BackSide box drawn around the camera on the far plane (z = w): the gradient is per
// pixel, so 12 triangles make a perfect dome. Drawn after all opaque geometry.
function sky() {
  const s = LOOK.sky;
  const rad = THREE.MathUtils.degToRad;
  const color = (hex) => ({ value: new THREE.Color(hex) }); // linear
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: color(s.zenith), mid: color(s.mid), horizon: color(s.horizon), warm: color(s.warm), disc: color(s.disc), halo: color(s.halo),
      sunDir: { value: new THREE.Vector3(...LIGHTS.sunDir) },
      midElevation: { value: rad(s.midElevation) },
      warmPower: { value: s.warmPower },
      discCos: { value: Math.cos(rad(s.discRadius)) },
      haloCos: { value: Math.cos(rad(s.haloRadius)) },
      haloStrength: { value: s.haloStrength },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = ( projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 ) ).xyww;
      }`,
    fragmentShader: `
      uniform vec3 zenith, mid, horizon, warm, disc, halo, sunDir;
      uniform float midElevation, warmPower, discCos, haloCos, haloStrength;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        float e = asin( clamp( d.y, -1.0, 1.0 ) );
        float w = pow( max( dot( normalize( d.xz + 1e-5 ), normalize( sunDir.xz ) ), 0.0 ), warmPower );
        vec3 h = mix( horizon, warm, w );
        vec3 c = e < midElevation ? mix( h, mid, max( e, 0.0 ) / midElevation )
          : mix( mid, zenith, ( e - midElevation ) / ( 1.5707963 - midElevation ) );
        float cosSun = dot( d, sunDir );
        float glow = smoothstep( haloCos, discCos, cosSun );
        c += halo * haloStrength * glow * glow;
        c = mix( c, disc, smoothstep( discCos - fwidth( cosSun ), discCos, cosSun ) );
        gl_FragColor = vec4( c, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // after the opaque world, so early depth tests skip covered pixels
  return mesh;
}
