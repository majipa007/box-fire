// The static world: lights, sky, fog, the colour grade, the baked map and the
// skyline beyond the walls. Every look number is a named constant here (and
// in textures.js) for the art pass; costs are for an Iris Xe at 1080p.
import * as THREE from 'three';
import { meshMap, landscape } from './bake.js';
import { makeTexture } from './textures.js';

// Sun: azimuth in degrees clockwise from north (−z) seen from above, elevation above the horizon.
export const SUN = { color: '#fff4e5', intensity: 2.5, azimuth: 235, elevation: 50 };
// Sky and ground fill. Lights are physically based: intensities near π read as "normal".
export const HEMI = { sky: '#d5dde6', ground: '#8f8b83', intensity: 1.9 };
// Static sun shadow: baked once (0 draws per frame), sampled with 5 PCF taps (~0.3 ms).
export const SHADOW = { size: 2048, radius: 3, intensity: 0.75, bias: -0.0004, normalBias: 0.02 };
// Sky dome (1 draw): a gradient by elevation, horizon → mid (at midElevation°) → zenith,
// warmer toward the sun near the horizon, and a sun disc with a halo. It is not tone
// mapped, so its horizon is exactly the fog colour.
export const SKY = {
  zenith: '#5f86b9', mid: '#9cb6d3', horizon: '#d2d9e0', below: '#c3cad1', midElevation: 25,
  warm: '#e9e0d0', warmth: 0.45, // sun-side horizon tint and its strength
  disc: '#fff7e6', discSize: 1.8, // degrees across
  halo: 0.3, haloSize: 10, // strength, and degrees from the sun where it has halved
};
export const FOG = { near: 35, far: 160 }; // linear, in SKY.horizon; players should opt out (fog: false)
// Grade, inline in every lit material (≈0 ms): Neutral tone mapping, saturation, then a split
// tone: linear luma under shadowBelow leans to shadowTint, over highlightAbove to highlightTint.
export const GRADE = {
  exposure: 1, saturation: 1.05,
  shadowTint: '#2c3b52', shadowAmount: 0.05, shadowBelow: 0.12,
  highlightTint: '#fff1dd', highlightAmount: 0.04, highlightAbove: 0.6,
};
// Baked AO (~50 ms at load, ~37k triangles; 0.75 m cells halve both): faces cut to `cell` m,
// `rays` rays per vertex reaching `radius` m. It dims sky light fully and sunlight by `direct`.
export const AO = { cell: 0.5, rays: 16, radius: 1.5, strength: 0.65, direct: 0.4 };
// Convex box edges darken by `darken` × the material's `edge` over `width` m (never under a pixel).
export const EDGE = { width: 0.04, darken: 0.22 };
// Materials by name, as a map box's `mat` (or `top`, for its top face) names them: a textures.js
// recipe, a tint multiplied over it and an edge multiplier. One draw per material in use.
export const MATERIALS = {
  concrete: { texture: 'concrete', tint: '#ffffff', edge: 1 },
  sand: { texture: 'sand', tint: '#ffffff', edge: 0.5 },
  metal: { texture: 'metal', tint: '#ffffff', edge: 1.3 },
  planks: { texture: 'planks', tint: '#ffffff', edge: 1.5 },
  plaster: { texture: 'plaster', tint: '#ffffff', edge: 0.8 },
  trim: { texture: 'trim', tint: '#ffffff', edge: 1 },
};
// Skyline beyond the walls (2 draws, ~11k triangles): unlit, unfogged vertex colours with this
// file's sun, sky fill and a distance haze baked in. Ring and cloud fields: see bake.js
// landscape(). Every vertex stays nearer than `far` m to any arena point (camera far: 200 m).
export const LANDSCAPE = {
  seed: 7,
  far: 195,
  groundY: -0.05,
  clear: 21, // skip ground cells wholly inside |x|, |z| ≤ clear
  haze: { near: 30, far: 170, max: 0.8 }, // toward SKY.horizon, by distance from the arena centre
  rings: [
    { cell: 6, inner: 0, outer: 64, height: [0, 0], colors: ['#8d8a83', '#95928b'] }, // ground
    { cell: 4, inner: 46, outer: 58, height: [6, 14], bumps: 5, rough: 0.3, step: 2, strata: 2, colors: ['#b0aba2', '#a09b92', '#a8a39a'] }, // cliffs
    { cell: 6, inner: 84, outer: 126, height: [12, 38], bumps: 7, rough: 0.06, ridge: 1, step: 2, colors: ['#8f959d'] }, // near mountain band
    { cell: 8, inner: 128, outer: 148, height: [28, 50], bumps: 5, rough: 0.05, ridge: 1, step: 3, colors: ['#9aa3ad'] }, // far mountain band
  ],
  clouds: {
    count: 14, reach: [50, 125], altitude: [60, 78], puffs: [2, 5], size: [8, 20], thickness: [2, 4],
    colors: { top: '#ffffff', side: '#e8ecf1', bottom: '#c5cdd8' },
    spin: 0.004, // rad/s around the arena centre
  },
};

