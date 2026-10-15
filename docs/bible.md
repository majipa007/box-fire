# Boxfire Art and Feel Bible

Version 1.0, 06/10/2026. Direction: **"Sunlit Concrete Quarry, late afternoon"**. It builds on the panel winner "quarry" and adds grafts from "mesa" and "neon".

**How to read this document**
- Every number is normative.
- "Rendered" colours are estimates from a reproduction of the r186 shading path: Lambert, then Neutral tone mapping, then the grade in §2.2. That model reproduced quarry's own claims to within 2 per channel.
- Verify rendered colours with 9×9 px pixel probes on SwiftShader harness shots, at ±12 per channel.
- Iris Xe milliseconds are estimates until someone measures them on a real laptop. Headless runs verify draws, triangles and pixels, not frame rate.

---

## 1. Vision and references

The arena is a working limestone quarry at about 4 pm.
- Chalky concrete and drifted sand sit under a cobalt sky.
- A 40° sun gives a warm sunlit face and cool blue-grey shade. Stepped cut faces open toward the sun. A rust crusher tower stands backlit in the gap, and voxel clouds drift overhead.
- Only people and power-ups are saturated. Players read by value (dark kit and a dark outline) and are identified by hue (their slot colour).
- Power-ups are Blur's colour-coded glowing pickups. Their beams rise 6 m over the walls from pads that are up; a refilling pad shows its clock instead.
- Every shot slaps back off the cut faces.

| Reference | What we take |
|---|---|
| Valorant | Muted backdrop, baked light, big first-person hands, silhouette-first characters |
| Minecraft shader packs, Teardown | Warm sun, cool fill, per-vertex AO, haze, voxel clouds |
| Krunker | Nearest-filtered pixel textures, loud instant hit and kill audio |
| Superhot | Colour code: the world is neutral, actors are saturated |
| Paint the Town Red | Voxel death shatter |
| Blur | 3-slot inventory, glowing colour-coded pickups, light trails, Shunt, Bolt, Barge, Shock, Mine, Nitro and Shield |

### 1.1 Pillars
1. **Value detects, hue identifies.** Dark kit #24272d and the #15171c outline give 6.8–9.6:1 contrast against sunlit surfaces. The slot colour is about 30% of the front silhouette.
2. **Warm light, cool shade.** Surfaces stay low-chroma (OKLCH C ≤ 0.076). The light carries the colour: sunlit walls render #d5b08b and shaded floor #68666e.
3. **Saturation belongs to actors.** Players and power-ups are saturated. The world is saturated only above 4 m or on the skyline.
4. **Everything static is baked:** AO, the sun shadow map (rendered once), sand drifts and skyline haze.
5. **Daylight-proof effects.** Effects are normal-blended with a light core and a dark fringe. Additive blending is used only for muzzle flashes and blast glows.

### 1.2 Judges' flaws and where each is fixed

| Flaw (raised by) | Fix | § |
|---|---|---|
| Quarry measurably bland: chroma ≤ 0.076 at 42° midday (art, design, perf) | 40° late-afternoon sun #ffd3a1 with bounce-lit cool shade. Rendered split: sunlit wall #d5b08b, sunlit floor #ae9787, shaded floor #68666e, shaded wall #625d5c. Saturated landmarks only on the skyline, horseshoe vista, voxel clouds, dust motes | 2.2–2.4 |
| Additive beams and tracers wash out in daylight (art, design) | Normal-blended light core plus dark fringe on tracers, beams, trails and sparks | 3.3, 4.7 |
| Power-up hues collide with slots: Shock vs yellow ΔE00 3.4–4.8, Shunt vs red 3.8–6.3, Mine vs orange 3.2 (all) | New item hues: ≥ 14.8 ΔE00 from every slot and ≥ 20.5 between items; glyph silhouettes; palette test | 2.1, 4.7 |
| Fog maths assumed linear fog; r186 uses smoothstep and −z depth (art, perf) | Radial `fog_vertex` patch; smoothstep values published | 2.3 |
| 11–16 m cut-face ring boxes the vista into a pit (art) | Horseshoe of benches, open from 200° to 290° toward the sun | 2.4 |
| Binary 0.55× rig darkening pops at shadow edges (art) | Rigs receive the static shadow map per pixel. Low preset: 3-point visibility eased over 150 ms | 3.1 |
| No Bolt (art, perf, design) | Bolt: 3 rewound hitscan shots of 25 | 4.2 |
| Shock does 90 to the leader (perf, design) | One hit of 30 plus ×0.6 speed for 2 s; predictive domes kept | 4.2 |
| PCF radius 3 swims (perf) | Radius 1.5 | 2.2 |
| Dust per pellet: 2–4 ms overdraw spike (perf) | ≤ 3 puffs per shot event; fades within 1.5 m of the camera | 3.3 |
| Chain-link turns opaque without MSAA (perf) | `alphaTest` 0.5 fallback | 2.7 |
| 1,024 idle FX cubes still drawn (perf) | Swap-remove pool, so count equals live cubes | 3.3 |
| No shader pre-warm (perf) | `compileAsync` on both scenes at load | 7, 8.9 |
| Sky drawn first (perf, on mesa) | Sky drawn last: `renderOrder` 1000 and z = w | 2.3 |
| No gun lockout (design) | 0.25 s per use, 0.55 s for Bolt, through `arsenal.switching` | 4.1 |
| Shunt can't be shot (design) | One bullet against a rewound 0.5 m cube makes it fizzle | 4.2 |
| Pickup rate ignores player count (design) | Respawn time × min(3, max(1, 6/n)) | 4.3 |
| No kill-share target (design) | Power-up kills ≤ 25%; PWR column and a match-end log line | 4.6 |
| Mines invisible to rejoining tabs (art, on mesa) | Persistent `pu` state in every snapshot | 4.5 |
| Neon's Nitro jump reaches 2.4 m pillar tops (perf) | Nitro changes speed only. Knock lift applies only to grounded players. Named tests | 4.4 |
| Neon's stacking undefined: Shunt could total 110 (perf) | Splash hits everyone except the direct victim; knocks add, then clamp at 12 m/s | 4.2, 4.4 |
| Neon's pickups heal 15 HP (perf) | No healing anywhere | 4.1 |
| Mesa's 1.2 px outline; 10 sprite name tags (art, perf) | 2 px outline; DOM name tags cost 0 draws | 3.1, 6 |
| Mesa credits a shot mine to its owner (design) | Credit goes to the shooter | 4.2 |
| `.woff2` would 404 (perf) | Font vendored as a JS module | 6 |
| Users already saved `shadows:false` | Settings schema v2 resets graphics keys once | 6 |
| Quarry's "move that spawn" note | Dropped: spawns are gameplay data, and world may only edit visual fields | 4.3 |
| Mesa's "pads in arena_01.json" graft | Overridden by ownership: pads live in `shared/constants.js` | 4.3 |

---

## 2. Art direction

### 2.1 Palette

**World materials.** These are base albedos, indexed by the existing box `color`. They are stored in `arena_01.json` under `materials`, the visual field defined in §2.5.

| Index | Material | Base | Accents | OKLCH C (max over base and accents) | Min ΔE00 to any slot |
|---|---|---|---|---|---|
| 0 | slab (floor) | #b7b0a3 | joints #8f887d, sand #d8c39a | 0.059 | 19.7 |
| 1 | board (perimeter walls) | #c9c3b8 | coping #d9d4ca, tie holes #7d776d | 0.017 | 26.3 |
| 2 | precast (lane walls) | #b5afa4 | teal band #5f7f7c, seams #8f887d | 0.037 | 25.0 |
| 3 | plywood (crates) | #a38763 | battens #8c7253, stencil #45474c | 0.061 | 19.4 |
| 4 | dock (platform) | #9d968a (gabion sides) | ochre #ad9862, graphite #3a3c40, top #b7b0a3 | 0.076 | 22.1 |
| 5 | rust (corrugated) | #8a5a44 | blooms #6f4535 | 0.072 | 22.2 |

**Skyline.** These colours sit outside the player band, above the 4 m wall top. They are not in the palette test.
- Cliff strata: #cdbfa6, #c2b296, #d6cab3; seams #9a8d78; shade reference #8d8272; bench sand #d8c39a; scree #b9ab92.
- Crusher #8a5a44 with roof #45474c.
- Water tower: teal #4f8f8a.
- Containers: #8a5a44, #5f7f7c, #ad9862, #45474c.
- Far ridge, pre-hazed: sunlit #d2d0c8, backlit #b5b3b2.
- Turbines #f3e7d4.

**Sky:**
- zenith #2b5aa8;
- 30° elevation #6a96d0;
- horizon, which is also the fog colour, #d6dbdf;
- sun-side horizon #f3dcb8;
- sun disc #fff6e0;
- halo #ffe7c4;
- sun light #ffd3a1.

**Characters:**

| Part | Colour |
|---|---|
| Kit | #24272d |
| Boots | #1b1d22 |
| Gloves | #3a3d44 |
| Pack | #c7b48e |
| Outline | #15171c |
| Gun metal | #2e3136 |
| Tan furniture | #b9a27a |
| Shotgun shells | #b33a2e |
| Brass | #c9a24e |

**Player slots (`PLAYER_COLORS`).** This is the only change: #fabed4 becomes #ff7eb6, because the old pink had chroma 0.074 and sat only 0.082 OKLab from concrete.
`#e6194b #3cb44b #ffe119 #4363d8 #f58231 #911eb4 #42d4f4 #f032e6 #bfef45 #ff7eb6`

**Power-ups (`POWER_COLORS`):**

| Item | Hex | Min ΔE00 to any slot |
|---|---|---|
| Shunt | #ff2a1a | 14.8 (red) |
| Bolt | #2e9bff | 20.7 |
| Barge | #a070ff | 15.6 |
| Shock | #ffb300 | 15.4 (yellow) |
| Mine | #ffffff (LED #ff2a1a) | 26.1 |
| Nitro | #3dff8f | 17.5 (lime) |
| Shield | #66fff0 | 17.9 |

The closest pair between items is Nitro/Shield at 20.5.

**UI:**

| Role | Colour |
|---|---|
| Text | #f2efe8 |
| Dim text | #9a9fa8 |
| Panel | rgba(21,23,28,0.62) |
| Accent | #d9b45a (replaces #f58231, which is slot 4) |
| Danger | #ff5a4f |
| Head hit | #ff4d4d |
| Shield | #66fff0 |

**Measured readability (CIEDE2000).**
- Slots are ≥ 16.7 apart (yellow/lime).
- Slots are ≥ 19.4 from every material colour.
- Items are ≥ 14.8 from slots and ≥ 20.5 from each other.
- Items are ≥ 10.4 from materials (Mine against coping).
- In rendered shade, slots are ≥ 26.5 from shaded surfaces. In sun they are ≥ 17.7 from lit surfaces. The closest slot pair in shade is magenta/pink at 15.6.

**Weak spots, by rule:**
- Kit against the shaded precast wall is only 2.41:1, so hue carries it: slots are ≥ 26.5 ΔE00 from it.
- Graphite stays below 2% of any view.
- Rust appears only on the colour-5 boxes.

**Palette test, `shared/palette.test.js`.** Owned by powerups and shipped in contract commit C0 (§8.0). It uses CIEDE2000 (Sharma 2005) on D65 sRGB→Lab, and OKLCH for chroma.

| Pair | Threshold | Reference value |
|---|---|---|
| Slot vs slot | ≥ 15 | 16.7 |
| Item vs slot | ≥ 13.5 | 14.8 |
| Item vs item | ≥ 18 | 20.5 |

When `arena_01.json` has a `materials` array, it also checks every base and accent:
- vs slots ≥ 18 (reference 19.4);
- vs items ≥ 9 (reference 10.4);
- chroma ≤ 0.08 (reference 0.076).

Without `materials` it skips only those three checks.

### 2.2 Lighting and grade

| Element | Value |
|---|---|
| Sun (`DirectionalLight`) | #ffd3a1, intensity 3.3, elevation 40°, azimuth 243° (WSW, clockwise from north = −z) |
| Sun direction and position | Unit direction toward the sun (−0.683, 0.643, 0.348); position = target (0,0,0) + 60 × direction = (−41.0, 38.6, 20.9) |
| Sun out of view | The top of a level view is at 29.4° (90° hfov, 16:9) and 38.7° (110° hfov). The disc spans 40° ± 0.8°, so it never enters a level view |
| Hemisphere | Sky #a6c1ee, ground #d2b78e (bounce from the sunlit floor), intensity 1.8 |
| Exposure | `toneMappingExposure` = 1.08 × Brightness (setting 0.8–1.3, default 1.0) |
| Tone mapping | `CustomToneMapping`: Neutral, then saturation 1.08, then shadow tint #1d2b44 at 7% (luma ramp 0→0.25), then highlight tint #fff0d6 at 5% (luma 0.7→1.0). About 0 ms because it runs inline |
| Not tone-mapped | Sky, power-up glyphs, beams, visors, FX quads (`toneMapped:false`) |
| Shadow map | `PCFShadowMap` 2048². Orthographic x ±28.3, y ±20.3 m (fitted in light space: 56.5 × 40.6 m), near 20, far 100. Texel 2.76 × 1.98 cm (3.1 cm on the ground). Radius 1.5, bias −0.0004, normalBias 0.02, `shadow.intensity` 0.76. `shadow.autoUpdate=false`; `shadow.needsUpdate=true` at build and on every enable. About 0.3 ms per frame, 16 MB. Use the square map: 2048×1024 would give 3.96 cm texels at 40° |
| Shadow casters | Map meshes and the skyline mesh only. Everything else is `castShadow=false`; today's `characters.js` sets true, and the new one must not |
| Shade coverage | rayBox on arena_01 at 40°: 28.6% of the floor and 15.8% at 1.3 m chest height are in shade. Lane-wall shadows fall 3.2 m toward +x; the west wall shades x from −19.5 to −15.25 |

