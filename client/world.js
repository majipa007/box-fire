// The static world: lights, sky, fog, the colour grade, the baked map and the
// skyline beyond the walls. Look numbers live in LOOK and LIGHTS (the art and
// feel bible, §2); costs are for an Iris Xe at 1080p.
import * as THREE from 'three';
import { meshMap } from './bake.js';
import { makeTexture } from './textures.js';

// Late-afternoon sun (40° up, azimuth 243° clockwise from north = −z) and a bounce-lit sky fill.
export const LIGHTS = {
  sunColor: '#ffd3a1', sunIntensity: 3.3, sunDir: [-0.683, 0.643, 0.348],
  skyColor: '#a6c1ee', groundColor: '#d2b78e', hemiIntensity: 1.8, exposure: 1.08,
};

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
};

// Materials by name, as a map box's `mat` (or `top`, for its top face) names them.
const MATERIALS = {
  concrete: 'concrete', sand: 'sand', metal: 'metal', planks: 'planks', plaster: 'plaster', trim: 'trim',
};

// ---- Shader chunks, patched at import, before any material compiles.
// Radial fog depth, so the haze does not swing as the camera turns.
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n#endif';
// The grade: Neutral, saturation 1.08, a cool shadow tint and a warm highlight tint (≈0 ms, inline).
const STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const GRADE = `vec3 CustomToneMapping( vec3 color ) { // BOXFIRE_GRADE
  color = NeutralToneMapping( color );
  float y = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = max( mix( vec3( y ), color, 1.08 ), 0.0 );
  color = mix( color, vec3( 0.0122, 0.0242, 0.0578 ), 0.07 * ( 1.0 - smoothstep( 0.0, 0.25, y ) ) );
  return mix( color, vec3( 1.0, 0.8714, 0.6724 ), 0.05 * smoothstep( 0.7, 1.0, y ) );
}`;
const graded = THREE.ShaderChunk.tonemapping_pars_fragment.includes(STUB);
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(STUB, GRADE);

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

export function configureRenderer(renderer) {
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

  const ao = { ...LOOK.ao, rays: quality === 'low' ? LOOK.ao.lowRays : LOOK.ao.rays };
  for (const [name, arrays] of Object.entries(meshMap(map.boxes, ao).meshes)) {
    const mesh = new THREE.Mesh(geometry(arrays), mapMaterial(MATERIALS[name] ?? 'concrete'));
    mesh.castShadow = mesh.receiveShadow = true;
    world.add(mesh);
  }
  scene.add(world);
}

// Per frame: nothing yet beyond what follows the camera.
export function updateWorld(now, camera) {}

// The footstep surface under a point: 'concrete', 'wood' or 'steel'.
export function surfaceAt(x, y, z) {
  return 'concrete';
}

const SIZES = { position: 3, normal: 3, uv: 2, ao: 1, face: 4 };
function geometry({ index, ...attributes }) {
  const g = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(attributes)) g.setAttribute(name, new THREE.BufferAttribute(array, SIZES[name]));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// Lambert with the baked AO (vertex `ao`). All map materials share one program.
function mapMaterial(texture) {
  const material = new THREE.MeshLambertMaterial({ map: makeTexture(texture) });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nvarying float vAo;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAo = ao;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAo;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vAo;
        reflectedLight.directDiffuse *= 0.85 + 0.15 * vAo;`);
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