const rad = THREE.MathUtils.degToRad;
// Unit vector toward the sun, e.g. for rayBox sun-visibility tests.
export const SUN_DIR = [
  Math.cos(rad(SUN.elevation)) * Math.sin(rad(SUN.azimuth)),
  Math.sin(rad(SUN.elevation)),
  -Math.cos(rad(SUN.elevation)) * Math.cos(rad(SUN.azimuth)),
];

// render.js switches sun.castShadow and re-arms sun.shadow.needsUpdate with the setting.
export const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
sun.position.set(...SUN_DIR).multiplyScalar(60);
sun.shadow.mapSize.setScalar(SHADOW.size);
Object.assign(sun.shadow, { radius: SHADOW.radius, intensity: SHADOW.intensity, bias: SHADOW.bias, normalBias: SHADOW.normalBias });
sun.shadow.autoUpdate = false; // static: rendered only when needsUpdate is armed
sun.shadow.needsUpdate = true;

// The grade replaces three.js's CustomToneMapping stub (renderer.toneMapping = CustomToneMapping).
const glslColor = (hex) => `vec3( ${new THREE.Color(hex).toArray().map((v) => v.toFixed(4)).join(', ')} )`;
const STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
if (THREE.ShaderChunk.tonemapping_pars_fragment.includes(STUB)) {
  const g = GRADE;
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(STUB, `
vec3 CustomToneMapping( vec3 color ) {
  color = NeutralToneMapping( color );
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = max( mix( vec3( luma ), color, ${g.saturation.toFixed(4)} ), 0.0 );
  color = mix( color, ${glslColor(g.shadowTint)}, ${g.shadowAmount.toFixed(4)} * ( 1.0 - smoothstep( 0.0, ${g.shadowBelow.toFixed(4)}, luma ) ) );
  return mix( color, ${glslColor(g.highlightTint)}, ${g.highlightAmount.toFixed(4)} * smoothstep( ${g.highlightAbove.toFixed(4)}, 1.0, luma ) );
}`);
} else {
  console.warn('world.js: three.js changed its CustomToneMapping stub; the grade is off');
}

export function buildWorld(scene, map) {
  const world = new THREE.Group();
  scene.background = null; // the sky dome covers every pixel
  scene.fog = new THREE.Fog(SKY.horizon, FOG.near, FOG.far);
  scene.add(new THREE.HemisphereLight(HEMI.sky, HEMI.ground, HEMI.intensity), sun);
  fitShadow(map.boxes);
  world.add(sky());

  for (const [name, arrays] of Object.entries(meshMap(map.boxes, AO).meshes)) {
    const mesh = new THREE.Mesh(geometry(arrays), mapMaterial(MATERIALS[name] ?? MATERIALS.concrete));
    mesh.castShadow = mesh.receiveShadow = true;
    world.add(mesh);
  }

  const { terrain, clouds } = landscape(LANDSCAPE);
  const cloudMesh = skyline(clouds);
  cloudMesh.frustumCulled = false; // it turns, so its cached bounds would go stale
  cloudMesh.onBeforeRender = () => {
    cloudMesh.rotation.y = (performance.now() / 1000) * LANDSCAPE.clouds.spin;
    cloudMesh.updateMatrixWorld();
  };
  world.add(skyline(terrain), cloudMesh);
  scene.add(world);

  // The sun shadow is baked from the static world alone, whenever it is armed. Anything
  // else that casts (players, effects) is muted for that one render, so it never freezes
  // into the bake.
  const muted = [];
  scene.onBeforeRender = (renderer) => {
    if (!renderer.shadowMap.enabled || !sun.castShadow || !sun.shadow.needsUpdate) return;
    for (const child of scene.children) {
      if (child === world) continue;
      child.traverse((o) => {
        if (o.castShadow && !o.isLight) {
          o.castShadow = false;
          muted.push(o);
        }
      });
    }
  };
  scene.onAfterRender = () => {
    for (const o of muted) o.castShadow = true;
    muted.length = 0;
  };
}

// The orthographic shadow camera, fitted around the whole map as the sun sees it.
function fitShadow(boxes) {
  const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.pos[a] - b.size[a] / 2)));
  const hi = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.pos[a] + b.size[a] / 2)));
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(0, 0, 0); // as DirectionalLightShadow does, toward sun.target
  cam.updateMatrixWorld();
  const bounds = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
    bounds.expandByPoint(corner.applyMatrix4(cam.matrixWorldInverse));
  }
  Object.assign(cam, { left: bounds.min.x, right: bounds.max.x, bottom: bounds.min.y, top: bounds.max.y, near: -bounds.max.z - 1, far: -bounds.min.z + 1 });
  cam.updateProjectionMatrix();
}

const SIZES = { position: 3, normal: 3, uv: 2, ao: 1, face: 4 };
function geometry({ index, ...attributes }) {
  const g = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(attributes)) g.setAttribute(name, new THREE.BufferAttribute(array, SIZES[name]));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// Lambert with the baked AO (vertex `ao`) and edge darkening (vertex `face`). All map