`world.js` patches the shader chunks at import time, before any material compiles:

```js
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n#endif';
const STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const GRADE = `vec3 CustomToneMapping( vec3 color ) { // BOXFIRE_GRADE
  color = NeutralToneMapping( color );
  float y = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = max( mix( vec3( y ), color, 1.08 ), 0.0 );
  color = mix( color, vec3( 0.0122, 0.0242, 0.0578 ), 0.07 * ( 1.0 - smoothstep( 0.0, 0.25, y ) ) );
  return mix( color, vec3( 1.0, 0.8714, 0.6724 ), 0.05 * smoothstep( 0.7, 1.0, y ) );
}`;
const ok = THREE.ShaderChunk.tonemapping_pars_fragment.includes(STUB);
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(STUB, GRADE);
// configureRenderer(): renderer.toneMapping = ok ? THREE.CustomToneMapping : THREE.NeutralToneMapping (console.warn when !ok)
```

**Rendered results (estimates).** "Top" faces point up; "side" faces are vertical, either facing the sun horizontally or facing away.

| Material | Top, sun | Top, shade | Side facing sun | Side facing away |
|---|---|---|---|---|
| slab | #ae9787 (L*64) | #68666e (L*44) | #c19d78 | #564f4d |
| board | #c1a99c | #767680 | #d5b08b (L*74) | #625d5c (L*40) |
| precast | #ac9688 | #66666f | #bf9c79 | #544f4d (L*34) |
| sand | #d1a97b | #827664 | #e7b06b | #6d5d43 |
| plywood | #996c3e | #59442d | #ab722f | #4d3619 |
| rust | #7f3d19 | #4c2315 | #8f430d | #431e0d |
| gabion | #927c6e | #535157 | #a48360 | #423b38 |

- **Lit/shade ratio:** the sunlit floor against the shaded floor is 2.04:1.
- **Kit contrast** (with the 0.35 character lift in §3.1):

| Background | Contrast |
|---|---|
| Lit floor | 6.75:1 |
| Shaded floor | 3.44:1 |
| Lit wall | 9.28:1 |
| Shaded wall | 3.00:1 |
| Shaded lane wall | 2.41:1 |
| Horizon | 13.4:1 |

- **Slots, sun / shade:**

| Slot | Sun | Shade |
|---|---|---|
| Red | #fb2d4c | #c50038 |
| Green | #08c30f | #00931c |
| Yellow | #fbcb35 | #dabe00 |
| Blue | #385ed9 | #0e41b8 |
| Orange | #fd7e3a | #d26400 |
| Purple | #b100b6 | #78009b |
| Cyan | #0ee1ef | #00afd3 |
| Magenta | #fd3acb | #cc00c8 |
| Lime | #d5f300 | #99c700 |
| Pink | #fe789a | #d85696 |

**Baked AO** (`world.js`, at load):
- Subdivide every visible face into a 0.5 m indexed grid. The outer faces of the perimeter walls use 2 m cells and skip AO.
- Each vertex casts 16 fixed cosine-weighted rays out to 1.5 m with the shared `rayBox`, against only the boxes whose AABB grown by 1.5 m contains the vertex.
- AO = max(0.4, 1 − 0.6 · mean(1 − t/1.5)).
- Flip the quad diagonal when ao00 + ao11 < ao01 + ao10 (0fps).
- AO lives in a float attribute `ao` (not `vertexColors`). Patch the Lambert shader right after `#include <aomap_fragment>`:
  `reflectedLight.indirectDiffuse *= vAo; reflectedLight.directDiffuse *= 0.85 + 0.15 * vAo;`
- **Sand drifts:** floor vertices with AO < 0.8 get attribute `sand` = 0.55 × min(1, (0.8 − AO)/0.4). After `map_fragment`, the diffuse colour mixes toward #d8c39a (linear) by `sand`.
- **Low preset:** 8 rays, plus one ray toward the sun stored as `sunVis`. With the shadow map off: `directDiffuse *= mix(0.24, 1.0, vSun)`.
- **Cost:** about 14k vertices and 23–24k triangles. 20–40 ms at load (Low: 10–20 ms). 0 ms per frame.

### 2.3 Sky and fog

**Sky dome:**
- BackSide sphere, radius 190 m, 32×16 segments (1.0k triangles), recentred on the camera's x/z every frame.
- Custom `ShaderMaterial`: `depthWrite:false`, `fog:false`, no tone mapping. The vertex shader sets `gl_Position.z = gl_Position.w`, and the fragment shader ends with `#include <colorspace_fragment>`. Colour uniforms are `THREE.Color`, so they are linear.
- `renderOrder` 1000 and opaque, so it draws after all opaque geometry: r186's painter sort compares `renderOrder` before `material.id`. About 0.10 ms.

