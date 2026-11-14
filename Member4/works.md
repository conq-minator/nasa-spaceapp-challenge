# M4 — Simulation Lead: Complete Work Plan

> **Role:** 3D Lander Digital Twin — Three.js Simulation Lead  
> **Owner:** Debanik Dey (M4)  
> **One-line mission:** Build a Three.js scene where judges stand on the Moon, see real terrain, watch the Sun and Earth move, and witness the exact moment a launch delay kills a mission.

---

## Table of Contents

1. [What I Receive (Dependencies)](#1-what-i-receive-dependencies)
2. [What I Deliver](#2-what-i-deliver)
3. [Hour-by-Hour Build Schedule](#3-hour-by-hour-build-schedule)
4. [Build Guide: Phase 1 — Scaffold on Fake Data (H0–H5)](#4-build-guide-phase-1--scaffold-on-fake-data-h0h5)
5. [Build Guide: Phase 2 — Real Terrain & Mode A Hero View (H6–H10)](#5-build-guide-phase-2--real-terrain--mode-a-hero-view-h6h10)
6. [Build Guide: Phase 3 — Mode B Orbital Overview & Shadows (H11–H14)](#6-build-guide-phase-3--mode-b-orbital-overview--shadows-h11h14)
7. [Build Guide: Phase 4 — Mode C Mission Replay (H16–H18)](#7-build-guide-phase-4--mode-c-mission-replay-h16h18)
8. [Build Guide: Phase 5 — Polish, Performance & Labels (H18–H22)](#8-build-guide-phase-5--polish-performance--labels-h18h22)
9. [Data Overlay System (Slope, Rock Abundance, Thermal Inertia)](#9-data-overlay-system-slope-rock-abundance-thermal-inertia)
10. [Critical Math Reference](#10-critical-math-reference)
11. [File Formats I Load](#11-file-formats-i-load)
12. [Shared State Contract with M3](#12-shared-state-contract-with-m3)
13. [What I Do NOT Build](#13-what-i-do-not-build)
14. [Cut List (What Gets Dropped First If Behind)](#14-cut-list-what-gets-dropped-first-if-behind)
15. [Validation Checks (How I Know It's Right)](#15-validation-checks-how-i-know-its-right)
16. [Risk Register](#16-risk-register)

---

## 1. What I Receive (Dependencies)

I don't download data. I don't run Python. I receive files from M1 and M2 and render them.

| File | From | Expected Arrival | What's Inside |
|---|---|---|---|
| `data_out/heightmap/site04.json` | **M2** | ~H4–H6 | Grid metadata: nx, ny, cell_m, file names, axes |
| `data_out/heightmap/site04_near.bin` | **M2** | ~H4–H6 | Float32 array, 512×512, near-field terrain (10 m/cell, 5120 m span), curvature baked in |
| `data_out/heightmap/site04_far.bin` | **M2** | ~H4–H6 | Float32 array, 512×512, far-field terrain (120 m/cell, 61440 m span), curvature baked in |
| `data_out/angles/site04.json` | **M1** | ~H5–H6 | Arrays: `t[]`, `sun_az[]`, `sun_el[]`, `earth_az[]`, `earth_el[]` — 8760 entries each |
| `data_out/mask/site04.json` | **M2** | ~H6–H8 | `elev_deg[]` — 360 floats, horizon elevation per degree of azimuth |
| `data_out/results/site04.json` | **M1** | ~H8–H10 | `sun_lit[]`, `earth_vis[]` — 8760 binary flags each, plus summary stats |
| `data_out/sites.json` | **M2** | ~H2 | Site metadata: id, name, lat, lon, ground_height_m, obs_height_m |
| `web/src/core/missionLogic.js` | **M1** | ~H13 | Pure function: delay windowing, first-failure finder |
| `web/src/core/landerModel.js` | **M1** | ~H15 | Pure function: SoC integration, comms link state |
| `web/src/core/raycast.js` | **M2** | ~H12 | Pure function: independent ray-terrain visibility check |
| Shared store hookup | **M3** | ~H11+ | Reactive state object (Zustand or plain JS) |
| Moon Trek WMTS tile URLs | **M2** | ~H6 | Cached PNG tiles for slope/rock abundance overlays |

**Critical: Until H4–H6, I work on FAKE DATA. This is expected and planned.**

### What to do if files are late

| Situation | Action |
|---|---|
| No `.bin` by H6 | Ping M2 immediately. Use a procedurally generated crater terrain (sine waves + noise) as placeholder. |
| No `angles/` by H6 | Use a synthetic 29.5-day Sun cycle: `sun_az = t * (360/708)`, `sun_el = 3 * sin(t * 2π/708)` |
| No `mask/` by H8 | Generate a flat mask (all 0°) or a simple sine wave mask. Mode A still works visually. |
| No `results/` by H10 | Compute simple flags locally: `sun_lit = sun_el > mask[sun_az]` |
| No shared store by H11 | Build a standalone time slider. M3 wires it later. |

---

## 2. What I Deliver

### Must Ship (Never Cut)

| Deliverable | Description |
|---|---|
| **Mode A: First-Person Lander View** | Camera at mast height (2 m). Real LOLA terrain skyline. Sun disk and Earth disk at correct az/el. Engine horizon mask line overlaid on the 3D ridge. Compass ticks (N/E/S/W). Elevation grid lines (0°/5°/10°). Status badges showing Sun/Earth VISIBLE or BLOCKED. |
| **Mode C: Mission Replay** | Play/Pause/Speed controls. Time scrubber synced to dashboard. "Jump to First Failure" button snaps time and camera to the failure hour. Failure banner with plain-English message. |
| **Engine vs Raycast Agreement Display** | Show "Raycast agrees with engine in X% of hours" on screen. Runs in a Web Worker. |
| **"Visual Aid" Watermark** | Permanent label: *"Visual aid. Visibility numbers come from the offline engine. Raycast shown for consistency check."* |

### Should Ship (High Value)

| Deliverable | Description |
|---|---|
| **Mode B: Orbital Overview** | Orbit camera above terrain. DirectionalLight along Sun vector. Level 1 Three.js shadow maps. Earth direction arrow from lander. |
| **Slope Overlay** | Terrain colored by slope angle (green → yellow → red). Derived from heightmap, zero extra data. |
| **Rock Abundance Overlay** | Terrain colored by Diviner data. Loaded from Moon Trek WMTS cached tiles. |
| **Lander State Panel** | Battery SoC gauge draining over time. Comms UP/DOWN indicator. Driven by `landerModel.js`. |

### Stretch (Only After Everything Above Works)

| Deliverable | Description |
|---|---|
| Level 2 shadow shader | Custom GLSL heightmap ray march for pixel-accurate shadows at grazing angles |
| Thermal inertia overlay | Additional Diviner layer from Moon Trek |
| Exaggerate bodies toggle | 3× / 5× scale for Sun and Earth disks with disclaimer label |
| Camera presets | "Look at Sun", "Look at Earth", "Look at blocking ridge" buttons |
| Descent animation | Cinematic camera drop from 500 m to surface |
| Side-by-side delay comparison | Split view showing original vs. delayed scenario |

---

## 3. Hour-by-Hour Build Schedule

```
H0  ┃ Lock JSON contracts with M1/M2. Understand shared store shape with M3.
H1  ┃ Three.js boilerplate: scene, renderer, camera at (0, 2, 0), black background.
H2  ┃ Fake terrain: two PlaneGeometry meshes displaced by procedural noise.
H3  ┃ Camera: drag-to-look (position locked, rotation free). Limit pitch -15° to +45°.
H4  ┃ Sun and Earth: two sphere meshes positioned by bodyDirection(az, el).
    ┃ HTML time slider that cycles fake az/el values.
H5  ┃ Compass ticks (N/E/S/W text sprites), elevation ring lines.
    ┃ ━━━ MEAL BREAK (H5–H5.75) ━━━
H6  ┃ Load real site04_near.bin and site04_far.bin from M2.
H7  ┃ Construct dual PlaneGeometry meshes from Float32 data. Verify scale (1 unit = 1 meter).
H8  ┃ Load mask/site04.json. Render 360° horizon mask as a glowing LineLoop over the terrain.
H9  ┃ Load angles/site04.json. Position Sun/Earth from real hourly data. Wire time slider.
H10 ┃ Status badges: compare sun_el vs mask → show VISIBLE/BLOCKED for Sun and Earth.
    ┃ ━━━ CHECKPOINT 1 (H10) then DINNER BREAK (H10–H11) ━━━
H11 ┃ Mode B: Add OrbitControls toggle. Add DirectionalLight along Sun vector.
H12 ┃ Level 1 shadows: enable shadow maps on terrain meshes. Tune bias/normalBias.
H13 ┃ Earth direction arrow (ArrowHelper). Camera preset: toggle between Mode A and Mode B.
H14 ┃ Subscribe to M3's shared store. When store.currentTime changes, update Sun/Earth/status.
    ┃ ━━━ REST BREAK (H14–H16) ━━━
H16 ┃ Mode C: Play/Pause button. Speed selector (1×, 10×, 50×, 200×). Time auto-advance.
H17 ┃ "Jump to First Failure": read failure hour from missionLogic.js, set time, rotate camera
    ┃ toward the blocking ridge direction. Show failure banner div.
    ┃ ━━━ CHECKPOINT 2 (H17) ━━━
    ┃ ━━━ HARD FEATURE FREEZE (H18) ━━━
H18 ┃ Performance pass: test on low-end laptop. Reduce geometry if needed. Dispose unused meshes.
H19 ┃ Add "Visual Aid" watermark label. Polish status badges layout.
H20 ┃ Slope overlay: compute slope from heightmap in JS, map to color gradient on terrain.
H21 ┃ Rock abundance overlay: load cached Moon Trek tile as texture, map onto terrain UV.
    ┃ Layer toggle buttons with legends.
H22 ┃ Final bug fixes. Test all 5 sites (switch site → terrain reloads).
    ┃ ━━━ DONE — hand off to M5 for demo recording ━━━
```

---

## 4. Build Guide: Phase 1 — Scaffold on Fake Data (H0–H5)

### Step 1: Scene Boilerplate (H1)

Create the Three.js essentials:

```
Renderer: WebGLRenderer, antialias, attach to a <canvas> in the #simulation-container div
Scene: background = new THREE.Color(0x000000)  (black — no atmosphere on the Moon)
Camera: PerspectiveCamera, fov=75, near=0.1, far=200000
         position = (0, 2, 0)  ← mast height
Lighting: AmbientLight(0x111111) for minimal fill
          HemisphereLight(0x444444, 0x111111) so terrain isn't pitch black
Render loop: requestAnimationFrame, call renderer.render(scene, camera)
```

**Key decision:** The canvas lives inside a container div that M3 provides in the two-pane layout. Coordinate with M3 on the container's CSS id/class. If M3 hasn't scaffolded yet, use a full-screen canvas and refactor later.

### Step 2: Fake Terrain (H2)

Create two `PlaneGeometry` meshes to simulate the near and far field:

```
Near terrain:
  PlaneGeometry(5120, 5120, 511, 511)   ← 512 segments = 511 subdivisions
  Rotate -π/2 around X so it lies flat (Three.js planes are vertical by default)
  Displace vertices on Y axis using procedural noise:
    - A gentle sine wave base: y = 20 * sin(x/500) * cos(z/500)
    - Add a "mountain ridge" on the south side: if z > 1500, y += 200 * noise
    - Add a "crater" at center: if dist < 300, y -= 50

Far terrain:
  PlaneGeometry(61440, 61440, 511, 511)
  Same rotation
  Lower frequency noise, add a tall peak (~400 m) at azimuth ~180° to simulate Mons Malapert
```

Material: `MeshStandardMaterial({ color: 0x888888, flatShading: true })` — lunar gray, flat shaded for that low-poly Moon look. Replace with smooth shading when real data arrives.

### Step 3: Camera Controls (H3)

**Do NOT use OrbitControls for Mode A.** OrbitControls lets the camera move position — in Mode A the camera is locked to the lander mast and only rotates.

Build a custom drag handler:

```
State: yaw (azimuth rotation), pitch (elevation rotation)
On pointerdown: record startX, startY
On pointermove: compute deltaX, deltaY → update yaw and pitch
On pointerup: stop

Apply rotation: camera.rotation.order = 'YXZ'
  camera.rotation.y = -yaw
  camera.rotation.x = pitch
  Clamp pitch between -15° and +45° (converted to radians)

Sensitivity: 0.002 radians per pixel of mouse movement (tune this)
```

Also support touch events (same logic, use `touches[0]`).

### Step 4: Celestial Bodies (H4)

Two sphere meshes on the sky dome:

```
Sun:
  SphereGeometry(radius=50, 32, 32)
  MeshBasicMaterial({ color: 0xffee88 })   ← unlit, always bright
  Position = bodyDirection(sun_az, sun_el).multiplyScalar(80000)

Earth:
  SphereGeometry(radius=180, 32, 32)       ← Earth is ~3.6× larger in angular diameter
  MeshBasicMaterial({ color: 0x4488ff })
  Position = bodyDirection(earth_az, earth_el).multiplyScalar(80000)
```

The `bodyDirection` function (see Section 10) converts (az, el) to a Three.js world vector.

Place these in the scene. They should appear as small dots on the horizon — which is correct for the Moon.

### Step 5: Time Slider (H4)

A simple HTML range input:

```html
<input type="range" id="timeSlider" min="0" max="99" value="0">
<span id="timeLabel">Hour 0</span>
```

Create 100 fake hourly data points:
- Sun: azimuth cycles 0→360 over 29.5 fake-hours, elevation oscillates between -2° and +5°
- Earth: azimuth stays near 0°–30°, elevation oscillates between -1° and +3°

On slider change: update Sun/Earth positions, update a status text div showing "Sun: above horizon" or "Sun: below horizon" based on `sun_el > 0`.

### Step 6: Compass and Elevation Grid (H5)

Compass ticks — four text labels floating in 3D space:
- Use `CSS2DRenderer` (from Three.js examples) for crisp text that doesn't blur
- Place labels at distance 3000 from origin at each cardinal direction:
  - N: position (0, 50, -3000)
  - E: position (3000, 50, 0)
  - S: position (0, 50, 3000)
  - W: position (-3000, 50, 0)

Elevation rings — `RingGeometry` or `LineLoop`:
- At 0°: a horizontal circle at y=0, radius=3000
- At 5°: a circle at y = 3000 × tan(5°) ≈ 262 m
- At 10°: a circle at y = 3000 × tan(10°) ≈ 529 m
- Material: `LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 })`

**By end of H5:** You have a scene that looks like standing on a gray, bumpy surface. A yellow dot and a blue dot sit near the horizon. Dragging the mouse looks around. Moving the slider makes the dots move. Cardinal directions are labeled. It's ugly, it's fake, and it's the foundation for everything.

---

## 5. Build Guide: Phase 2 — Real Terrain & Mode A Hero View (H6–H10)

### Step 7: Load Binary Heightmaps (H6–H7)

When M2 delivers the `.bin` files:

```javascript
async function loadHeightmap(url) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return new Float32Array(buffer);
}
```

Read the metadata from `heightmap/site04.json`:
```javascript
const meta = await (await fetch('data/heightmap/site04.json')).json();
const nearData = await loadHeightmap(`data/heightmap/${meta.near.file}`);
const farData = await loadHeightmap(`data/heightmap/${meta.far.file}`);
```

Build the mesh:
```javascript
function buildTerrainMesh(data, nx, ny, cellM, totalSizeM) {
  const geometry = new THREE.PlaneGeometry(totalSizeM, totalSizeM, nx - 1, ny - 1);
  geometry.rotateX(-Math.PI / 2); // lay flat

  const positions = geometry.attributes.position.array;
  for (let i = 0; i < nx * ny; i++) {
    // positions[i*3 + 1] is the Y (up) component after rotation
    positions[i * 3 + 1] = data[i]; // height value, curvature already subtracted
  }

  geometry.computeVertexNormals();
  geometry.attributes.position.needsUpdate = true;

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0x999999,
    flatShading: false,
    side: THREE.DoubleSide,
  }));
}
```

**Critical orientation check:** The heightmap axes are `x=east, y=north, row 0 = southernmost row, lander at center`. Three.js after rotation has `x=east, -z=north`. So:
- Heightmap column index → Three.js X position ✓
- Heightmap row index → Three.js -Z position (flip needed)
- Heightmap value → Three.js Y position ✓

**Row 0 is the south edge**, so row 0 maps to the most positive Z (south in our coordinate system). Row iteration goes south→north which maps to +Z→-Z. This means the data order naturally maps to Three.js PlaneGeometry vertex order (which goes top-to-bottom in the XZ plane after rotation). **But verify this** — a single row/column flip will mirror the entire terrain and the mask line won't match the ridges.

### Step 8: Horizon Mask Overlay Line (H8)

**This is the single most important visual in the entire simulation.**

Load `mask/site04.json` → `elev_deg` array (360 values).

Build a `LineLoop` tracing the horizon profile in 3D:

```javascript
function buildMaskLine(maskElevDeg) {
  const points = [];
  const R = 4000; // visual distance — far enough to sit on the skyline

  for (let az = 0; az < 360; az++) {
    const el = maskElevDeg[az];
    const dir = bodyDirection(az, el);
    points.push(dir.multiplyScalar(R));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0x00ff88,
    linewidth: 2, // note: linewidth > 1 only works on some systems
  });

  return new THREE.LineLoop(geometry, material);
}
```

For a thicker, more visible line on all systems, use `Line2` from Three.js examples (`LineGeometry` + `LineMaterial` with `worldUnits` or pixel-based width).

**The magic moment:** When you look at the terrain in Mode A and the green mask line sits exactly on top of the ridge peaks, that's the visual proof that the engine and the terrain agree. If the line floats above or cuts through the terrain, there's a coordinate bug (azimuth direction, row flip, or curvature mismatch). Fix it before anything else.

### Step 9: Real Celestial Body Positions (H9)

Load `angles/site04.json`. Replace fake slider data with the real 8760-entry arrays:

```javascript
const angles = await (await fetch('data/angles/site04.json')).json();

function updateBodies(hourIndex) {
  const sunAz = angles.sun_az[hourIndex];
  const sunEl = angles.sun_el[hourIndex];
  const earthAz = angles.earth_az[hourIndex];
  const earthEl = angles.earth_el[hourIndex];

  sunMesh.position.copy(bodyDirection(sunAz, sunEl).multiplyScalar(80000));
  earthMesh.position.copy(bodyDirection(earthAz, earthEl).multiplyScalar(80000));
}
```

Update the time slider: `max = angles.t.length - 1`. Display the ISO timestamp from `angles.t[hourIndex]`.

### Step 10: Status Badges (H10)

Load `results/site04.json` (or compute locally from angles + mask):

```javascript
function updateStatus(hourIndex) {
  const sunLit = results.sun_lit[hourIndex];
  const earthVis = results.earth_vis[hourIndex];

  sunBadge.textContent = sunLit ? '☀ SUN: VISIBLE' : '☀ SUN: BLOCKED';
  sunBadge.className = sunLit ? 'badge-ok' : 'badge-fail';

  earthBadge.textContent = earthVis ? '🌍 EARTH: VISIBLE' : '🌍 EARTH: BLOCKED';
  earthBadge.className = earthVis ? 'badge-ok' : 'badge-fail';
}
```

These are HTML overlay divs positioned over the Three.js canvas (CSS `position: absolute`).

---

## 6. Build Guide: Phase 3 — Mode B Orbital Overview & Shadows (H11–H14)

### Step 11: Mode Toggle & OrbitControls (H11)

Add a button: "Switch to Overview / Switch to Lander View".

In Mode B:
- Import `OrbitControls` from Three.js examples
- Camera moves to position `(0, 2000, 2000)` looking at `(0, 0, 0)`
- Enable OrbitControls (zoom, pan, rotate)

In Mode A:
- Disable OrbitControls
- Reset camera to `(0, 2, 0)` with custom drag-to-look

Store the current mode in a variable. The render loop checks the mode and applies the correct control scheme.

### Step 12: Directional Light Shadows (H12)

```javascript
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.castShadow = true;

// Shadow camera must cover the terrain
sunLight.shadow.camera.left = -30000;
sunLight.shadow.camera.right = 30000;
sunLight.shadow.camera.top = 30000;
sunLight.shadow.camera.bottom = -30000;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 200000;

// Shadow map quality
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.bias = -0.0005;
sunLight.shadow.normalBias = 0.05;

// Position the light along the Sun direction, far away
function updateSunLight(sunAz, sunEl) {
  const dir = bodyDirection(sunAz, sunEl);
  sunLight.position.copy(dir.multiplyScalar(100000));
  sunLight.target.position.set(0, 0, 0);
}

// Enable shadow receiving on terrain
nearMesh.receiveShadow = true;
nearMesh.castShadow = true;
farMesh.receiveShadow = true;
farMesh.castShadow = true;
```

**Warning:** At grazing Sun angles (1°–3°), shadow maps produce heavy artifacts (shadow acne, peter-panning). Tuning `bias` and `normalBias` is trial and error. Spend at most 30 minutes on this. If it looks bad, keep shadows for Mode B only and rely on the mask line overlay for Mode A.

### Step 13: Earth Direction Arrow (H13)

```javascript
const earthArrow = new THREE.ArrowHelper(
  bodyDirection(earthAz, earthEl),  // direction
  new THREE.Vector3(0, 2, 0),       // origin (lander mast)
  500,                               // length
  0x00ccff,                          // cyan color
  50,                                // head length
  25                                 // head width
);
```

Update the arrow direction every time the hour changes.

---

## 7. Build Guide: Phase 4 — Mode C Mission Replay (H16–H18)

### Step 14: Shared Store Integration (H16)

M3 provides a shared state object. Subscribe to it:

```javascript
// If using Zustand:
const unsub = useMissionStore.subscribe((state) => {
  if (state.currentTime !== lastTime) {
    lastTime = state.currentTime;
    const hourIndex = timeToHourIndex(state.currentTime);
    updateBodies(hourIndex);
    updateSunLight(angles.sun_az[hourIndex], angles.sun_el[hourIndex]);
    updateStatus(hourIndex);
  }
  if (state.siteId !== lastSiteId) {
    lastSiteId = state.siteId;
    loadSite(state.siteId); // reload terrain, angles, mask, results
  }
});
```

If the shared store isn't ready yet, build a standalone version with the same shape and replace later.

### Step 15: Play/Pause & Speed Controls (H16)

```javascript
let playing = false;
let speed = 1; // hours per tick
let tickInterval = null;

function play() {
  playing = true;
  tickInterval = setInterval(() => {
    const next = currentHourIndex + speed;
    if (next >= maxHours) { pause(); return; }
    setCurrentHour(next); // updates store → triggers scene update
  }, 100); // 100ms per tick = 10 ticks/sec at 1× speed
}

function pause() {
  playing = false;
  clearInterval(tickInterval);
}
```

Speed options: `1×` (real-time hourly), `10×`, `50×`, `200×`. At 200×, the slider moves 200 hours per tick at 10 ticks/sec = covering a full year in ~4.4 seconds.

UI: Play ▶ / Pause ⏸ button, speed dropdown, current timestamp display.

### Step 16: Jump to First Failure (H17)

Requires `missionLogic.js` from M1. If not available yet, implement a simple version:

```javascript
function findFirstFailure(results, startHour, duration, requirements) {
  for (let h = startHour; h < startHour + duration && h < results.sun_lit.length; h++) {
    // Check: night exceeds max
    // Check: comm gap exceeds max
    // Check: accumulated sun % below minimum
    // Return the first hour where any requirement breaks
  }
  return null; // no failure
}
```

On "Jump to First Failure" click:
1. Find the failure hour index
2. Set `currentTime` in the store to that hour
3. Read what caused the failure (Sun blocked or Earth blocked)
4. Get the azimuth of the blocking body at that hour
5. Animate the camera to look in that direction:
   ```javascript
   const targetYaw = -failureAzimuth * Math.PI / 180;
   // Smooth interpolation over 500ms using requestAnimationFrame
   ```
6. Show the failure banner:
   ```html
   <div class="failure-banner">
     ⚠️ Earth blocked for 41h starting 2027-03-12 04:00 UTC
   </div>
   ```

---

## 8. Build Guide: Phase 5 — Polish, Performance & Labels (H18–H22)

### Performance Targets

| Device | Target FPS | How to Hit It |
|---|---|---|
| Desktop with GPU | 60 FPS | Should work naturally |
| Laptop with integrated GPU | 30+ FPS | Reduce shadow map to 1024, reduce far mesh to 256×256 |
| Phone (stretch) | 20+ FPS | Disable shadows entirely, reduce both meshes to 256×256 |

### Key Optimizations
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` — cap at 2× to avoid 4K rendering
- Dispose geometry/material when switching sites: `oldMesh.geometry.dispose(); oldMesh.material.dispose();`
- Load only the current site's data. Don't preload all 5.
- Use `BufferGeometry` only (never `Geometry` — it's removed in modern Three.js anyway)

### Labels and Disclaimers

**Permanent watermark** (bottom-right of canvas, semi-transparent):
> *"Visual aid. Numbers come from the offline engine. Raycast shown for consistency check."*

**Scenario model disclaimer** (on the lander state panel):
> *"Scenario engineering model. Battery and power parameters are user-editable assumptions, not official NASA spacecraft specifications."*

---

## 9. Data Overlay System (Slope, Rock Abundance, Thermal Inertia)

### Research Finding: Moon Trek WMTS Tiles

Moon Trek serves pre-rendered map tiles for dozens of NASA datasets via a free, no-auth REST endpoint:

```
Base URL: https://trek.nasa.gov/tiles/Moon/SP/{LAYER_ID}/1.0.0/default/{TileMatrixSet}/{z}/{y}/{x}.png
```

- `SP` = South Pole stereographic projection
- No API key required
- Each tile is a small PNG (a few KB)
- Layer catalog: `https://trek.nasa.gov/tiles/Moon/SP/WMTSCapabilities.xml`

**M2 identifies the exact layer IDs and caches the relevant tiles for our 5 sites.** I receive them as PNG files or URLs.

### Overlay Architecture

The terrain mesh supports swappable textures via a shader uniform:

```javascript
const terrainMaterial = new THREE.ShaderMaterial({
  uniforms: {
    heightMap: { value: terrainTexture },
    overlayMap: { value: null },         // swapped per layer
    overlayOpacity: { value: 0.0 },      // 0 = terrain only, 0.7 = overlay visible
    activeLayer: { value: 0 },           // 0=none, 1=slope, 2=rock, 3=thermal
  },
  // ... vertex and fragment shaders
});
```

Or simpler approach: just swap the `map` texture on a `MeshStandardMaterial`:

```javascript
function setOverlay(layerName) {
  if (layerName === 'slope') {
    terrainMaterial.map = slopeTexture;
  } else if (layerName === 'rock') {
    terrainMaterial.map = rockTexture;
  } else {
    terrainMaterial.map = null; // plain gray
  }
  terrainMaterial.needsUpdate = true;
}
```

### Slope Overlay (Computed Locally, No Extra Data)

Slope can be computed directly from the heightmap in JavaScript:

```javascript
function computeSlopeTexture(heightData, nx, ny, cellM) {
  const canvas = document.createElement('canvas');
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(nx, ny);

  for (let row = 1; row < ny - 1; row++) {
    for (let col = 1; col < nx - 1; col++) {
      const idx = row * nx + col;
      const dzdx = (heightData[idx + 1] - heightData[idx - 1]) / (2 * cellM);
      const dzdy = (heightData[idx + nx] - heightData[idx - nx]) / (2 * cellM);
      const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;

      // Color: green (0°) → yellow (10°) → red (25°+)
      const r = Math.min(255, slopeDeg * 10);
      const g = Math.max(0, 255 - slopeDeg * 10);
      const pixelIdx = (row * nx + col) * 4;
      imgData.data[pixelIdx] = r;
      imgData.data[pixelIdx + 1] = g;
      imgData.data[pixelIdx + 2] = 0;
      imgData.data[pixelIdx + 3] = 200; // semi-transparent
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return new THREE.CanvasTexture(canvas);
}
```

### Legend

Each overlay needs a color legend div (HTML overlay, not 3D):

```
Slope:  ████████████  0° (flat)  →  15° (moderate)  →  30°+ (hazardous)
Rocks:  ████████████  <5% (smooth) → 10% (moderate) → 20%+ (rocky)
```

---

## 10. Critical Math Reference

### Body Direction Vector (Azimuth + Elevation → Three.js World)

```javascript
// az = degrees clockwise from true north
// el = degrees above local horizontal
// Returns a THREE.Vector3 in scene coordinates:
//   x = east, y = up, z = south (so -z = north)

function bodyDirection(azDeg, elDeg) {
  const az = azDeg * Math.PI / 180;
  const el = elDeg * Math.PI / 180;
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),    // east component
    Math.sin(el),                    // up component
    -Math.cos(el) * Math.cos(az)    // north component (negated because north = -z)
  );
}
```

### Three.js Coordinate System

```
        +Y (Up / Zenith)
         |
         |
         |_______ +X (East)
        /
       /
      +Z (South)

North = -Z
West  = -X
Azimuth 0° (North)  → direction (0, 0, -1)
Azimuth 90° (East)  → direction (1, 0, 0)
Azimuth 180° (South)→ direction (0, 0, 1)
Azimuth 270° (West) → direction (-1, 0, 0)
```

### Heightmap Grid to Three.js Position

```
Heightmap:  row 0 = southernmost, col 0 = westernmost
            row increases toward north
            col increases toward east
            value = height in meters (curvature baked in, lander at 0)

Three.js:   After PlaneGeometry.rotateX(-PI/2):
            vertex index increases along +X then +Z (east then south)

Mapping:    heightmap[row][col]
            → x = (col - nx/2) * cellM        (east-west centered on lander)
            → z = ((ny-1-row) - ny/2) * cellM  (FLIP row: row 0=south maps to +Z)
            → y = heightmap[row * nx + col]     (height)
```

**THE FLIP IS CRITICAL.** If you skip it, the terrain is mirrored north-south and the mask line won't match the ridges. Verify by checking that the highest terrain feature is in the expected compass direction.

---

## 11. File Formats I Load

| File | Format | How to Load |
|---|---|---|
| `*.json` | Standard JSON | `fetch(url).then(r => r.json())` |
| `*_near.bin`, `*_far.bin` | Raw Float32 binary | `fetch(url).then(r => r.arrayBuffer()).then(buf => new Float32Array(buf))` |
| Moon Trek tiles (`.png`) | Standard image | `new THREE.TextureLoader().load(url)` |

---

## 12. Shared State Contract with M3

M3 owns a reactive store with this shape:

```javascript
{
  siteId: 'site04',               // which site is active
  startDate: '2027-01-01',        // mission nominal start
  delayDays: 0,                   // 0–30, user adjustable
  durationDays: 14,               // mission length
  currentTime: '2027-01-05T12:00Z', // current simulation time
  currentHourIndex: 108,          // precomputed index into arrays
  isPlaying: false,
  speed: 1,                       // 1, 10, 50, 200
  viewMode: 'lander',             // 'lander' | 'overview'
  requirements: {
    minSunPct: 40,
    maxNightH: 36,
    maxCommGapH: 24,
  },
  lander: {
    batteryWh: 1500,
    solarW: 250,
    loadW: 80,
  },
  firstFailure: {                 // computed by missionLogic.js
    hourIndex: 124,
    type: 'comm_gap',
    message: 'Earth blocked for 41h starting 2027-03-12 04:00 UTC',
    bodyAz: 14.2,                 // azimuth of the blocked body
  }
}
```

**What I read:** `siteId`, `currentHourIndex`, `isPlaying`, `speed`, `viewMode`, `firstFailure`.

**What I write:** `currentHourIndex` (when the user drags the time slider in the 3D view), `viewMode` (when toggling Mode A/B), `isPlaying` (play/pause from the 3D controls).

If M3's store isn't ready, build a plain JS object with `addEventListener`/`dispatchEvent` pattern and swap later.

---

## 13. What I Do NOT Build

These are explicitly out of scope for the hackathon per the team brief:

| Do NOT Build | Reason |
|---|---|
| Rover driving physics | No soil interaction data exists. Would take 2+ weeks. Deferred to post-hackathon. |
| Landing leg stress simulation | Requires proprietary lander structural data. No NASA dataset provides this. |
| Soil bearing strength estimation | Never measured at south pole. Inventing data violates Rule #1. |
| 3D globe | Out of scope per brief. We show local terrain tiles, not a whole Moon. |
| Real thermal/battery physics | Beyond a simple SoC model. Brief says "simple user-set power budget" only. |
| Unreal Engine / desktop .exe | Judges need a public URL that opens instantly. |

---

## 14. Cut List (What Gets Dropped First If Behind)

In strict order — drop from the top first:

1. Level 2 shader shadows (keep Level 1)
2. Exaggerate bodies toggle
3. Side-by-side original vs delayed split view
4. Mode B overview shadows (render overview without shadows)
5. Camera presets ("Look at Sun" etc.)
6. Rock abundance overlay (keep slope — it's free)
7. Thermal inertia overlay
8. Descent camera animation
9. Lander state panel (battery SoC gauge)

**NEVER cut:**
- Mode A with horizon mask line overlay
- Mode C replay with "Jump to First Failure"
- Engine vs raycast agreement metric
- "Visual Aid" watermark

---

## 15. Validation Checks (How I Know It's Right)

### Visual Sanity Checks (Do These Immediately When Real Data Loads)

| Check | What to Look For | If Wrong |
|---|---|---|
| **Mons Malapert direction** | The tallest far-field feature should appear roughly toward Earth's average position (near azimuth ~0°–30°, i.e., roughly north). Compare with QuickMap 3D view. | Terrain is rotated or mirrored. Check row/column flip and azimuth convention. |
| **Shackleton crater** (Site04) | A deep depression should be visible near the site. In Mode B, it should appear as a dark shadow hole. | Heightmap values are inverted (heights as depths). Check sign. |
| **Mask line on ridge** | The green mask line should sit on top of the terrain ridge peaks, not float above or cut through. | Azimuth convention mismatch, or the `R` distance for the mask line needs adjustment, or curvature offset is wrong. |
| **Sun cycle** | Sun should complete roughly one full azimuth rotation every ~708 hours (~29.53 days). Elevation should peak at ~1.5°–7° and dip below the horizon periodically. | Angles data is wrong. Report to M1. |
| **Earth position** | Earth should hover near the northern horizon (az ~0°–30°) and oscillate in elevation over weeks. It should NOT zip across the sky or go to zenith. | Coordinate frame mismatch. Report to M1. |

### Raycast Agreement Check

M2 provides `raycast.js`. Wrap it in a Web Worker:

```javascript
// raycastWorker.js
self.onmessage = function(e) {
  const { angles, mask, nearGrid, farGrid, obsHeight } = e.data;
  let agree = 0, total = angles.sun_az.length;

  for (let i = 0; i < total; i++) {
    const engineSunLit = angles.sun_el[i] > interpolateMask(mask, angles.sun_az[i]);
    const raycastSunLit = checkVisibilityRay(angles.sun_az[i], angles.sun_el[i], obsHeight, nearGrid, farGrid);
    if (engineSunLit === raycastSunLit) agree++;
  }

  self.postMessage({ agreement: (agree / total * 100).toFixed(1) });
};
```

Display: `"Raycast agrees with engine: 99.7% of 8760 hours"` — visible in the status panel.

---

## 16. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Heightmap row/col flip | High | Terrain mirrored, mask doesn't match | Test Site04 against QuickMap immediately. Check Mons Malapert direction. |
| M2 delivers `.bin` late | Medium | Stuck on fake data past H6 | Fake terrain still lets you build Mode A controls, mask line, status badges. Ping M2 aggressively at H4. |
| Shadow acne at low Sun | High | Ugly visual artifacts in Mode B | Accept it. Use Level 1 only in Mode B overview. Mode A uses mask line instead of shadows. |
| Float32 textures not supported on some phones | Medium | Overlay shader fails on mobile | Fallback: convert to Uint8 texture. Or: skip overlays on mobile, show terrain only. |
| Performance on integrated GPU | Medium | Slideshow FPS in Mode B with shadows | Reduce shadow map to 1024. Reduce far mesh to 256×256. Disable shadows on mobile. |
| M3's shared store has a different shape | Low | Integration breaks | Build to the contract above. If it changes, the adapter is ~10 lines. |
| Canvas resize issues in two-pane layout | Medium | Three.js renders at wrong size | Handle `resize` event: update camera aspect and `renderer.setSize`. |
| Three.js version conflicts with M3's bundler | Low | Build errors | Coordinate with M3 on Three.js version in `package.json` in H0. Pin to a specific version (e.g., `0.160.0`). |

---

*Last updated: Pre-hackathon night. Will be updated during the build as decisions change.*