// materials share one program; they differ only in uniforms and texture.
function mapMaterial(def) {
  const material = new THREE.MeshLambertMaterial({ map: makeTexture(def.texture), color: def.tint });
  const edge = new THREE.Vector2(EDGE.width, EDGE.darken * def.edge);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.worldEdge = { value: edge };
    shader.uniforms.worldAoDirect = { value: AO.direct };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nattribute vec4 face;\nvarying float vAo;\nvarying vec4 vFace;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAo = ao;\nvFace = face;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 worldEdge;\nuniform float worldAoDirect;\nvarying float vAo;\nvarying vec4 vFace;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 edgeNear = min( vFace.xy, vFace.zw - vFace.xy );
        float edgeDist = min( edgeNear.x, edgeNear.y );
        float edgePx = fwidth( edgeDist );
        float edgeWidth = max( worldEdge.x, edgePx );
        diffuseColor.rgb *= 1.0 - worldEdge.y * ( 1.0 - smoothstep( edgeWidth - 0.5 * edgePx, edgeWidth + 0.5 * edgePx, edgeDist ) );`)
      .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= vAo;
        reflectedLight.directDiffuse *= mix( 1.0, vAo, worldAoDirect );`);
  };
  material.customProgramCacheKey = () => 'world-map';
  return material;
}

// A BackSide box drawn around the camera at the far plane: the gradient is per pixel, so
// 12 triangles make a perfect dome.
function sky() {
  const color = (hex) => ({ value: new THREE.Color(hex) });
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      zenith: color(SKY.zenith),
      mid: color(SKY.mid),
      horizon: color(SKY.horizon),
      below: color(SKY.below),
      warm: color(SKY.warm),
      disc: color(SKY.disc),
      sunDir: { value: new THREE.Vector3(...SUN_DIR) },
      midY: { value: Math.sin(rad(SKY.midElevation)) },
      warmth: { value: SKY.warmth },
      discCos: { value: Math.cos(rad(SKY.discSize / 2)) },
      halo: { value: SKY.halo },
      haloPower: { value: Math.log(0.5) / Math.log(Math.cos(rad(SKY.haloSize))) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // Rotation only, so it is centred on the camera; xyww puts it on the far plane.
        gl_Position = ( projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 ) ).xyww;
      }`,
    fragmentShader: `
      uniform vec3 zenith, mid, horizon, below, warm, disc, sunDir;
      uniform float midY, warmth, discCos, halo, haloPower;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        vec3 c = d.y < 0.0 ? mix( horizon, below, smoothstep( 0.0, 0.25, - d.y ) )
          : d.y < midY ? mix( horizon, mid, smoothstep( 0.0, midY, d.y ) )
          : mix( mid, zenith, smoothstep( midY, 1.0, d.y ) );
        float toSun = max( dot( normalize( d.xz + 1e-5 ), normalize( sunDir.xz + 1e-5 ) ), 0.0 );
        c = mix( c, warm, warmth * pow( toSun, 8.0 ) * ( 1.0 - smoothstep( 0.0, 0.4, abs( d.y ) ) ) );
        float cosSun = dot( d, sunDir );
        c += disc * halo * pow( max( cosSun, 0.0 ), haloPower );
        c = mix( c, disc, smoothstep( discCos - fwidth( cosSun ), discCos, cosSun ) );
        gl_FragColor = vec4( c, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e6; // after the opaque world, so early depth tests skip covered pixels
  return mesh;
}

// Landscape quads → one unlit mesh: each face lit like the arena (three.js Lambert with
// this file's sun and hemisphere light), then hazed toward the horizon by distance.
function skyline(quads) {
  const position = new Float32Array(quads.length * 12);
  const color = new Float32Array(quads.length * 12);
  const index = new Uint32Array(quads.length * 6);
  const horizon = new THREE.Color(SKY.horizon);
  const { near, far, max } = LANDSCAPE.haze;
  const c = new THREE.Color();
  quads.forEach(({ p, n, color: hex }, i) => {
    const lit = shade(hex, n);
    position.set(p, i * 12);
    for (let k = 0; k < 4; k++) {
      const haze = max * THREE.MathUtils.smoothstep(Math.hypot(p[k * 3], p[k * 3 + 2]), near, far);
      c.copy(lit).lerp(horizon, haze).toArray(color, i * 12 + k * 3);
    }
    index.set([0, 1, 2, 0, 2, 3].map((v) => v + i * 4), i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }));
}

const shades = new Map();
function shade(hex, n) {
  const key = hex + n;
  if (!shades.has(key)) {
    const sunlit = Math.max(0, n[0] * SUN_DIR[0] + n[1] * SUN_DIR[1] + n[2] * SUN_DIR[2]) * SUN.intensity;
    const light = new THREE.Color(HEMI.ground).lerp(new THREE.Color(HEMI.sky), 0.5 + 0.5 * n[1]).multiplyScalar(HEMI.intensity);
    light.add(new THREE.Color(SUN.color).multiplyScalar(sunlit));
    shades.set(key, new THREE.Color(hex).multiply(light).multiplyScalar(1 / Math.PI));
  }
  return shades.get(key);
}