**Gradient** by elevation e:
- From e = 0 to 30°: H(az) blends to #6a96d0.
- From 30° to 90°: #6a96d0 blends to #2b5aa8.
- H(az) = mix(#d6dbdf, #f3dcb8, w), where w = max(0, dot(horizontal view direction, horizontal sun direction))⁸.
- **Sun disc:** angular radius 0.8°, colour #fff6e0.
- **Halo:** add #ffe7c4 × 0.35 × smoothstep(cos 12°, cos 0.8°, cosθ)².

**Fog:**
- `THREE.Fog('#d6dbdf', 30, 160)`, radial after the patch, with smoothstep falloff.
- Haze: 0% at 30 m, 1.7% at 40 m, 10.4% at 56 m (far walls from a corner), 13.5% at 60 m, 27.7% at 75 m, 55.8% at 100 m.
- `scene.background` = #d6dbdf (clear colour only).
- Players, power-ups and FX use `fog:false`.
- The camera far plane stays at 200 m.

### 2.4 Landscape and skyline

From the arena centre (eye at 1.6 m), the wall top sits at 6.8° elevation. Anything outside must rise above 1.6 + 0.12·D m at distance D to be seen.

**Static skyline: one merged Lambert mesh with vertex colours.** It is fogged, ≤ 6k triangles, 1 draw, and lies entirely within 75 m. It also carries the wall-mounted solid props from §2.7.

| Element | Placement (x, z in m; azimuth clockwise from −z) | Size | Elevation from centre |
|---|---|---|---|
| Ground apron | 150 × 150 m outside the walls, y 0 | 10 m cells, #c2b59c with tyre tracks #a99c84 | hidden from inside the arena |
| Bench 1 (horseshoe, open from 200° to 290°) | Inner radius 46 m, 4 m deep | 4 m columns, top 9 m ± 1 m (0.5 m steps) | 9.1° |
| Bench 2 (same opening) | Inner radius 58 m, 6 m deep | Top 15 m ± 1.5 m | 13.0° |
| Bench 3 (only 330° to 120°) | Inner radius 68 m, 6 m deep | Top 21 m ± 1.5 m | 15.9° |
| Bench faces | 2.5 m strata bands #cdbfa6 / #c2b296 / #d6cab3 with 0.25 m seams #9a8d78; sand tops #d8c39a; scree cones #b9ab92 2–3 m tall at each foot | about 3.3k triangles for 167 columns | |
| Crusher tower (hero, backlit) | (−56, −20), azimuth 290°, 59.5 m | 10 × 26 × 10 m, rust #8a5a44, roof #45474c, window strips #2a2c30; "BOXFIRE QUARRY CO." sign 1.6 m tall (decal atlas) | 22.5° |
| Conveyor | From a hopper at (−34, −8) (9 m tall) up to the tower at 22 m | 2 m truss #45474c with #ad9862 rails | |
| Water tower | (52, 26) | 8-sided teal #4f8f8a tank, 8 m diameter, on 16 m legs, top 24 m | 21° |
| Floodlight masts | (±23, ±23) | 13 m × 0.4 m #45474c; lamp head 1.2 × 0.6 × 0.4 m #d9d4ca | |
| Stockpile cones | (24, −28) and (−26, 30) | Stepped voxel cones 14 m tall, #d8c39a and #cbb38a | |
| Containers, north (peek over the wall) | z −24.5, x from −12 to 6, 2 high | 6.1 × 2.6 × 2.44 m each; #8a5a44, #5f7f7c, #ad9862, #45474c | top 5.2 m, 1.6° above the wall |
| Containers, south | z 24.5, x from −14 to −4, 3 high | as above | top 7.8 m |
| Site cabin | (25, −10) on 2.6 m stilts | 6 × 3 × 2.5 m, #c9c3b8 with #45474c trim | top 5.6 m |
| Tanks | (26, 8) and (27, 14) | 8-sided, 3 m diameter, 6.5 m, #9d968a | |
| Haul truck (opening side) | (−24, 12) | 9 × 5.5 × 4.5 m, #ad9862 and #45474c | top 5.5 m |

None of these casts a shadow inside the arena: the tallest south stack's shadow ends at z 21.9 at the 4 m wall-top height.

**Far group.**
- Locked to the camera's x/z, with `fog:false`, colours pre-hazed toward #d6dbdf, and every vertex within 182 m of the camera.
- 3 draws, about 3k triangles, 0.15 ms.

| Element | Spec |
|---|---|
| Ridge and turbine towers (1 draw) | Ring band at 150–175 m, 30–45 m tall, seeded notched profile. Sunlit #d2d0c8, backlit #b5b3b2 (60% haze). Three turbine towers 40 m × 0.8 m with 3 × 2 × 2 m nacelles at 165 m, azimuths 215°, 245° and 275° (inside the opening) |
| Blades (1 draw) | InstancedMesh with 9 instances, each 14 × 1.2 × 0.4 m, #f3e7d4, 12 rpm (1.257 rad/s) |
| Clouds (1 draw) | 14 clusters of 3–5 boxes (12–30 m), 100–140 m out, 60–85 m up. Unlit with vertex colours: tops #ffffff, sides #e8eef5, sun-facing sides #fff1de, undersides #b3c0d4. Drift 1.5 m/s toward azimuth 60°, wrapping at 140 m |

**Dust motes:** 160 `Points` in a 24 m box around the camera, #fff2d6 at α 0.15, 2 px, drifting 0.15 m/s. 1 draw, 0.05 ms. First to cut.

### 2.5 Materials and procedural textures

**`client/textures.js`** builds canvas tiles at load.
- 32 px/m (crates 53 px/m).
- `colorSpace = SRGBColorSpace`, `magFilter = NearestFilter`, `minFilter = LinearMipmapLinearFilter`, mipmaps on, `anisotropy = min(4, renderer.capabilities.getMaxAnisotropy())`, `RepeatWrapping`.
- World-axis UVs (floor: x and z over the tile size; walls: x or z, and y), so seams line up across merged boxes. Crates use face-local UVs.
- Each material is one merged mesh: 6 draws. About 0.9 MB of map textures and about 0.35 MB of prop atlas, mipmaps included.

**Edge treatment, all map materials.** A face-local `edge` attribute holds (u, v, w, h) in metres. After `map_fragment`:
- d = min(u, w − u, v, h − v);
- d < 0.01 m: × 1.08 (chipped arris);
- d < 0.04 m: × 0.85.

| Material | Tile, px | Recipe |
|---|---|---|
| slab | 8 m, 256² | Base #b7b0a3, ±5% luminance noise, 3% speckles #9f988c/#cbc5ba. 2 px joints #8f887d on a 4 m grid; each 4 × 4 m slab ±3%. 2–3 hairline cracks (#9a9387, 20–60 px random walk) per tile |
| board | 4 m, 128² | Base #c9c3b8; 1 px #b9b3a8 board lines every 0.25 m, each board ±4%. Tie holes #7d776d, 2 × 2 px on a 1.2 × 0.6 m grid. Rain streaks #8f887d at α 10%, 20–60 px. Coping band #d9d4ca for the top 0.3 m; walls are exactly 4 m, so v = y/4 |
| precast | 2 × 3 m, 64 × 96 | Base #b5afa4; 2 px seams #8f887d at the 2 m panel edges. Teal band #5f7f7c at y 1.00–1.15 m (a height cue). 8% chipped pixels along seams #c9c3b8; lifting recesses 4 × 4 px #8f887d at y 2.6 m |
| plywood | 1.2 m face, 64², 2 × 2 atlas | Base #a38763; 0.3 m boards with 1 px #8c7253 gaps; 0.08 m frame battens and a diagonal brace #8c7253. Stencils "BX-01" to "BX-04" in #45474c on side faces; the variant is chosen by box index mod 4 |
| rust | 2 m, 64² | Base #8a5a44; vertical ribs every 3 px as a ±8% sine; blooms #6f4535 (4–10 px, 20% coverage); drip streaks |
| dock | 4 m, 128² | Sides: gabion stones #9d968a (6–12 px blobs, 1 px #6f685e outlines) behind a #45474c wire grid every 0.5 m at α 70%. Top: the slab recipe plus a 0.3 m hazard border of 45° stripes 0.15 m wide, alternating #ad9862 and #3a3c40, drawn from the face-local `edge` attribute |

**`arena_01.json` visual addition.** Keep `color`. Material index = `color`, and world falls back to this table when the field is missing:
```json
"materials": [
  { "name": "slab",    "base": "#b7b0a3", "accents": ["#8f887d", "#d8c39a"] },
  { "name": "board",   "base": "#c9c3b8", "accents": ["#d9d4ca", "#7d776d"] },
  { "name": "precast", "base": "#b5afa4", "accents": ["#5f7f7c", "#8f887d"] },
  { "name": "plywood", "base": "#a38763", "accents": ["#8c7253", "#45474c"] },
  { "name": "dock",    "base": "#9d968a", "accents": ["#ad9862", "#3a3c40", "#b7b0a3"] },
  { "name": "rust",    "base": "#8a5a44", "accents": ["#6f4535"] }
]
```

### 2.6 Map material assignment (arena_01, by box index)

| Boxes | What | Material | Draw order |
|---|---|---|---|
| 0 | Floor 40 × 1 × 40 | slab | `renderOrder` 1 (after walls, so early-z rejects hidden floor) |
| 1–4 | Perimeter walls | board | 0 |
| 5–8 | Lane walls 0.6 × 3 × 10 | precast | 0 |
| 9 | Platform 8 × 1.2 × 6 | dock | 0 |
| 10–15, 18–23, 25–28 | Crates, including the step crate (10), the long crates (21, 26) and the low crates (13, 22, 27) | plywood | 0 |
| 16, 17, 24, 29 | Stacked crate, barrier, pillars | rust | 0 |

Footstep surface: slab, board, precast and dock are "concrete"; plywood is "wood"; rust is "steel".

### 2.7 Decorative props

All props are non-colliding. Inside the arena they are flat on the floor (≤ 3 cm) or wall-hugging (≤ 8 cm) below 3.6 m, so nothing fakes cover. 2 draws, about 3k triangles, 0.2 ms. The solid wall props merge into the skyline mesh.

| Prop | Spec |
|---|---|
| Floor paint (decal draw) | Dashed #ad9862 lines 0.1 m wide at x = ±11 (1 m dashes, 0.5 m gaps, z from −18 to 18). A solid 0.1 m line 1 m inside each wall. Bay numbers "01" to "04", 1.2 m tall, #45474c at α 0.6, in the corners |
| Floor details (decal draw) | 10 drain grates 0.6 × 0.6 m #45474c at (±19, −12/−4/4/12) and (0, ±19). 16 cracks 0.5–1.5 m #8f887d at α 0.6. 6 oil stains 1–2 m #6b655c at α 0.35 near crates |
| Wall decals (decal draw) | "PIT 7" stencil, 2 m letters, #45474c at α 0.8, on the north wall's inner face at x 0, y 2.2 |
| Wall solids (in the skyline mesh) | Cable tray 0.1 × 0.08 m #45474c at y 3.3 m along the north and east inner faces; junction boxes 0.3 × 0.4 × 0.08 m every 6 m |
| Chain-link (1 draw) | 1.4 m fence on the perimeter wall tops (y 4.0–5.4); posts 0.06 m every 3 m #45474c. `alphaToCoverage:true` with MSAA; `alphaTest:0.5` when MSAA is off (Low). 64² tile |

Decals use `MeshLambertMaterial` (lit, receives shadows), `transparent:true`, `depthWrite:false`, `polygonOffset` −1/−4, and sit 0.005 m off the surface.

Pad plinths, pools and beams belong to powerups (§4.7).

---

## 3. Characters, first person, impacts and FX

### 3.1 Characters (`client/characters.js`)

**Render setup:**
- One unit-cube `InstancedMesh`: `MeshLambertMaterial` with `setColorAt`, `receiveShadow:true` (when shadows are on), `castShadow:false`, `fog:false`, `frustumCulled:false`.
- **Character lift:** `onBeforeCompile` adds `totalEmissiveRadiance += diffuseColor.rgb * 0.35` after `color_fragment`. This keeps slot hue in shade (values in §2.2).
- **Low preset:** visibility = mean of 3 rayBox samples toward the sun (y 0.4, 1.0 and 1.6 m), eased with a 150 ms halflife. Instance colours are scaled by 0.62 + 0.38 × visibility.

**Parts: 26 lit instances plus 1 unlit visor per player.** Standing, feet at y 0. Sizes are W × H × D in m. **S** marks the slot colour.

| Part | Size | Colour |
|---|---|---|
| Boots ×2 | 0.16 × 0.12 × 0.26 | #1b1d22 |
| Shins ×2 | 0.14 × 0.36 × 0.16 | #24272d |
| Knee pads ×2 | 0.15 × 0.10 × 0.04 | **S** |
| Thighs ×2 (hip at y 0.80, x ±0.10) | 0.17 × 0.42 × 0.19 | #24272d |
| Belt | 0.38 × 0.12 × 0.24 | #24272d |
| Torso (y 0.82–1.37) | 0.40 × 0.55 × 0.26 | **S** |
| Chest rig | 0.34 × 0.22 × 0.06 | #24272d |
| Pack | 0.30 × 0.40 × 0.14 | #c7b48e |
| Upper arms ×2 (shoulder x ±0.25, y 1.33) | 0.10 × 0.30 × 0.11 | #24272d |
| Armbands ×2 | 0.105 × 0.06 × 0.115 | **S** |
| Forearms ×2 | 0.09 × 0.26 × 0.10 | #24272d |
| Hands ×2 | 0.09 × 0.09 × 0.10 | #3a3d44 |
| Neck | 0.12 × 0.06 × 0.12 | #24272d |
| Head (y 1.42–1.66) | 0.26 × 0.24 × 0.26 | #24272d |
| Helmet (y 1.67–1.80) | 0.30 × 0.13 × 0.30 | **S** |
| Visor (unlit mesh, `toneMapped:false`) | 0.22 × 0.06 × 0.02 | **S** at full value |
| Gun: 3 boxes. Rifle receiver 0.06 × 0.09 × 0.42, mag 0.04 × 0.12 × 0.06, stock 0.05 × 0.08 × 0.16; pistol and shotgun use the same 3-box pattern with their own sizes | | #2e3136 |

**Fit to the hitbox:**
- Shoulder span including arms is ≤ 0.60 m (the hitbox width). The silhouette stays within 4 cm of the axis-aligned hitbox at any yaw.
- Slot colour covers about 30% of the front silhouette, mostly torso and helmet.
- Characters keep their own gun sizes and do not import from `viewmodel.js`.

**Outline:**
- BackSide hull of the 16 largest parts (boots, shins, thighs, belt, torso, pack, upper arms, forearms, head, helmet, gun receiver) in #15171c.
- Each hull grows by g = max(0.03, 0.0021 × d) m, where d is the camera distance. That is about 2 px at any range at 1080p and 90° hfov.

**Blob shadow:** instanced radial quad, 38% black, radius 0.42 m, scaled by 1/(1 + height above ground).

**Animation:**

| State | Spec |
|---|---|
| Run | Phase += π × distance / 2.2 m, one step per footstep sound. Thighs ±32°, knees flex up to 45° on the back-swing, torso bob 0.035 m per step, 5° forward lean at 5.5 m/s. Amplitude × speed / 5.5 |
| Strafe | Legs swing ±20° sideways |
| Airborne | Thighs +25°, knees +40° |
| Crouch (100 ms ease) | Hip 0.80 → 0.30 m, torso pitched 30° forward, head kept level, helmet top 1.20 m to match the 1.2 m hitbox |
| Aim | Head takes 100% of pitch, torso 30%; arms and gun take 100% about the shoulder pivot at y 1.33 |
| Fire (`fired(id)`) | Gun −0.05 m and +6°, returning over 90 ms |
| Hit flash, on any drop in snapshot `hp` (no protocol change) | Outline turns #ffffff and the body lerps 70% toward white for 60 ms, then back over 90 ms. Scale 1.06 for 60 ms. Flinch 0.04 m backward |
| Spawn | Parts assemble over 250 ms (ease-out from ±0.5 m offsets at scale 0) |
| Spawn protection (`shielded`) | 5 Hz pulse: outline #15171c ↔ #ffffff and body +25% white. This replaces today's 100 ms visibility blink |
| Death | The rig is removed; `effects.deathBurst` shatters it |

**Power-up attachments:**
- **`bubble`:** a sphere of radius 1.1 m centred at y 0.95 (0.65 crouched), #66fff0, normal blending, fresnel alpha 0.08 at the centre to 0.6 at the rim. Instanced, 1 draw, 384 triangles each.
- **`nitro`:** two boot ribbons 0.35 m wide covering 0.6 s of history, in the player's own slot colour, α 0.7 → 0, plus a #15171c fringe. 1 shared dynamic draw.
- **`slowed`:** 6 #ffb300 spark cubes, 0.04 m, crawling over the rig, in the unlit mesh.

**Name tags:**
- `nameTags()` returns screen positions; hud draws them in the DOM.
- A tag shows when the rig is within 4° of the crosshair or ≤ 12 m away, and only if a rayBox line from the camera to the head is clear.

**`?debug&lineup`:**
- Replaces the list with the 10 slot rigs in a row 0.9 m apart, with a fake 30 HP drop every 1 s to show the hit flash.
- The builder documents camera parameters for rows at about 10, 25 and 35 m, in sun (row at z 3, x −4.05…4.05) and in shade (row at x 9.6, z 5…13.1, inside the lane-wall shadow).
- A reviewer must be able to name every colour in every shot.

### 3.2 First person (`client/viewmodel.js`)

**Scene:**
- `viewScene` and `viewCamera` stay as today: 60° vertical, near 0.01, far 10, drawn after a depth clear.
- **Lights mirror `LIGHTS`** (§8.1) in camera space every frame. The sun direction is `inverse(camQuat) × sunDir`, and the hemisphere's up vector is rotated the same way.
- **Shade dimming:** the sun dims to 0.45× (150 ms ease) when the integrator's eye-to-sun `sunVis` is 0.

**Arms:**
- 1.15× third-person scale.
- Forearm 0.115 × 0.115 × 0.32 m #24272d, glove 0.105 × 0.105 × 0.115 m #3a3d44, armband 0.12 × 0.12 × 0.04 m in your own slot colour (`setArmband`).

**Guns:** one merged vertex-coloured mesh per weapon plus one moving child. Metal #2e3136, tan #b9a27a, dark #1b1d22.

| Gun | Boxes | Key parts (m) | Child | Rest position (camera space) |
|---|---|---|---|---|
| Rifle | 17 | Receiver 0.06 × 0.08 × 0.36; barrel 0.025 × 0.025 × 0.30; handguard 0.055 × 0.06 × 0.22; stock 0.05 × 0.08 × 0.20; grip 0.035 × 0.09 × 0.05 at 15°; sights; brake 0.035³; slot stripe 0.062 × 0.01 × 0.08 | Curved mag 0.045 × 0.14 × 0.07 | (0.20, −0.19, −0.60) |
| Pistol | 10 | Slide 0.035 × 0.04 × 0.19; grip 0.032 × 0.11 × 0.05 at 12° | Slide (recoils 0.03 m) | (0.17, −0.17, −0.50) |
| Shotgun | 14 | Barrel 0.035 × 0.035 × 0.42; tube 0.03 × 0.03 × 0.36; receiver 0.06 × 0.08 × 0.20; stock 0.05 × 0.09 × 0.24; 4 side shells #b33a2e | Pump 0.055 × 0.055 × 0.14 | (0.20, −0.20, −0.58) |

**Motion: critically damped springs, h = halflife.**

| Motion | Spec |
|---|---|
| Idle | ±3 mm at 0.25 Hz |
| Sway | 0.0008 rad per px of mouse, clamped ±3°, h 60 ms; look-lag position 0.6 mm/px, clamped ±3 cm |
| Strafe roll | −4° at full strafe speed, h 80 ms |
| Bob | Figure-8, 12 mm × 8 mm per 4.4 m (2 steps), × speed / 5.5 |
| Landing dip | −min(0.03, 0.006 × abs(vy)) m, 70 ms down and 140 ms back |
| Recoil (rifle / pistol / shotgun) | Back 35 / 50 / 90 mm; pitch 2.5° / 4° / 7°; random roll ±1.5°; h 45 / 60 / 90 ms |
| Reload (rifle; pistol uses the same fractions over 1.75 s) | From `arsenal.reload`, as a fraction of the reload: tilt 25° over 0–0.14, mag out 0.14–0.32, mag in 0.32–0.64 with a click, bolt slap at 0.76 |
| Shotgun reload | Per 0.5 s shell: tilt 10°, hand to port 0–0.25 s, insert 0.25–0.40 s, back 0.40–0.50 s |
| Pump | Racks 0.07 m from 300 to 560 ms after each shot |
| Weapon switch | When `arsenal.slot` changed: out over 0–150 ms (−0.25 m, −30°), in over 150–400 ms with 4% overshoot |
| Power lockout | If `switching > 0` and the slot did not change, play the power cast instead: 0.04 m dip and 4° roll over 120 ms (`powerCast`) |

**Muzzle flash:**
- Two crossed additive star quads (rifle 0.18 m, pistol 0.12 m, shotgun 0.28 m), #ffd27a to #ff8a3d, random roll, shown for 2 frames.
- A 0.5 m glow sprite for 50 ms and an emissive pulse #ff9a4a on the barrel boxes for 40 ms.
- The viewScene hemisphere light rises 30% for 40 ms. No PointLight.

**Own casings:** 16 pooled in viewScene.
- Brass 0.012 × 0.035 m (pistol 0.01 × 0.022); shotgun shells 0.024 × 0.06.
- Ejected right at 2 m/s and up at 1.6 m/s, spinning 15 rad/s, living 0.45 s.

### 3.3 Impacts and FX (`client/effects.js`)

**Pools** (Low preset values in parentheses):

| Pool | Size | Notes |
|---|---|---|
| Cubes | 1,024 (512) | Lambert `InstancedMesh` with instance colours; swap-remove so `count` = live cubes; `frustumCulled:false`; `castShadow:false` |
| Sparks | 512 (256) | `Points` |
| Dust | 256 (128) | `Points` |
| Decals | 256 (128) | Instanced quads |
| Streaks | 256 | Normal-blended instanced quads with a 4-cell atlas: tracer, beam, ring and puff |
| Glows | 64 | Additive |

That is 6 draws.
- **Blending:** normal blending everywhere except muzzle flashes and blast glows.
- **Camera-near fade:** particles fade to 0 between 1.5 and 0.3 m from the camera.

**Classifying a shot end** (`shot()`):
1. If the end is within 0.02 m of a target hitbox (head tested first), it is a player hit. A target with `bubble` gives a shield hit.
2. Else, if it lies on a map box face (within 0.005 m), take that face's normal and the material at `map.materials[box.color]`.
3. Else it is the end of range: no impact.

**Effects:**

| Event | Spawns | Size | Motion | Life | Colour |
|---|---|---|---|---|---|
| Concrete hit (rifle / pistol / pellet) | 5 / 4 / 2 chips (≤ 12 per shot event), 1 puff (≤ 3 per shot event), 1 decal | Chips 0.025–0.05 m; puff 0.25 → 0.6 m | 2–4 m/s, gravity 20 m/s² | Chips 0.6–1.0 s; puff 400 ms | Material base ±8%; puff #d9d2c4 at α 0.5 |
| Wood | 4 splinters + decal | 0.015 × 0.015 × 0.06 m | 2–3 m/s | 0.8 s | #c6a77a |
| Steel (rust) | 6 sparks + decal | 3 px | 6–10 m/s | 200 ms | Core #fff1c9, rim #ff8a3d, edge #3a2a20 |
| Player body / head | 4 / 7 cubes | 0.04–0.07 m | 1.5–3 m/s | 0.5 s | Slot colour, plus 1 white cube |
| Shield hit | 5 hexagon sparks | 0.05 m | 3–5 m/s | 250 ms | #66fff0 with a #15171c edge |
| Decals | Ring buffer | 0.07 / 0.06 / 0.045 m | – | Until recycled | Concrete #2a2724 with #e4ded2 halo; wood #3a2a1a with #c6a77a; steel #2a2a2a with #b0b0b0 |
| Tracers | 1 per pellet | 3.0 / 2.0 / 1.5 m long; width 0.02 m + 0.0012 m per m of distance | 400 m/s | Until impact | Core #fff1c9 fading to a #ffb85c tail at α 0; fringe #3a2a20 at α 0.45 |
| Bolt beam | 1 per bolt | 0.06 m + 0.001 m per m of distance; zigzag ±0.05 m every 0.5 m | Instant | 140 ms | Core #e8f4ff, body #2e9bff, fringe #15171c at α 0.4 |
| Muzzle, others | Star + glow | 0.35 m star, 0.6 m glow | – | 50 ms | #ffd27a → #ff8a3d, additive |
| Casings, others (within 15 m, Default preset only) | 1 per shot | As in §3.2 | Right 2 m/s, up 1.6 m/s; 1 bounce at restitution 0.3 | 2 s | Brass / shell |
| Blast (Shunt, Mine) | 24 voxels, ring, glow, 8 puffs, scorch | Voxels 0.08–0.16 m; ring grows 0 → r in 180 ms (0.3 m band); glow 0.5 → 3 m | Voxels 3–8 m/s | Glow 300 ms, voxels 1.2 s, scorch 20 s | Voxels #45474c / #ad9862 / item hue; ring item hue to white; glow #ffd27a (additive); scorch 1.6 m #2a2522 at α 0.6 |
| Barge | Ring band | 0 → 5 m in 180 ms; 0.4 m tall, 0.25 m thick | – | 300 ms | #a070ff with a white leading edge |
| Shock strike | Beam, ground ring, 16 sparks | Beam 30 m × 0.6 m; ring 2.5 m | – | 250 ms | #ffb300 with a #ffffff centre (additive core) |
| Fizzle (radius 0) | 6 puffs, 4 voxels | 0.3 m | – | 400 ms | #9a9fa8 |
| Death burst | 120 voxels of about 0.1 m in the part colours, 12 puffs, 1.2 m white flash for 80 ms. On a headshot the helmet pops off whole at 6 m/s and 720°/s | – | 1.5–4 m/s radial, +2 m/s up, +3 m/s along the shot; gravity 20 m/s², restitution 0.3 | 2.5–3.5 s, shrinking over the last 0.6 s | Part colours |
| Pickup | 10 cubes and a 1 m ring | 0.05 m | 2 m/s | 300 ms | Item hue |

Screen effects are DOM (hud, §6), and camera shake belongs to feel (§5).

---

## 4. Power-ups

### 4.1 Rules
- **Inventory:** up to 3 items. **Q** uses the selected item (`KEY.USE` 256) and **E** cycles (`KEY.CYCLE` 512). Both bits are latched in `EDGES`. `decodeClient` already accepts k ≤ 0xffff, so the wire format does not change.
- **Between uses:** 1 s cooldown (60 ticks). Using is allowed while reloading. Using ends spawn protection.
- **Gun lockout:** every use sets `arsenal.switching = max(switching, 0.25 s)`, or 0.55 s for Bolt. This reuses the existing fire gate; the viewmodel plays the power cast, not a weapon swap.
- **Pickups:** a full inventory ignores pads. Death clears the inventory. Pickups never heal; there is no Repair.
- **Immunity:**
  - Owners are never hurt by their own power-ups (`damage()` starts with an `attacker === victim` guard).
  - Spawn protection blocks power-up damage, knockback and slow.
  - While a Shield holds, a hit's knockback and slow are ignored.
- **Ids stay separate:** power-up ids never enter `WEAPON_IDS`.

### 4.2 The seven

The numbers live in `POWERS` in `shared/constants.js`.

| Item | Glyph | Behaviour | Counterplay |
|---|---|---|---|
| **Shunt** #ff2a1a | Arrowhead | Homing rocket from the eye along the aim at 18 m/s. Max turn 110°/s (9.4 m turn radius). Life 4 s. **Lock at launch:** the living enemy with the smallest angle to the crosshair within 25° and 40 m, with a clear rayBox line from eye to chest; none means it flies straight. Homes on the chest (feet + 1.0 m, crouched + 0.7 m). Drops the lock if line of sight is blocked for more than 0.5 s or the target dies. **Direct hit:** within 0.6 m of any enemy body box, 60 damage plus knock 7 m/s along the flight with lift 5. Also detonates on touching the map or at 4 s. **Splash:** 2.5 m, 40 → 10 to everyone except the direct victim and the owner, line of sight from the blast, knock 3.5 m/s and lift 2.5 × (1 − 0.4·d/r) | One bullet fizzles it (a 0.5 m cube tested at its rewound position). Barge clears it. A Shield absorbs exactly 60. Corners beat its turn radius |
| **Bolt** #2e9bff | Lightning | 3 hitscan bolts at 0, 0.25 and 0.5 s. Each uses the aim of the input it fires on, with zero spread. Rewound with `history.at(rt)` like guns. 25 damage each, no head multiplier, 200 m range. Can shoot down Shunts and Mines. Gun locked 0.55 s | Tracking test; cover; Shield |
| **Barge** #a070ff | Octagon ring | Instant wave from the user's chest: 5 m radius, line of sight required. Damage 20 → 10. Knock 9 m/s outward with lift 5.5, × (1 − 0.4·d/r). At the centre it throws a victim 5.8 m (3.5 m if they hold against it), airborne 0.55 s with a 0.76 m apex. Destroys enemy Shunts and Mines within 5 m (they fizzle) | Distance; a Shield blocks the knock |
| **Shock** #ffb300 | Dome | **Target:** the highest-ranked living enemy by `byScore`, skipping the user. **Domes:** 3, centred at target position + target velocity × (1.2, 1.6, 2.0) s, clamped to abs(x) and abs(z) ≤ 19.4, at the target's y when cast. They strike at 1.2, 1.6 and 2.0 s. **Strike:** hits everyone except the owner within 2.5 m horizontally and −1/+2.5 m vertically: 30 damage, once per player per cast; slowed ×0.6 for 2 s; Nitro removed. **No target:** the domes land 15 m ahead along the aim | Change course: 5.5 m/s for 1.2 s covers 6.6 m. A Shield blocks the damage and the slow |
| **Mine** #ffffff, LED #ff2a1a | Spiked disc | **Placement:** dropped at the feet (rayBox down to the surface below). Arms after 0.8 s. Lives 40 s. At most 2 per owner; dropping a third removes the oldest. **Trigger:** an enemy within 1.2 m horizontally (abs(dy) < 1.5 m) starts a 0.25 s fuse. **Blast:** 2.5 m, 60 → 15, knock 5 m/s with lift 6, × (1 − 0.4·d/r), line of sight from the blast. **Shootable:** a static 0.5 × 0.3 × 0.5 m box with 1 HP; any player's shot detonates it, credited to that shooter | The trigger ring is drawn for everyone within 12 m. Running through at 5.5 m/s carries you 1.375 m past the trigger during the fuse, so reverse to escape. Or shoot it |
| **Nitro** #3dff8f | Double chevron | 4 s at ×1.4 run speed (7.7 m/s). Jump height unchanged at 1.0 m. Spread unchanged, because `spreadDegrees` caps the speed term at 1. Own FOV +6° | Shock removes it |
| **Shield** #66fff0 | Hexagon | 60 hp overshield for 8 s, absorbed before HP | Two rifle body hits (60) break it. A 160 rifle headshot still kills from 100 HP + 60 |

### 4.3 Pads on arena_01

Pads live in `POWER_PADS` in `shared/constants.js`, not in the map JSON, because the JSON is world-owned.
- The pickup trigger is the shared `overlaps()` against a 1.6 × 2.0 × 1.6 m box standing on the pad.
- Clearance is the horizontal distance to the nearest box taller than the pad. Every value below was verified with `prepareMap` and `overlaps`.

| Index | Position (x, y, z) | Pool (rotates per pickup) | Respawn | Clearance | Nearest spawn |
|---|---|---|---|---|---|
| 0 | (0, 0, 0) | Shunt | 30 s | 2.40 m | 10.30 m |
| 1 | (3, 1.2, 13), on the platform 1.0 m from its edge | Shield | 30 s | 4.70 m | 4.24 m |
| 2 | (0, 0, −10.5) | Shock | 40 s | 3.20 m | 5.22 m |
| 3 | (8, 0, 0), east lane gap | Barge, then Bolt | 20 s | 3.49 m | 6.00 m |
| 4 | (−8, 0, 0), west lane gap | Bolt, then Barge | 20 s | 3.49 m | 6.00 m |
| 5 | (17, 0, −6) | Nitro | 20 s | 3.00 m | 6.32 m |
| 6 | (−17, 0, 6) | Nitro | 20 s | 3.00 m | 6.32 m |
| 7 | (16, 0, 8) | Mine | 30 s | 3.40 m | 8.25 m |
| 8 | (−16, 0, −8) | Mine | 30 s | 3.40 m | 8.25 m |

- **Rate with 6 or more players:** 21.5 items/min (per minute: Shunt 2, Shield 2, Shock 1.5, Barge 3, Bolt 3, Nitro 6, Mine 4). With 10 players that is 2.15 per player per minute.
- **Scaling:** respawn ticks = base × 60 × min(3, max(1, `POWER_RATE_PLAYERS` (6) / n)), where n is the number of players with a mover. The stretch is capped at 3× (the user's call, 15/10/2026): a 20–30 s pad refills in 60–90 s with 1 player, not 2–3 min, and the Shock pad in 120 s.
- **Rotation:** after a pickup, the pad's refill clock fills in the next item's hue until it respawns (§4.7; the hologram is gone). Match start resets every pad to "up" at pool index 0.
- **Ties:** when two players overlap a pad in the same tick, the first in `players` map order gets the item.

### 4.4 Authority, prediction and movement

**Contract values: shipped in commit C0 (§8.0), tuned only by powerups.**

```js
// shared/constants.js — POWER-UPS
export const POWER_COLORS = { shunt: '#ff2a1a', bolt: '#2e9bff', barge: '#a070ff', shock: '#ffb300', mine: '#ffffff', nitro: '#3dff8f', shield: '#66fff0' };
export const POWER_CAPACITY = 3;
export const POWER_USE_SECONDS = 1;
export const POWER_GUN_LOCK = 0.25;
export const POWER_BOLT_GUN_LOCK = 0.55;
export const POWER_RATE_PLAYERS = 6;
export const POWER_PAD_BOX = [1.6, 2, 1.6];
export const COYOTE_TICKS = 5;
export const JUMP_BUFFER_TICKS = 6;
export const KNOCK_MAX = 12; // m/s horizontal after any knock
export const POWERS = {
  shunt: { speed: 18, turn: 110, life: 4, cone: 25, range: 40, proximity: 0.6, direct: 60, splash: 2.5, splashMax: 40, splashMin: 10, knock: 7, lift: 5, box: 0.5 },
  bolt: { shots: 3, gap: 0.25, dmg: 25 },
  barge: { radius: 5, dmgMax: 20, dmgMin: 10, knock: 9, lift: 5.5 },
  shock: { domes: 3, lead: 1.2, step: 0.4, radius: 2.5, dmg: 30, slow: 0.6, slowSeconds: 2 },
  mine: { arm: 0.8, trigger: 1.2, fuse: 0.25, radius: 2.5, dmgMax: 60, dmgMin: 15, knock: 5, lift: 6, life: 40, perOwner: 2, box: [0.5, 0.3, 0.5] },
  nitro: { seconds: 4, speed: 1.4 },
  shield: { hp: 60, seconds: 8 },
};
export const POWER_PADS = [
  { pos: [0, 0, 0], pool: ['shunt'], respawn: 30 },
  { pos: [3, 1.2, 13], pool: ['shield'], respawn: 30 },
  { pos: [0, 0, -10.5], pool: ['shock'], respawn: 40 },
  { pos: [8, 0, 0], pool: ['barge', 'bolt'], respawn: 20 },
  { pos: [-8, 0, 0], pool: ['bolt', 'barge'], respawn: 20 },
  { pos: [17, 0, -6], pool: ['nitro'], respawn: 20 },
  { pos: [-17, 0, 6], pool: ['nitro'], respawn: 20 },
  { pos: [16, 0, 8], pool: ['mine'], respawn: 30 },
  { pos: [-16, 0, -8], pool: ['mine'], respawn: 30 },
];
// PLAYER_COLORS slot 9: '#fabed4' -> '#ff7eb6'
```

**Shared power state, `shared/powerups.js`.** It runs once per input, after `stepWeapon`, in three places: the server loop, `predict()` and the `reconcile()` replay.

```js
export const createPowers = () => ({ inv: [], sel: 0, cd: 0, shield: 0, shieldT: 0, bolts: 0, boltT: 0 });
// Returns 'shunt'|'barge'|'shock'|'mine'|'nitro'|'shield' on the step an item is used,
// 'bolt' on each of the 3 Bolt shots (the first on the use step), else null.
export function stepPowers(pw, mover, arsenal, input) {
  if (pw.cd > 0) pw.cd--;
  if (pw.shieldT > 0 && --pw.shieldT === 0) pw.shield = 0;
  if (input.keys & KEY.CYCLE && pw.inv.length > 1) pw.sel = (pw.sel + 1) % pw.inv.length;
  if (pw.bolts > 0 && --pw.boltT <= 0) { pw.bolts--; pw.boltT = BOLT_GAP_TICKS; return 'bolt'; }
  if (!(input.keys & KEY.USE) || pw.cd > 0 || pw.bolts > 0 || !pw.inv.length) return null;
  const kind = pw.inv.splice(pw.sel, 1)[0];
  pw.sel = Math.min(pw.sel, Math.max(0, pw.inv.length - 1));
  pw.cd = USE_TICKS; // 60
  arsenal.switching = Math.max(arsenal.switching, kind === 'bolt' ? POWER_BOLT_GUN_LOCK : POWER_GUN_LOCK);
  if (kind === 'nitro') mover.boost = NITRO_TICKS; // 240
  if (kind === 'shield') { pw.shield = 60; pw.shieldT = 480; }
  if (kind === 'bolt') { pw.bolts = 2; pw.boltT = BOLT_GAP_TICKS; } // 15
  return kind;
}
// Also exported (pure, tested): falloff(d, r, max, min), domeCentres(x, y, z, vx, vz),
// lockTarget(eye, dir, candidates, boxes) -> id|null, padRespawnTicks(pad, n)
```

**Movement changes (`shared/movement.js`).** Every change is commented `// POWER-UPS` or `// FEEL`.
- `createMover` gains `boost: 0, slow: 0, coyote: 0, jumpBuf: 0`. These are integer ticks.
- `me.mover` is already sent whole, so the fields reconcile with no extra code.
- In `step()`:
  - speed × (boost > 0 ? 1.4 : 1) × (slow > 0 ? 0.6 : 1);
  - `if (keys & KEY.JUMP) s.jumpBuf = JUMP_BUFFER_TICKS`;
  - jump when `(s.grounded || s.coyote > 0) && s.jumpBuf > 0`, then zero both `jumpBuf` and `coyote`;
  - at the end: `coyote = grounded ? COYOTE_TICKS : max(0, coyote − 1)`, `jumpBuf = max(0, jumpBuf − 1)`, and `boost` and `slow` count down by 1.
  - `coyote` starts at 0, so "jump only works from the ground" keeps passing.
- New export:
```js
export function knock(s, vx, vz, lift) { // horizontal impulse adds; lift only when grounded
  s.vx += vx; s.vz += vz;
  const h = Math.hypot(s.vx, s.vz);
  if (h > KNOCK_MAX) { s.vx *= KNOCK_MAX / h; s.vz *= KNOCK_MAX / h; }
  if (s.grounded) { s.vy = Math.max(s.vy, lift); s.grounded = false; }
  s.coyote = 0; s.jumpBuf = 0;
}
```
- Every lift is ≤ 6 m/s, below the jump velocity of 6.32. No knock adds height to an airborne player, so no new surface becomes reachable.

**Required movement tests** (new file `shared/powerups.test.js`; existing test files stay unchanged):
1. An apex Barge off a 1.2 m crate never reaches y ≥ 2.4 (the pillar tops) and stays ≤ 2.2.
2. A Nitro running jump from the 1.2 m crate toward the pillar at (17, 1.2, 0) never exceeds 2.2.
3. A grounded knock with lift 6 has an apex ≤ 0.90 m.
4. A knocked player pressing jump within 5 ticks does not jump.
5. Coyote: after walking off a 1.2 m ledge, a jump within the first 5 airborne ticks works; at 6 or later it fails.
6. Buffer: jump pressed 6 ticks before landing fires on landing; 7 ticks before does not.
7. Speeds: boost runs at 7.7 m/s, slow at 3.3 m/s, both at 4.62 m/s; timers count down once per step.
8. Determinism: 600 seeded random inputs on two movers give `deepEqual` states.
9. `stepPowers`:
   - cycling;
   - a use pops the selected item and clamps `sel`;
   - 60-tick cooldown;
   - gun lock of 0.25 s, or 0.55 s for Bolt;
   - Bolt returns 'bolt' on ticks 0, 15 and 30;
   - the shield expires after 480 ticks.
10. Protocol: an input with k = 768 decodes.

**Server tick order (`server/game.js`, playing phase):**
1. For each player and each input: `step` → `stepWeapon` (→ `fire`) → `stepPowers`. If the result is not null: `powers.use(p, kind, input)` and `p.protectedUntil = 0`.
2. `powers.step()`, in this order:
   - pad pickups (alive players, AABB overlap);
   - Shunts move 0.3 m per tick (home, collide, proximity);
   - mines arm, trigger and fuse;
   - dome strikes;
   - finally, the damage and knocks queued in this tick, in queue order.
3. `history.record`, then `sendSnapshots`.

**Prediction and reconciliation:**
- The client predicts its own uses, cycling, cooldown, Nitro, its Shield timer and its Bolt shots.
- Pickups, damage and knocks are server-only and reach the client through the snapshot (`me.pw`, `me.mover`).
- `reconcile` copies `me.pw` and replays pending inputs through `stepPowers`.
- **Results are acted on only in `predict()`, never inside the replay loop.** That covers ghosts, Bolt beams, sounds and casts.
- A knock correction of 0.3–0.5 m is hidden by correction smoothing (§5).

**Own-use ghosts (client):**
- **Shunt:** a ghost rocket flies straight from the muzzle at 18 m/s. When the server entity with this owner appears, the ghost blends into it over 100 ms. If none appears within 300 ms, the ghost fades out.
- **Mine:** a ghost puck at the feet.
- **Barge:** a local ring via `effects.blast`. The server's `boom` for your own Barge is skipped.

**Event timing:**
- Events from other players (`pick`, `use`, `boom`) play when `renderTick ≥ event.tick`, so a blast lines up with its interpolated rocket.
- Your own events play on arrival.

### 4.5 Protocol additions (`shared/protocol.js`; client messages unchanged)

| Item | Wire format |
|---|---|
| Flags (C0) | `PLAYER_FLAGS = { CROUCH: 1, ALIVE: 2, SHIELDED: 4, BUBBLE: 8, NITRO: 16, SLOWED: 32 }`. SHIELDED stays spawn protection; BUBBLE is the power-up Shield |
| Ids (C0) | `POWER_IDS = ['shunt','bolt','barge','shock','mine','nitro','shield']`, `ENT = { SHUNT: 0, MINE: 1, DOME: 2 }` |
| Input | k bit 256 = USE, 512 = CYCLE |
| Snapshot `me.pw` | `{inv:['shunt',…], sel, cd, shield, shieldT, bolts, boltT}`, using strings |
| Snapshot `pu` (every tick; stringified once per tick like `ps`) | `{pd:[[k, readyTick, spanTicks] ×9], en:[[eid, type, owner, x, y, z, a, b], …]}`. k is a `POWER_IDS` index. `readyTick` 0 means the pad is up. Positions are rounded to 0.01 m. Shunt rows: a = target id (0 = none), b = 0. Mine rows: a = state (0 arming, 1 armed, 2 fused). Dome rows: a = strike tick, b = target id. Under 600 B with 9 pads and 6 entities. A rejoining tab sees everything on its first snapshot |
| Event `pick` | `{e:'pick', id, pad, k:'nitro', tick}` |
| Event `use` | `{e:'use', id, k, x, y, z, tick}` |
| Event `boom` | `{e:'boom', k, x, y, z, r, id, eid, tick}`. `id` is the credited player; r = 0 means a fizzle |
| Event `hit` (extended) | Adds `w` (weapon or power id), `sh` (damage absorbed by a Shield, if any), and `sx`, `sz` (blast source for power damage) |
| Event `kill` | `w` may be a power id |
| Event `shot` | `w:'bolt'` for Bolt shots (`h` has one end) |
| Lobby | `players[].pk` (power-up kills) |

### 4.6 Balance
- **Gunplay:** rifle time to kill is 300 ms (4 body hits) out to about 29 m, 400 ms (5) beyond; every rifle headshot (160) kills at any range. No single use kills from 100 HP. The maximums are Shunt direct 60, Mine centre 60, Bolt 75 (all three hits), Shock 30 and Barge 20.
- **Combos:**
  - Shunt or Mine plus 1 rifle body hit = 90, no kill; plus 2 = 120.
  - Bolt plus 1 body hit = 105.
  - Barge plus 3 body hits = 110 (2 make 80), and the victim is airborne with doubled spread.
- **Each use costs the gun:** 0.25 s (Bolt 0.55 s), about 2.4 or 5.4 rifle rounds.
- **Shield:** 160 effective HP. 6 rifle body hits, or 1 headshot (160), kill.
- **Kill-share target:** power-up kills ≤ 25%. The server logs `power-up kill share: N%` at match end, and the scoreboard shows PWR.
- **Tuning order if over target:** respawns × 1.5, then cut Shock, then cut Bolt.

### 4.7 Look, HUD and kill-feed icons

| Element | Spec | Owner |
|---|---|---|
| Plinth | 1.6 m disc, 0.03 m tall, #45474c with a 0.08 m #ad9862 rim; lit, instanced | powerups |
| Pool | 1.4 m radial decal in the item hue with a light core, α 0.85 held to half the radius, 0.005 m above the surface. Only while an item is up | powerups |
| Glyph | 0.08 m voxels on a 7 × 7 grid (0.56 m). Item hue outside, #ffffff core voxels, #15171c hull at ×1.25. Floats 1.0 m above the pad, spins 90°/s, bobs ±0.08 m at 0.5 Hz. Unlit, `toneMapped:false` | powerups |
| Rule | **A beam and a full glyph mean an item is on the pad; anything else means it is empty.** The pad's state is the server's (`pd` ready 0), never the client clock. Deviation from §1, logged 15/10/2026: the beam marks an item, not a pad | powerups |
| Beam | Only while an item is up. Two crossed quads 0.15 m × 6 m (clear of the 3 m lane walls by 3 m). Normal blending: item-hue core at α 0.75 → 0 at the top, 0.04 m white centre line at α 0.8, 0.02 m #15171c fringes at α 0.35 | powerups |
| Refill clock | While a pad refills: no glyph, no beam. A standing clock at glyph height (1.0 m), facing the camera by yaw: radius 0.4 m × clamp(distance / 18, 1, 1.6), a #15171c fringe, a 0.24 r band filled clockwise from 12 o'clock in the next item's hue (#45474c unfilled), and a #15171c plate at α 0.78 with the whole seconds left in a 3 × 5 voxel font, #f2efe8, never 0. It fades out from 1.6 to 0.9 m away (on the pad, the HUD chip has the number). A floor clock (band 0.22, clear centre) replaces the pool; the plinth dims to #8c919e. Last 3 s: the digits take the hue and the clock pulses ±8% at 2 Hz. A numeric timer is new to this table (deviation, 15/10/2026) | powerups |
| Taken, up again | Taken: the glyph collapses to (1 − k)² over 150 ms, then the clock shows. Up again (visual only, on the server's edge): the beam rises 0 → 6 m over 220 ms at 2× width settling over 400 ms, the glyph springs 0 → 1.2 → 1 over 300 ms, and a 1.6 m floor ring flashes | powerups |
| Shunt rocket | 0.25 × 0.25 × 0.6 m in the item hue with a white nose voxel and outline. Ribbon trail 0.3 m × 2.5 m in the item hue, α 0.6 → 0, with a dark fringe. Oriented along its interpolated velocity | powerups |
| Mine | 0.5 m × 0.12 m puck #45474c with a white top ring. LED 0.06 m #ff2a1a: 1 Hz when armed, 8 Hz when fused. Trigger ring 1.2 m, dashed white at α 0.5, visible within 12 m | powerups |
| Shock telegraph | 2.5 m floor ring #ffb300 at α 0.6, pulse rising from 2 to 8 Hz over 1.2 s, with a 0.05 × 6 m centre marker | powerups |
| Bubble, Nitro ribbons, slowed sparks | §3.1 | characters |
| HUD icons | 24 × 24 inline SVG of each glyph in the item hue | hud |
| Kill feed | 18 px SVG for rifle, pistol and shotgun silhouettes, a cracked helmet for headshots, and the Shunt, Bolt, Barge, Shock and Mine glyphs in their hues | hud |

### 4.8 Power-up audio (`client/audio.js`)

| Sound | Synthesis |
|---|---|
| Pickup | Your own only, at your ear. 3 sines at 0 / 40 / 80 ms with 250 ms decay. Root by item: Shunt 523 Hz, Bolt 587, Barge 659, Shock 698, Mine 784, Nitro 880, Shield 988; then a major third and a fifth above |
| Pad taken (others' pick) | Spatial at the pad, −20 dB: sine 262 Hz for 0.12 s plus noise high-passed at 3 kHz for 0.06 s at gain 0.4. Others' picks get no chime and no burst (15/10/2026) |
| Pad empty (yours) | Dry, −17 dB: triangle 494 Hz for 0.07 s, then 370 Hz at 0.075 s for 0.09 s. Plays as you step onto a refilling pad, or when someone else takes the pad you stand on |
| Pad full (yours) | Dry, −15 dB: two square ticks at 880 Hz, 25 ms, at 0 and 0.06 s, over a 140 Hz thud of 0.05 s. Plays as you step onto an up pad with 3 items |
| Shunt launch | Noise band-pass sweeping 900 → 2200 Hz over 0.4 s; the flight hiss loops spatially |
| Shunt lock (target only) | 1.6 kHz beeps, 30 ms long, 3 → 9 per second as distance closes from 40 to 0 m |
| Bolt | Square wave 1.9 kHz → 350 Hz over 140 ms plus a noise crackle |
| Barge | 45 Hz sub plus a 300 → 80 Hz whomp, 350 ms |
| Shock | Telegraph whine 400 → 1600 Hz over 1.2 s, louder for the target. Strike: 3 kHz noise for 80 ms plus a 110 Hz buzz for 300 ms |
| Mine | Drop clunk 200 Hz for 60 ms; arming click 2 kHz for 15 ms; fuse beeps at 8 Hz; blast: noise low-passed at 600 Hz for 0.5 s plus a 50 Hz thump |
| Nitro | Sawtooth spool 220 → 660 Hz over 300 ms through a low-pass |
| Shield | On: 1.2 / 1.8 / 2.4 kHz shimmer, 400 ms. Break: noise high-passed at 4 kHz, 200 ms |
| Fizzle | Noise low-passed at 800 Hz, 150 ms |
| Pad hum | 110 Hz sine at −32 dB for the 2 nearest pads within 8 m |

---

## 5. Feel

| Item | Spec | Owner |
|---|---|---|
| Correction smoothing | `reconcile` returns delta d. The integrator shifts `prev` by d; `addCorrection(d)` makes the camera offset start at −d and decay with a 50 ms halflife. Above 2 m (`SNAP_DISTANCE`) it snaps and resets | feel + integrator |
| Camera bob | Translation only, so the aim never moves. 8 mm dip per footstep (one cycle per 2.2 m), timed so the low point meets the footstep sound. Roll ±0.2° alternating per step. Scales with speed/5.5 and fades over 150 ms. Off in the air and below 3 m/s. Setting "View bob", default on | feel |
| Landing dip | Camera −min(0.06, 0.009 × abs(vy)) m, 70 ms down and 140 ms back; a 1 m jump dips 0.057 m | feel |
| Recoil recovery | Kick per shot as today (`WEAPONS.kick`). 120 ms after the last shot, return 70% of the kick the player has not already pulled down, with a 90 ms halflife. Acceptance: a 10-round rifle spray with no mouse input settles at 30% ± 3% of the total kick after 500 ms | feel |
| Shake | Blasts within 8 m add trauma (1 − d/8) × 0.8, decaying 1.5 per s. Roll 1.5° × trauma² plus translation ±6 cm × trauma², with no pitch or yaw, so the aim ray never moves | feel |
| Nitro FOV | +6°, eased in over 150 ms and out over 300 ms | feel → `render.setFovKick` |
| Dynamic crosshair | Gap = 3 + (H/2) × tan(spread)/tan(vfov/2) px, using `spreadDegrees` on the predicted mover and the camera's vertical FOV, eased over 40 ms. At 1080p and 90° hfov: rifle 5.5 px standing (about 39 at full spray bloom), 44.9 running, 87 airborne. A shot adds a +3 px pulse for 80 ms (not spread). The shotgun adds a ring at the gap radius | hud + integrator |
| Jumping | 5-tick coyote time and 6-tick jump buffer (§4.4) | powerups (shared) |
| Viewmodel springs | §3.2 | viewmodel |
| Gunshots | 8 ms transient at 4 kHz (band-passed noise; skipped beyond 25 m), over today's body (rifle 2200 Hz for 0.13 s, pistol 3200 Hz for 0.08 s, shotgun 900 Hz for 0.3 s). Sine thump 90 → 45 Hz over 120 ms (shotgun 70 → 35 Hz over 180 ms). Quarry slapback: one shared `DelayNode` at 180 ms, −14 dB, low-passed at 1.5 kHz | audio |
| Hits | Body 1.3 kHz tick, 50 ms. Head 1.9 kHz plus a 4.5 kHz tink, 70 ms. Shield 2.4 kHz triangle ping, 60 ms | audio |
| Kill | 600 → 300 Hz square "ka-chunk" (two blips 40 ms apart) plus a 90 Hz thump | audio |
| Footsteps | Noise bursts band-passed at 1.8 kHz on concrete, 600 Hz on wood, 1.2 kHz on steel, chosen by `world.surfaceAt` | audio |
| Landing | 70 Hz thump, gain × min(1, abs(vy)/6.3) | audio |
| Casings | 4.2 kHz tink 380 ms after an own shot | audio |
| Ambience and mix | Looped wind (noise band-passed 300–600 Hz, 0.1 Hz LFO) at −30 dB. Master compressor: threshold −12 dB, ratio 4, attack 3 ms, release 120 ms. Master gain 0.6. At most 48 voices, oldest stolen first | audio |

---

## 6. HUD and UI (`client/ui.js`, `client/index.html`, `client/vendor/fonts/`)

**Scale:** every size below is for 1080p and scales by clamp(innerHeight/1080, 0.8, 1.25).

**Font:**
- Chakra Petch 600 and 700 (SIL OFL 1.1), Latin subset, about 20 KB of woff2 each.
- It ships as `client/vendor/fonts/chakra-petch.js`, which exports base64 strings, with `OFL.txt` beside it. `ui.js` registers it with `import()` inside a try/catch, then `new FontFace('Chakra Petch', bytes, { weight })`.
- This avoids `server/index.js`, whose MIME map would 404 a `.woff2` and which no workstream owns.
- Fallback stack: "Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif. If the font can't be fetched at build time, ship without the module.

| Element | Spec |
|---|---|
| Panels and text | Panel rgba(21,23,28,0.62) with a 1 px rgba(242,239,232,0.12) border. Text #f2efe8 with shadow 0 1px 2px rgba(0,0,0,0.8). Accent #d9b45a |
| Health (bottom-left, 24 px margin) | 44 px 700 number over a 220 × 8 px bar of 10 segments with 2 px gaps in #f2efe8. At ≤ 30 HP: #ff5a4f with a 1.2 Hz pulse. Lost HP shows as a #ff5a4f ghost draining over 600 ms. A Shield adds up to 6 segments in #66fff0 (10 hp each). Status tags: NITRO #3dff8f, SLOWED #ffb300, SHIELD #66fff0, each with seconds left |
| Ammo (bottom-right) | 44 px magazine count, 20 px dim "/ ∞", 13 px caps weapon name (letter-spacing 0.12em), 28 px conic reload ring |
| Power-ups (bottom-centre, 24 px up) | Three 56 × 56 px slots with 8 px gaps and 32 px icons. Selected: raised 6 px with a 2 px border in the item hue, "Q" under it and "E" to the right (11 px). Empty: dashed 1 px rgba(242,239,232,0.2). Cooldown: conic wipe rgba(0,0,0,0.55) over 1 s. Bolt firing: 3 pips. Pickup toast "+ SHUNT", 16 px in the item hue, for 1 s, your own picks only. Pad cue chip (`#padcue`, 108 px up, panel with a 3 px bar in the hue): on a refilling pad, the next item's 16 px icon and "REFILLING 12s" (m:ss from a minute); on an up pad with a full inventory, "INVENTORY FULL · Q TO USE" in the accent while the slots shake for 220 ms; hidden otherwise |
| Crosshair | 4 lines of 2 × 7 px (× xsize/4) in `xcolor`, default #f2efe8, with a 1 px #15171c outline and a 2 px centre dot. Gap from §5 |
| Hit marker | 4 diagonal 2 × 8 px strokes, 5 px from centre. Body #ffffff, head #ff4d4d, shield #66fff0. Pops from 1.3 to 1 over 90 ms and shows for 150 ms. Kill: a 26 px #ff4d4d X for 400 ms plus "ELIMINATED [name]" (18 px 700, victim's slot colour, 60 px below centre) for 1.2 s |
| Damage | Vignette radial-gradient(transparent 55%, #b3141f) at opacity 0.15 + 0.5 × dmg/100 (max 0.6), fading over 400 ms. Below 30 HP: 1.2 Hz pulse between 0.15 and 0.3. Damage arc: 600 ms, pointing at `sx`/`sz` for power hits |
| Threats | "SHOCK INBOUND", 22 px 700 #ffb300 at 30% of screen height, blinking at 4 Hz. Locked Shunts: 18 px #ff2a1a chevrons on a 160 px ring around the crosshair, pointing at each rocket. Own Shield: #66fff0 edge tint at α 0.08 |
| Top centre | Clock 22 px 700. Below it, rank "#3 / 8" at 13 px, and a 160 × 4 px leader bar (leader kills / 30) with the leader's name |
| Kill feed (top-right, 16 px margin) | 5 rows, 6 s each. 15 px names in slot colours, 18 px icons. Your own rows get a 1 px #d9b45a outline |
| Name tags | DOM, 13 px 600 #f2efe8, with a 3 × 13 px slot-colour bar. Data from `characters.nameTags`. At most 10, fading over 120 ms. 0 draws |
| Death card (38% height) | "ELIMINATED BY" 14 px dim; killer 28 px 700 in their slot colour; 24 px weapon or power icon; "they had 64 HP" 14 px; "Respawning in 3" 18 px; the existing picker below |
| Scoreboard | 680 px card. Columns: rank, 12 px swatch, name, K, D, PWR, ping. #d9b45a crown on rank 1 |
| Lobby | 420 px card, 64 px from the left, over the live orbiting world. "BOXFIRE" in 64 px 700 (0.06em tracking), player swatches, accent Start button |
| Menu (new settings) | Quality (Default/Low, applies after reload), MSAA (applies after reload), Render scale 50–100, Dynamic resolution, Shadows, Brightness 0.8–1.3, View bob, plus the existing FOV, sensitivity and crosshair. Keys gain "Use power-up" (Q) and "Next power-up" (E) |

**Settings schema v2:**
- Add `v: 2`. On load, if the saved `v` is below 2, reset `shadows:true, scale:100, quality:'default', msaa:true, dynres:true, bob:true, brightness:1`.
- Keep the saved keys, sensitivity, FOV, crosshair and primary.

**Guards and demo mode:**
- `initKeys` renders only actions present in `bindings`. This prevents `undefined.replace` before `input.js` gains `use` and `cycle`.
- `?debug&hud=demo` fills every element with demo data: 64 HP, 30 shield, 17/25 ammo, 3 power-ups, 5 kill-feed rows with icons, a hit marker, 3 name tags, a threat, and the scoreboard on Tab.

---

## 7. Performance budget, quality presets and dynamic resolution

All figures are estimates for Iris Xe at 1080p with MSAA 4× on the Default preset.

| Category | Owner | Draws | Triangles (typical / worst) | GPU ms (typical / worst) |
|---|---|---|---|---|
| Sky dome (drawn last, z = w) | world | 1 | 1.0k | 0.10 |
| Far group (ridge and towers, blades, clouds) | world | 3 | 3.0k | 0.15 |
| Static skyline, mid-ground and wall solids | world | 1 | 6.0k | 0.25 |
| Map (6 materials, AO grid) | world | 6 | 24k | 1.80 |
| Props (decals, chain-link) | world | 2 | 3.0k | 0.20 |
| Dust motes | world | 1 | 160 points | 0.05 |
| Characters (body, outline, blob, unlit, bubbles, ribbons) | characters | 6 | 5k / 10k | 0.30 / 0.50 |
| Power-ups (plinths, pools, glyph cubes, hulls, beams, floor rings, trails) | powerups | 7 | 7k / 9k | 0.30 / 0.40 |
| FX pools | effects | 6 | 3k / 16k | 0.35 / 1.50 |
| Viewmodel (arms and gun, moving part, flash, casings) | viewmodel | 4 | 1.0k / 1.5k | 0.25 |
| MSAA resolve and DOM composite | – | – | – | 0.80 |
| **Total** | | **37** (about 70 today) | **53k / 74k** | **4.55 / 6.0** |

**Other costs:**
- **Shadow map:** rendered once at build (about 2 ms); 0 draws per frame.
- **CPU:** about 2.5 ms per frame typical, 3.5 ms worst.
- **Memory:** about 1.3 MB of textures, 16 MB shadow map, about 3 MB of geometry.
- **Load:** textures 40 ms, AO 20–40 ms, skyline 5 ms.
- **Shader pre-warm:** `renderer.compileAsync(scene, camera)` and `compileAsync(viewScene, viewCamera)`, with every pooled and invisible mesh already added, take 300–800 ms on ANGLE/D3D11. They run behind the lobby.

**Presets.** Quality is chosen at load; changing it saves and reloads.

| Setting | Default | Low |
|---|---|---|
| Render scale | User setting (100%) | 70% |
| MSAA | 4× | Off |
| Shadows | 2048² static map, radius 1.5 | No map; baked per-vertex sun term |
| AO rays | 16 | 8 |
| FX pools | Full | Halved |
| Others' casings, dust motes, turbine and cloud motion | On | Off |
| Chain-link | alphaToCoverage | alphaTest 0.5 |
| Dynamic resolution floor | 0.6 | 0.5 |
| Estimated GPU | 4.55 / 6.0 ms | 2.3 / 3.2 ms |

**Dynamic resolution** (`render.frameTime(ms)`, fed by rAF deltas):
- **Down:** when 20 of the last 60 frames exceed 17.5 ms, lower the scale by 0.1.
- **Up:** after 10 s with no frame over 17.5 ms, raise it by 0.05, never above the user's setting.
- **Hysteresis:** after a drop from scale X, do not probe above X again for 30 s. At most one change every 2 s, because `setPixelRatio` reallocates.
- `?debug` shows the current scale.

---

## 8. Build plan

### 8.0 Rules for every workstream

1. **Contract commit C0 lands on main first.** The powerups workstream lands it in about 30 minutes, and everyone branches from it. It contains:
   - the `shared/constants.js` block in §4.4 (including the pink → #ff7eb6 swap);
   - `KEY.USE` 256 and `KEY.CYCLE` 512 in `shared/movement.js`;
   - `PLAYER_FLAGS`, `POWER_IDS` and `ENT` in `shared/protocol.js`;
   - `shared/palette.test.js`.

   It has no logic, and `npm test` passes. Client modules may import only these names (plus existing ones) from shared files.
2. **Ownership is strict.** Commits touch only the owned files; check with `git diff --name-only main...HEAD`. Nobody edits `main.js`, `render.js`, `net.js`, `server/index.js` or `tools/`.
3. **Boot compatibility.** With today's unmodified `main.js`, `render.js` and `net.js`, the client still boots with no console errors. Keep these exports working:
   - `sun`, `buildWorld(scene, map)`;
   - `charactersGroup`, `syncPlayers(list, roster, dt)`;
   - `GUN_SHAPES`, `viewScene`, `viewCamera`, `setGun`, `gunKick`, `updateViewmodel(now, aspect)`;
   - `effectsGroup`, `addTracer`, `updateEffects(now)`;
   - `recoilKick`;
   - `start`, `gunshot`, `footstep`, `hitTick`, `deathThud`;
   - every current `ui.*` signature.

   New parameters are optional and trailing.
4. **Preview patch.** To see your work, apply your rows of §8.9 locally to the three integrator files. Run `git checkout -- client/main.js client/render.js client/net.js` before every commit.
5. **Tunables and gameplay numbers.** Client look and feel tunables sit in one `const LOOK = {…}` block at the top of their module. Gameplay numbers stay in `shared/constants.js`, which only powerups edits.
6. **Shadow and culling flags.**
   - `castShadow=false` on everything except the map and skyline meshes.
   - Dynamic `InstancedMesh`es use `frustumCulled=false`.
   - Pooled meshes are created at init, so `compileAsync` sees them.
7. **Tests and screenshots.**
   - `npm test` passes in every worktree.
   - Screenshots use the harness: `H=/home/sukuna/personal_projects/game/.scratch/harness; REPO=<worktree> PORT=<31xx> BOTS=4 OUT=<dir> VIEW=1280x720 $H/serve.sh $H/pw/shots.mjs <prefix>`.
   - It produces overview, lane, side and crates shots from the same cameras as the `before-*.png` files in `/home/sukuna/personal_projects/boxfire-work/shots`.
   - Draws and triangles come from the `?debug` overlay, which counts both passes.

### 8.1 world

**Owns:** `client/world.js`, new `client/textures.js`, and the visual fields of `shared/maps/arena_01.json` (adds `materials`; box `pos` and `size` never change; spawns are untouched).

**Deliverables:**
- Everything in §2.2–2.7: the lights, the shader-chunk patches with the asserted fallback, the sky, the skyline, the far group, the motes, AO with sand drifts and the Low sun term, the textures, the edge treatment, the props and the chain-link.
- The `materials` array in the JSON.

**API:**
```js
export const sun;                        // DirectionalLight (render.js imports it)
export const LIGHTS = { sunColor: '#ffd3a1', sunIntensity: 3.3, sunDir: [-0.683, 0.643, 0.348],
  skyColor: '#a6c1ee', groundColor: '#d2b78e', hemiIntensity: 1.8, exposure: 1.08 };
export function setQuality(q /* 'default'|'low' */): void   // call before buildWorld
export function configureRenderer(renderer): void           // CustomToneMapping or Neutral fallback, exposure, PCFShadowMap
export function buildWorld(scene, map): void                 // map = raw arena JSON (same signature as today)
export function updateWorld(now, camera): void               // per frame: sky and far group follow camera x/z, blades, clouds, motes
export function surfaceAt(x, y, z): 'concrete'|'wood'|'steel'
```

**Acceptance:**
- **Overview shot:** the horseshoe benches; the crusher tower and conveyor in the WSW opening; containers above the north and south walls; lane-wall shadows 3.2 m toward +x; dark AO bands at wall bases; sand in corners.
- **Lane shot:** the sky gradient with clouds, benches above the far wall, and the chain-link silhouetted.
- **Side and crates shots:** slab joints every 4 m, board lines every 0.25 m, tie holes, crate battens and stencils, and edge highlights.
- **Pixel probes, 9×9 averages, ±12 per channel:** sunlit open floor #ae9787, floor in a lane-wall shadow #68666e, sun-facing board wall #d5b08b. Record the coordinates in the PR.
- **Palette test:** passes with `materials` present.
- **Tone-map assert:** shows no warning.
- **Draw budget:** with `BOTS=0`, ≤ 17 draws and ≤ 42k triangles in every shot (world ≤ 16 plus the old 1-draw gun).
- **Timing:** `?debug` load time for the AO bake is under 60 ms.

**Limits:** ≤ 16 draws, ≤ 40k triangles, ≤ 2.9 ms estimated.

**Must not touch:** box `pos`, `size`, `color` or `spawns`; any file outside its ownership.

### 8.2 characters

**Owns:** `client/characters.js`.

**Deliverables:**
- §3.1 in full: the 27-instance rig, outline, blob, lift, shadow receiving with the eased Low fallback, animation, hit flash, spawn assembly and pulse, the bubble, Nitro ribbons and slowed sparks, name-tag computation, and `?debug&lineup`.
- Remove the canvas sprite name tags and the `GUN_SHAPES` import.

**API:**
```js
export const charactersGroup;
export function initCharacters({ boxes, sunDir, quality }): void   // boxes = prepareMap(map).boxes
export function syncPlayers(list, roster, dt, camera?): void
// list items: { id, x, y, z, yaw, pitch, crouch, alive, shielded, hp, weapon, bubble?, nitro?, slowed? }
// roster: Map id -> { name, slot }
export function nameTags(camera, width, height): Array<{ id, name, color, x, y, alpha }>
export function muzzleOf(id): [number, number, number] | null
export function fired(id): void
export function setShadows(on): void
```

**Acceptance:**
- **Harness with 4 bots:** dark kit with slot torsos and helmets, a 2 px outline at range, blob shadows, legs cycling while strafing, and no sprite tags.
- **Lineup:** the 6 lineup shots (3 distances × sun and shade) let a reviewer name all 10 colours.
- **Hit flash:** visible on all 10 slots in lineup mode.
- **Fit:** the silhouette stays within 4 cm of the hitbox at yaw 0° and 45° (screenshot against a debug hitbox wireframe that is not committed).

**Limits:** ≤ 6 draws, ≤ 10k triangles with 10 players, ≤ 0.5 ms.

**Must not touch:** shared files, `viewmodel.js`, `effects.js`.

### 8.3 viewmodel

**Owns:** `client/viewmodel.js`.

**Deliverables:** §3.2: arms, the three guns with their children, springs, reload, switch, power cast, muzzle flash, own casings, and lighting mirrored in camera space with shade dimming.

**API:**
```js
export const viewScene, viewCamera, GUN_SHAPES;              // unchanged exports
export function setGun(weapon, visible): void
export function gunKick(): void
export function updateViewmodel(now, aspect, s = {}): void
// s: { camQuat, yaw, pitch, weapon, arsenal, speed, vy, grounded, crouch, sunVis }
export function setLighting(LIGHTS): void
export function setArmband(hex): void
export function powerCast(kind): void
```

**Acceptance:**
- Poses forced with `?debug&vm=<weapon>:<idle|recoil|reload|switch>:<0..1>`: 12 shots at 1280×720 show the arms with the armband, the merged guns, the magazine out mid-reload and the stars at peak recoil.
- With no `s`, today's `render.js` shows idle.

**Limits:** ≤ 4 draws, ≤ 1.5k triangles, ≤ 0.25 ms.

**Must not touch:** any other file.

### 8.4 effects

**Owns:** `client/effects.js`.

**Deliverables:** §3.3: the pools, classification, every row of the table, the blending rules, near-camera fade, the dust cap, and `?debug&fx`. That debug mode is a scripted loop at the lane view: hits on concrete, wood and steel every 300 ms, one blast of each kind, and a death burst every 4 s.

**API:**
```js
export const effectsGroup;
export function addTracer(from, to): void                    // kept; now pooled
export function updateEffects(now, camera?): void
export function initEffects({ boxes, map, quality }): void   // map = raw JSON (materials fall back to §2.1 when absent)
export function shot({ from, ends, weapon, targets, own }): void
// targets: [{ x, y, z, crouch, color, bubble }]; weapon may be 'bolt'
export function muzzle(pos, dir): void
export function casing(pos, right, weapon): void
export function blast(kind, pos, radius): void               // radius 0 = fizzle
export function deathBurst(state, color, dir, head): void
export function pickupBurst(pos, color): void
```

**Acceptance:**
- `?debug&fx` shots show tracers readable against both sky and shaded wall, chips and decals accumulating, and each blast kind.
- A point-blank shotgun hit spawns ≤ 3 puffs.
- With every cube live: ≤ 6 draws and ≤ 16k triangles, and `count` returns to 0 when idle.

**Limits:** ≤ 6 draws, ≤ 1.5 ms worst.

**Must not touch:** any other file.

### 8.5 audio

**Owns:** `client/audio.js`.

**Deliverables:** §4.8 and the audio rows of §5: the compressor, the slapback bus, the wind bed, voice stealing, and `?debug&sfx`, which plays every sound 600 ms apart after `start()`.

**API:**
```js
export function start(ctx?): void                            // optional OfflineAudioContext for tests
export function gunshot(weapon, distance = 0, pan = 0): void  // weapon may be 'bolt'
export function footstep(distance = 0, pan = 0, surface = 'concrete'): void
export function hitTick(head): void; export function deathThud(): void   // kept
export function hit(kind /* 'body'|'head'|'shield' */): void
export function kill(): void
export function landing(vy): void
export function casing(weapon): void
export function power(kind, phase, distance = 0, pan = 0): void // phase: 'pick'|'use'|'boom'|'arm'|'fuse'|'break'|'fizzle'
export function warn(kind /* 'lock'|'shock' */, level): void    // lock: beeps/s 0..9 (0 off); shock: 0..1
export function padHums(list /* [{ distance, pan }] */): void
export function ambience(on): void
```

**Acceptance:**
- An `OfflineAudioContext` render of the full board peaks at ≤ −1 dBFS.
- No sound outputs NaN.
- Each duration is within ±10% of spec.
- 48 voices are never exceeded.

**Limits:** 0 draws, ≤ 0.2 ms CPU per frame.

**Must not touch:** any other file.

### 8.6 feel

**Owns:** `client/feel.js`. It stays free of the DOM and three.js, so Node can import it.

**Deliverables:** the feel rows of §5: correction smoothing, bob, landing dip, recoil recovery, shake and Nitro FOV.

**API:**
```js
export function recoilKick(weapon, now): [number, number]     // kept; also records the kick for recovery
export function updateFeel(dtMs, s): { ox, oy, oz, roll, fovAdd, recover: [number, number] }
// s: { alive, grounded, vy, speed, crouch, pitch, yaw, nitro }; recover = [dPitch, dYaw] for input.kick
export function addCorrection(dx, dy, dz): void
export function addTrauma(amount): void
export function resetFeel(): void
export function setBob(on): void
```

**Acceptance:** a scratch Node script, not committed, asserts:
- the recovery curve (30% ± 3% at 500 ms);
- the correction halflife of 50 ms ± 5;
- a landing dip of 0.057 m at vy 6.32;
- a bob amplitude of 8 mm;
- that shake never changes pitch or yaw.

**Limits:** 0 draws, ≤ 0.05 ms.

**Must not touch:** any other file.

### 8.7 hud

**Owns:** `client/ui.js`, `client/index.html`, `client/vendor/fonts/`.

**Deliverables:**
- All of §6: the font module, the settings schema v2 migration, the guarded key list, every HUD element, the kill-feed and power-up SVG icons, the lobby styling over the live world, and `?debug&hud=demo`.
- `--accent` changes to #d9b45a.

**API:** every existing export is kept. Additions are optional and trailing:
```js
export function updateHud(hp, weapon, mag, reloading, extra = {}): void    // extra: { maxMag, reloadFrac, shield, nitro, slowed }
export function hitMarker(head, kind = head ? 'head' : 'body'): void      // 'body'|'head'|'shield'
export function addKill(killer, victim, weapon, head, mine, colors = {}): void  // weapon may be a power id
export function showDeath(killer, seconds, info = {}): void              // info: { color, weapon, killerHp }
export function updateMatchInfo(secondsLeft, leader, me = null): void    // me: { rank, of }
export function updatePowers(pw): void
export function powerToast(kind): void
export function updateCrosshair(gapPx, ring = false): void
export function crosshairPulse(): void
export function damageTaken(dmg): void
export function killConfirm(name, color): void
export function renderNameTags(tags): void
export function threat({ shock, shunts }): void   // shock: seconds|null; shunts: screen angles in radians
// settings gains: v, quality, msaa, dynres, bob, brightness
```

**Acceptance:**
- `?debug&hud=demo` at 1280×720 and 1920×1080 shows every element over the bright lane view, with all text legible.
- The menu shows the new settings and the Q and E bindings once input supports them.
- A stored v1 settings object migrates to shadows on.
- The font loads with no 404.

**Limits:** 0 GPU draws; ≤ 30 DOM style writes per frame; no CSS filters.

**Must not touch:** `server/index.js`, any `.js` outside `client/ui.js`, the font folder.

### 8.8 powerups

**Owns:**
- new `shared/powerups.js`, `server/powerups.js` and `client/powerups.js`;
- new tests `shared/powerups.test.js`, `shared/palette.test.js` and `server/powerups.test.js`;
- minimal edits, each commented `// POWER-UPS` or `// FEEL`, to `shared/constants.js`, `shared/movement.js`, `shared/protocol.js`, `server/game.js`, `server/player.js` and `client/input.js`.

**Deliverables:**
- C0, landed first.
- `stepPowers` and the pure helpers; movement changes and `knock`; flags.
- `server/powerups.js` with pads, entities, Bolt, damage queue, knocks and the `pu` snapshot.
- `game.js` hooks:
  - spawn sets `p.pw = createPowers()`;
  - the input loop calls `stepPowers` and `use`, and a use clears protection;
  - `fire()` calls `powers.shot` per pellet;
  - `damage()` gets owner immunity, shield absorption, `pk`, inventory reset on death, and the `w`, `sh`, `sx`, `sz` fields;
  - snapshots carry `pw`, `pu` and the flags;
  - `startMatch()` resets powers and `pk`;
  - the lobby carries `pk`;
  - match end logs the kill share.
- `player.js` adds `pw = null` and `pk = 0`.
- `input.js` adds `bindings.use='KeyQ'`, `bindings.cycle='KeyE'`, the matching `BITS`, and `EDGES |= KEY.USE | KEY.CYCLE`.
- `client/powerups.js` renders the visuals in §4.7 and the ghosts.

**API:**
```js
// shared/powerups.js
export function createPowers(): object
export function stepPowers(pw, mover, arsenal, input): string | null
export function falloff(d, r, max, min): number
export function domeCentres(x, y, z, vx, vz): number[][]
export function lockTarget(eye, dir, candidates, boxes): number | null
export function padRespawnTicks(pad, n): number
// shared/movement.js
export function knock(s, vx, vz, lift): void
// server/powerups.js
export class PowerServer { constructor(game); reset(); use(p, kind, input); shot(p, origin, dir, maxT, rt); step(); snapshot(): string }
// client/powerups.js
export const powerupsGroup;
export function initPowerups({ quality }): void
export function onSnapshot(m): void
export function updatePowerups(now, renderTick, camera): void
export function ghost(kind, eye, dir): void
export function threats(myId): { shock: number | null, shunts: Array<[number, number, number]> }
export function padStates(): Array<{ pos: [number, number, number], kind: string, up: boolean }>
```

**Acceptance:**
- All existing tests pass unchanged, plus the 10 shared tests in §4.4.
- `server/powerups.test.js` covers:
  - pickup, full-inventory rejection and player-count scaling (n = 3 doubles respawn);
  - the E pad rotating Barge → Bolt → Barge;
  - Shunt lock, line of sight, direct hit plus knock, splash to others only, owner immunity, and rewound shoot-down that fizzles with no damage;
  - Barge falloff, line of sight, clearing, and the 5.8 m throw with the real `step()`;
  - Shock targeting (runner-up when the user leads), dome placement, a straight runner hit once while a runner who turns at 0.3 s escapes, and the Shield blocking it;
  - Mine arming at 48 ticks, fuse at 15 ticks, owner immunity, the cap of 2, and shooter credit;
  - Shield absorbing 60, and a 160 headshot killing through it;
  - spawn protection blocking damage, knock and slow;
  - `pu` under 600 B.
- **Harness with the preview patch:** the overview shows 9 pads with distinct glyphs and the lane shot shows beams over the lane walls.
- A scratch bot script, not committed, that presses Q shows ghosts merging into server entities.

**Limits (client):** ≤ 7 draws, ≤ 9k triangles, ≤ 0.4 ms. Server: ≤ 0.2 ms per tick with 10 players and 10 entities.

**Must not touch:**
- `client/main.js`, `client/render.js`, `client/net.js`, `server/index.js`;
- existing test files;
- `MAP_COLORS` and `SKY_COLOR`, which stay until a later cleanup.

### 8.9 Integration checklist

Merge order:
1. C0.
2. powerups.
3. world, characters, viewmodel, effects, audio, feel and hud, in any order (their files are disjoint).
4. This wiring.
5. `npm test`.
6. Harness shots with 10 bots and `?debug` (≤ 40 draws, ≤ 80k triangles).

**render.js**
1. Import `{ sun, configureRenderer, updateWorld, LIGHTS }` from `world.js`, `{ updateViewmodel }` from `viewmodel.js` and `{ settings }` from `ui.js`.
2. Create the renderer with `new THREE.WebGLRenderer({ antialias: settings.quality !== 'low' && settings.msaa !== false, powerPreference: 'high-performance' })`. Call `configureRenderer(renderer)` in `init()`.
3. In `setShadows(on)`, keep today's body and add `if (on) sun.shadow.needsUpdate = true;`.
4. Make it `setView(x, y, z, yaw, pitch, roll = 0)`, ending with `camera.rotation.set(pitch, yaw, roll)`.
5. Add `setFovKick(deg)`, which sets `camera.fov` from `hfov + deg` and calls `updateProjectionMatrix()` without touching `setPixelRatio`. Add `setBrightness(b)`, which sets `toneMappingExposure = LIGHTS.exposure * b`.
6. Add `frameTime(ms)`, implementing the dynamic-resolution rules in §7 through `setRenderScale`.
7. Make it `draw(viewState = {})`: call `updateWorld(now, camera)`, render the world, call `updateViewmodel(now, camera.aspect, { ...viewState, camQuat: camera.quaternion })`, clear depth, render the view pass.
8. Add `export async function prewarm() { await renderer.compileAsync(scene, camera); await renderer.compileAsync(viewScene, viewCamera); }`.

**net.js**
1. Import `stepPowers` from `../shared/powerups.js`. `self` gains `pw: null`.
2. In `predict()`, after `stepWeapon`, add `input.power = self.pw ? stepPowers(self.pw, self.mover, self.arsenal, input) : null;`. It still returns `fired`.
3. In `reconcile()`:
   - record `before = [x, y, z]`;
   - copy `me.mover`, `me.arsenal` and `if (me.pw) self.pw = { ...me.pw, inv: [...me.pw.inv] }`;
   - replay `step`, `stepWeapon` and `stepPowers`, **ignoring the results: no effects or sounds during replay**;
   - `return [dx, dy, dz]`, or `null` when there is no state.
4. In `others()`, add `bubble`, `nitro` and `slowed` from the `PLAYER_FLAGS` bits.

**main.js**
1. **On `welcome`:**
   - `world.setQuality`, `render.init()`, fetch the map;
   - `buildWorld`, `initEffects`, `initCharacters({ boxes, sunDir: LIGHTS.sunDir })`, `initPowerups`;
   - `viewmodel.setLighting(LIGHTS)`;
   - add `charactersGroup`, `effectsGroup` and `powerupsGroup` to the scene;
   - `await render.prewarm()`.
   - **Lobby view:** an orbit camera at radius 26 m and 9 m height, at 0.03 rad/s, looking at (0, 1, 0); scale 0.5 and 30 fps; roster players idle on the platform as fake rigs. Then `enterGame()` only switches the HUD.
2. **`applySettings()`** additionally calls `render.setBrightness(settings.brightness)`, `feel.setBob(settings.bob)` and `characters.setShadows(settings.shadows)`, and stores `dynres`.
3. **Own spawn:** `self.pw = createPowers()`, `feel.resetFeel()`, `viewmodel.setArmband(PLAYER_COLORS[mySlot])`.
4. **`snapshot`:**
   - `bufferSnapshot`, then `powerups.onSnapshot(m)`;
   - `const d = reconcile(m, world.boxes)`;
   - if `d` is non-zero and below `SNAP_DISTANCE`: shift `prev` by `d` and call `feel.addCorrection(...d)`.
5. **`shot` event:**
   - `effects.shot({ from: characters.muzzleOf(m.id) ?? m.o, ends: m.h, weapon: m.w, targets, own: false })`;
   - `characters.fired(m.id)`, `effects.muzzle(...)`;
   - casings within 15 m;
   - `audio.gunshot(m.w, ...heard)`.
   - `targets` = visible others plus `{ color: PLAYER_COLORS[slot] }`.
6. **`hit` event:** `ui.hitMarker(m.head, m.sh && !m.dmg ? 'shield' : undefined)`, `audio.hit(...)`. When you are the victim: `ui.damageTaken(m.dmg)` and a damage arc toward `sx`/`sz` or the attacker.
7. **`kill` event:**
   - `effects.deathBurst(victim, color, dir, head)`;
   - `ui.addKill(..., { killer, victim } colours)`;
   - `audio.kill()` when you are the killer, plus `ui.killConfirm`;
   - `ui.showDeath(killer, 3, { color, weapon: m.w, killerHp })` when you are the victim.
8. **`pick`, `use`, `boom`:** queue them until `renderTick ≥ m.tick`, except your own. Then:
   - `pick`: yours plays `effects.pickupBurst`, `audio.power(k, 'pick')` and `ui.powerToast`; someone else's plays only `audio.power('pad', 'taken')` at the pad;
   - `use`: `audio.power(k, 'use')`;
   - `boom`: `effects.blast(k, pos, r)`, `audio.power(k, r ? 'boom' : 'fizzle')`, `feel.addTrauma` within 8 m. Skip your own Barge boom.
9. **`fixedStep`:**
   - after `predict`, a shot also calls `effects.shot` (own), `ui.crosshairPulse()` and `audio.casing`;
   - if `input.power === 'bolt'`: draw your own Bolt beam with zero spread via `traceShot` and `audio.gunshot('bolt')`;
   - for any other power: `powerups.ghost(kind, eye, aimDir)` (Shunt and Mine), `effects.blast('barge', …)` for Barge, `audio.power(kind, 'use')`, `viewmodel.powerCast(kind)`.
10. **Frame loop:**
    - `const f = feel.updateFeel(frameMs, {...})`; `input.kick(...f.recover)`;
    - `render.setView(pos + f.o*, yaw, pitch, f.roll)`; `render.setFovKick(f.fovAdd)`;
    - `sunVis` = rayBox from the eye along `LIGHTS.sunDir` against `world.boxes`;
    - `characters.syncPlayers(visible, roster, dt, render.camera)`; `ui.renderNameTags(characters.nameTags(render.camera, innerWidth, innerHeight))`;
    - `powerups.updatePowerups(now, renderTick(now), render.camera)`;
    - `const t = powerups.threats(myId)`, then `ui.threat(...)`, `audio.warn('lock', …)` and `audio.warn('shock', …)`;
    - `audio.padHums(...)` from `padStates()`;
    - `ui.updateHud(..., { maxMag, reloadFrac, shield: self.pw?.shield, nitro, slowed })`, `ui.updatePowers(self.pw)`;
    - `ui.updateCrosshair(3 + (innerHeight / 2) * tan(spreadDegrees(weapon, self.mover)) / tan(vfov / 2), weapon === 'shotgun')`;
    - `ui.updateMatchInfo(..., { rank, of })`;
    - footsteps use `world.surfaceAt`; on a landing transition call `audio.landing(vy)`;
    - `updateEffects(now, render.camera)`;
    - if `settings.dynres`, `render.frameTime(frameMs)`;
    - `render.draw({ yaw, pitch, weapon, arsenal, speed, vy, grounded, crouch, sunVis })`.
11. **Start of audio:** `audio.start()` on the play click (today), then `audio.ambience(true)`.