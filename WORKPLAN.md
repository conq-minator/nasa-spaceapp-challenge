# LunaWise: remaining work plan (who builds what, in what order)

> Written after merge `94fb7c0` (PR #5) on 14 Nov 2026. This covers **everything not built yet**, from
> `goal.md`, the simulation addendum, and the official challenge text. Each task has its files,
> interfaces, the exact numbers to use, and a "done when" check.
> **Read sections 0–3 first (everyone), then your own section.**

> **Status 14 Nov, 22:53: backend complete.** Everything the front end reads is on `main` and tested:
> - **Data:** `data_out/sites.json`, `nearby.json` (20 computed points 1 km N/E/S/W), `mask/`,
>   `heightmap/`, `angles/`, `results/` (now with `sun_margin_deg` / `earth_margin_deg`), and
>   `validation.json`.
> - **Logic:** `web/src/core/missionLogic.js` adds `countdowns()`, `nextChange()`, `countdownText()` and
>   `sunElevationStats()` (M1.1–M1.3).
> - **Done:** M1.1–M1.4, M1.6, M2.1–M2.5, M2.7 and M5.1. Optional and not done: M2.6 (LDEC).
> - **Remaining work is front end and write-up only:** M3 (dashboard, store, deploy), M4.1/M4.2
>   (store + HUD countdowns, plus using `nearby.json` instead of `computeCustomEphemeris()`), and
>   M5.2–M5.7.
> - Rebuild validation: `node docs/make_validation.mjs`. Demo numbers: `node docs/demo_numbers.mjs`.

Roles follow `goal.md`: **M1** engine · **M2** terrain · **M3** dashboard · **M4** simulation ·
**M5** validation & submission. `README.md` lists six people. If you have a sixth, they take the
**M6** tasks (section 9), which are split off from M5's write-ups. Put names next to the roles in
the table in section 10 once agreed.

---

## 0. Rules for everyone (read first)

1. **Every number on screen comes from `data_out/` or a function in `web/src/core/missionLogic.js`.**
   Never type a number into HTML/JS/the demo script. If a value isn't computed yet, show `—`.
2. **Git:** work on your own branch (`m1-…`, `m3-dashboard`, …). `git pull origin main` before you
   start and before you open a PR. PR into `main`, and get one teammate to glance at it.
   **Never edit another member's files without telling them**; the owner table is in section 3.
3. **One source of truth:**
   - Mission rules → `web/src/core/missionLogic.js` (M1).
   - Ray-cast → `Member2/src/raycast.js` (M2).
   - Data → `data_out/` (M1 + M2).
   - Don't copy these files; import them.
4. **Contract freeze:** after the JSON-freeze point (section 2, step F), no field is renamed or
   removed. Only adding optional fields is allowed, and only after telling everyone.
5. **Labels that must stay visible:**
   - "Scenario assumption, not NASA data" on battery/solar/load.
   - "Visual aid. Numbers come from the engine; ray-cast shown for consistency check."
   - "Point Sun/Earth" and "2 m mast" in the About panel.

---

## 1. Where we are (done and merged)

| Piece | Owner | State |
|---|---|---|
| Terrain: 5 sites, 5 m + 20 m DEM to 200 km, masks for 0/2/5/10 m, near/far heightmaps | M2 | ✅ `data_out/sites.json`, `mask/`, `heightmap/` |
| Ray-cast cross-check + Web Worker | M2 | ✅ `Member2/src/` (agreement 99.7–100% on checkable hours) |
| Sun/Earth angles, every hour of 2027, SPICE MOON_ME, checked vs Horizons (≤0.0005°) | M1 | ✅ `data_out/angles/` |
| Hourly flags + yearly summary | M1 | ✅ `data_out/results/` |
| Mission rules: window, delay, first failure, battery, ranking, messages | M1 | ✅ `web/src/core/missionLogic.js` (17 tests) |
| 3D lander view on real data: skyline, mask line, Sun/Earth, replay, jump to failure, delay input | M4 | ✅ `Member4/` (no hard-coded numbers) |

**Not built** (this document): the dashboard, the shared state between dashboard and 3D view, the
public deployment, sunset/Earthset countdowns, prominent solar elevation, site comparison,
validation table, methods/About/explainer text, demo, and submission. Plus M2/M4 polish.

---

## 2. Order of work (dependency graph)

```
A  (all, 15 min)  agree on section 3 decisions + store keys ─────────────┐
                                                                         │
B  M3 app shell + store.js + deploy empty page ───────┐                  │
   M1 countdowns + margins + elevation stats ──────┐  │                  │
   M2 skyline plots, Goddard numbers, limits text  │  │                  │
   M5 validation.json draft, README skeleton       │  │                  │
   M4 cleanup + store hooks + HUD slots            │  │                  │
                                                   ▼  ▼                  │
C  M3 dashboard on real JSON (site, delay, timeline, metrics, banner) ◄──┘
   M1 rebuild results with margin fields → data_out/results (FREEZE CANDIDATE)
D  M3 ↔ M4 linking: delay slider / timeline click moves the 3D clock
   M3 comparison table + delay-tolerance strip
E  ===== CHECKPOINT 2 (section 11) =====
F  JSON CONTRACT FREEZE: from here only values can change, not fields
G  M3 About + explainer panels, mobile, loading/error states
   M4 shadows, labels, performance; M2 final check
H  ===== HARD FEATURE FREEZE: bug fixes and text only =====
I  M5: release candidate on the public URL, fresh-device test, demo video, submission
```
Steps on the same line run **in parallel**. Nobody waits on M3's dashboard to start their own tasks.

---

## 3. Decisions everyone builds on

### 3.1 One app, one URL
The final product is **one Vite app: `Member4/`** (it already builds, syncs `data_out/` into
`public/data`, and bundles M1's and M2's modules).
- **M3 adds the dashboard inside it**, as a left pane: `Member4/src/dashboard/` and `Member4/src/store.js`.
- The 3D view stays in M4's files, as the right pane. They're stacked on phones.
- Vanilla JS modules, **no React**. `Member4/` is vanilla, and adding React now costs hours.
- `web/` stays as the home of the shared `missionLogic.js` and its tests. Nothing in `web/` is deployed.

### 3.2 Shared store (addendum section 6): `Member4/src/store.js`, owned by M3
```js
// Member4/src/store.js
const state = {
  siteId: 'site04',
  startDate: '2027-01-09T00:00:00Z',     // nominal landing (default: see section 12)
  delayDays: 0,                            // 0..30
  durationDays: 14,
  currentHour: null,                       // absolute index into results.t / angles
  isPlaying: false,
  speed: 10,
  requirements: { minSunPct: 40, maxNightH: 36, maxCommGapH: 24 },
  lander: { capacityWh: 1500, solarW: 250, loadW: 80 },   // scenario assumption, not NASA data
};
const subs = new Set();
export const store = {
  get: () => state,
  set(patch) { Object.assign(state, patch); subs.forEach((f) => f(state, patch)); },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
};
```
- `requirements` + `lander` are passed to `missionLogic.evaluate()` as
  `{ ...requirements, battery: lander }`. `missionLogic.js` takes `capacityWh, solarW, loadW`.
- **Dashboard writes:** `siteId`, `startDate`, `delayDays`, `durationDays`, `requirements`, `lander`, and
  `currentHour` (timeline click).
- **3D view writes:** `currentHour` (during replay), `isPlaying`, `speed`.
- **Both read everything.** When `siteId` changes, the 3D view calls `loadDataset`. When any mission
  field changes, it re-runs `evaluateMission()`.

### 3.3 File ownership (who may edit what)
| Path | Owner |
|---|---|
| `Member1/**`, `web/src/core/missionLogic.js`, `web/tests/**`, `data_out/angles`, `data_out/results` | M1 |
| `Member2/**`, `data_out/sites.json`, `data_out/mask`, `data_out/heightmap` | M2 |
| `Member4/src/store.js`, `Member4/src/dashboard/**`, `Member4/src/style.css` (dashboard part), `.github/workflows/**` | M3 |
| `Member4/src/simulation/**`, `Member4/src/core/**`, `Member4/src/main.js` (simulation part), `Member4/scripts/**`, `Member4/vite.config.js` | M4 |
| `Member4/index.html` | M3 does the two-pane layout **once**, with M4 reviewing; after that, each edits only their own pane |
| `README.md`, `data_out/validation.json`, `docs/**` (methods, credits, AI disclosure, demo script) | M5 (M6 if present) |
| `goal.md` | nobody rewrites it; M5 adds a "corrections" note (section 8, task M5.7) |

---

## 4. M1 (engine): tasks in order

### M1.1 Countdowns: "Sunset in X h / Earthset in Y h" (new, from the challenge text) · ~45 min
The challenge calls time-to-sunset/Earthset "critical operational information". Add to
`web/src/core/missionLogic.js`:
```js
/**
 * Hours until flags[k] changes value, looking forward from hour k.
 * Returns { now: 0|1, hours, at } where `at` = timestamp of the first hour with the other value,
 * or { now, hours: null, at: null } if it never changes before the end of the data.
 * Resolution is 1 hour (say "about" or "±1 h" in the UI).
 */
export function nextChange(flags, t, k) { ... }

/** Both bodies at hour k: { sun: nextChange(sun_lit), earth: nextChange(earth_vis) }. */
export function countdowns(results, k) { ... }
```
- UI wording (for M3/M4): if `now === 1`: "Sunset in N h (at …)"; if `now === 0`: "Sunrise in N h".
  Same for "Earthset" / "Earthrise".
- `hours: null` → "no sunset before end of data (2027-12-31)".
- **Tests** in `web/tests/missionLogic.test.js`: all 1s → hours null; `[1,1,0]` at k=0 → 2;
  `[0,1]` at k=0 → 1; k at the last index → null.

### M1.2 How far above the skyline: margin fields in results (additive) · ~30 min
Solar elevation drives power, and the challenge wants it shown prominently. "Sun is 0.8° above the
ridge" is more useful than raw elevation. In `Member1/pipeline/combine.py`, add to every
`results/<site>.json`:
```
"sun_margin_deg":   [8760 numbers]   sun_el   - horizon_at(mask, sun_az),   2 dp
"earth_margin_deg": [8760 numbers]   earth_el - horizon_at(mask, earth_az), 2 dp
```
- Positive means above the terrain; this is the same quantity that decides `sun_lit`/`earth_vis`.
- Re-run `py -m pipeline.combine`. Check that `sun_lit[k] == (sun_margin_deg[k] > 0)` for every k
  (rounding edge cases at exactly 0.00 are fine).
- Tell M3/M4 when it's on `main`. **This must land before the JSON freeze (step F).**

### M1.3 Solar elevation stats for a window · ~30 min
In `missionLogic.js`:
```js
/** From angles/<site>.json over the window: { nowDeg, maxDeg, maxAt, minDeg, meanLitDeg }.
 *  meanLitDeg = mean sun_el over hours where sun_lit == 1 (null if none). */
export function sunElevationStats(angles, results, win, k) { ... }
```
- M3 shows `nowDeg` big on the metric cards, and `maxDeg` as "highest Sun in window".
- Add tests with small hand-made arrays.

### M1.4 `Member1/requirements.txt` + `Member1/README.md` · ~15 min
- `requirements.txt`: `spiceypy`, `requests`, `numpy`, `pytest`, with versions you used.
  Without `requests`, 2 tests fail on a fresh machine.
- `README.md`: how to run `get_kernels`, `frame_check`, `make_angles`, `combine`; the Horizons
  check result (≤0.0005°); the kernel list.

### M1.5 (stretch, only with M2.7) angles for "nearby points" · ~20 min
If M2 adds neighbour points to `data_out/sites.json`, `make_angles` and `combine` already loop over
`sites.json`. Re-run both and commit. Nothing else changes.

### M1.6 Final data rebuild + freeze check · ~20 min (step H)
Re-run `make_angles` (only if sites changed) and `combine`, run all tests, and confirm
`git status` shows only data value changes. Tell M5 the final numbers are frozen.

**Done when (M1):** `countdowns`, `sunElevationStats` and the margin fields are on `main` with tests;
`requirements.txt` exists; all Python and JS tests pass.

---

## 5. M2 (terrain): tasks in order

### M2.1 Skyline sanity plots (`goal.md` M2 H8–10; addendum "check the Site04 skyline by eye") · ~30 min
- Script: `Member2/pipeline/plot_skylines.py` (matplotlib) → `docs/skylines/<site>.png`.
- Plot `elev_deg_by_mast["2"]` against azimuth 0–360. Shade where `horizon_dist_km` > 30.7 km, the
  part the 3D view can't show.
- Overlay a year of Sun and Earth tracks (`angles/<site>.json`) as faint dots.
- Look at each plot and write one line per site in `docs/skylines/README.md`: highest ridge
  azimuth and height, and where Earth sits.
- M5 uses these on the methods page; M4 uses them to compare with the 3D skyline.

### M2.2 Goddard reference numbers for validation · ~40 min
- For each of the 5 site points, sample the PGDA 69 maps:
  - Sun: `AVGVISIB_85S_060M_201608.TIF`, already downloaded.
  - Earth: `AVGVISIB_85S_060M_201608_EARTH.TIF`, from https://pgda.gsfc.nasa.gov/data/MoonIllumination/.
    Check its size first; the Sun map was 34 MB.
- Values are int16 × 4e-05 = fraction.
- Hand M5 a table: site, Goddard sun %, Goddard Earth %, our 2027 `sun_pct`/`earth_pct` at 0 m and
  2 m (from `results/<site>.json` `summary_by_mast`).
- Already measured (Sun, at our points): site01 68.5%, site04 66.2%, site07 58.2%, site11 79.4%,
  site23 70.8%. Our 2 m `sun_pct`: 86.1, 80.2, 82.6, 83.0, 74.9.

### M2.3 Terrain limits text for the methods page (`goal.md` M2 H14–17) · ~30 min
Write `docs/methods_terrain.md` (M5 merges it into the methods page and the About panel). Points to cover:
- DEMs: PGDA 78 5 m tiles (Barker et al. 2021) + LOLA LDEM_80S_20M; R = 1737.4 km sphere.
- ~90% of 5 m pixels are interpolated between laser tracks (Barker et al. 2021).
- Horizon = max 3D elevation angle along geodesic walks to 200 km; Site23 reaches only 181 km in
  some directions (edge of the 20 m mosaic).
- Mast 2 m nominal. The 0 m mask is dominated by neighbouring pixels: don't use it for results.
- Site points: largest PGDA ROI (Sites 01/04/07/11); Site23 has no ROI on PGDA, so PGDA's own >70%
  rule was applied to the PGDA 69 illumination map (lands 55–232 m from PGDA points on the other 4).
- Ray-cast agreement shows that the code and conventions are consistent, **not** that the terrain is
  accurate.
- The 3D heightmaps reach 30.7 km. Ridges farther away are in the mask line but not in the 3D mesh.

### M2.4 Fix the worker example comment · 5 min
In `Member2/src/raycastWorker.js`, change the usage comment to
`basePath: new URL('./data', document.baseURI).href`. A worker resolves relative URLs against its
own location, so `"./data"` breaks.

### M2.5 `Member2/pipeline/fetch_data.py`: one command to get all raw data · ~30 min
- Downloads into `data_raw/` and skips files already present.
- Checks each download is not an HTML page and has the expected size. PGDA returns "Not Found"
  pages with HTTP 200.
- Files: the 5 `SiteXX_final_adj_5mpp_surf.tif`, 4 `SiteXX_ROIs.tgz` (+ unpack),
  `LDEM_80S_20M_FLOAT.IMG/.LBL` (3.7 GB), `AVGVISIB_85S_060M_201608.TIF`.
- Links: `Member2/README.md`.
- Also put a copy on a shared Google Drive / USB stick before the demo, in case of venue Wi-Fi.

### M2.6 (optional) LDEC "how much is measured" · ~1 h
- Download `SiteXX_final_adj_5mpp_ldec.tif` (about 40 MB each; check first).
- For each site report: % of pixels within 500 m and within 2 km of the site point that have ≥1
  LOLA shot.
- Hand it to M5 for the honest-limits table (`goal.md` section 13 mentions this disclosure).

### M2.7 (stretch) nearby points: "small moves, big changes" · ~1.5 h
The challenge asks to show why small location changes matter. `README.md` rule 4 says
**never suggest "move N km" unless that point was actually computed**. So:
- In `sites_config.json`, add 4 points per chosen site (start with site04 and site11): 1 km N/S/E/W
  of the site point.
  - New fields: `"parent": "site04"`, `"offset_m": [east, north]`.
  - `export.py` gets a `point` mode that takes the parent's point plus the offset, then reads the
    ground height from the DEM.
- Run `export --site …` for them. Ids like `site04_n1km`. They go into `sites.json` with `parent` and
  `offset_m`, and get their own `mask/` and `heightmap/`.
- Tell M1 (M1.5) to generate angles/results, and tell M3 to add a "nearby points" switcher.
- Extra size: about 2 MB per point (heightmaps).

### M2.8 Help M4 with low-Sun shadows (`goal.md` M2 H14–17) · as asked
`goal.md` section 13 suggests `shadow.bias = -0.0005`, `shadow.normalBias = 0.05`, map 2048.
`CelestialBodies.js` has bias -0.0004 and no `normalBias`. Pair with M4 for 30 min if Mode B
shows striping.

### M2.9 Final terrain check before freeze · ~15 min (step H)
`py -m pytest Member2/pipeline/tests -q` (11 pass) and `node --test Member2/tests/` (9 pass,
agreement ≥99.5% on all sites). If any site's data changed, re-run `export --all`.

**Done when (M2):** plots in `docs/skylines/`, the Goddard table and `methods_terrain.md` handed to
M5, comment fixed, `fetch_data.py` works on a clean folder.

---

## 6. M3 (dashboard): the biggest remaining piece

All new files go under `Member4/src/dashboard/` and `Member4/src/store.js`. Import mission rules from
`../../../web/src/core/missionLogic.js`; the Vite config already allows it.

### M3.1 Layout + store + empty deploy (do this first) · ~1 h
1. `Member4/index.html`: wrap the current simulation in a right pane. Add
   `<aside id="dashboard">` on the left (about 380 px wide on desktop, stacked above the 3D view
   under 900 px). Ask M4 to review this one edit.
2. `Member4/src/store.js` exactly as in section 3.2.
3. `.github/workflows/pages.yml` (deploy `Member4/dist` on every push to `main`):
   ```yaml
   name: Deploy
   on: { push: { branches: [main] }, workflow_dispatch: {} }
   permissions: { contents: read, pages: write, id-token: write }
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 20 }
         - run: npm ci && npm run build      # prebuild copies data_out -> public/data
           working-directory: Member4
         - uses: actions/upload-pages-artifact@v3
           with: { path: Member4/dist }
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment: { name: github-pages }
       steps: [ { uses: actions/deploy-pages@v4 } ]
   ```
   The repo owner (Avasyu-hub) must set **Settings → Pages → Source = GitHub Actions** once.
   Put the URL in `README.md` (M5).

**Done when:** the public URL opens the current 3D view plus an empty left pane.

### M3.2 Load data for the selected site · ~30 min
- `sites.json` once; then per site: `results/<id>.json` and `angles/<id>.json`, from `./data/…`.
- Cache per site.
- Show "loading…", and on error "data not found for <id>". Never fall back to invented values.

### M3.3 Controls (write to the store) · ~1 h
| Control | Store field | Notes |
|---|---|---|
| Site picker (names from `sites.json`) | `siteId` | 5 sites (+ nearby points if M2.7 lands) |
| Nominal landing date (`<input type=datetime-local>`, UTC) | `startDate` | data covers 2027 only. If start + delay + duration runs past 2027-12-31, `evaluate()` returns `window.truncated = true`: show "window runs past the computed data" instead of a pass/fail |
| Delay slider 0–30 days | `delayDays` | live update while dragging |
| Mission duration (days, 1–30) | `durationDays` | default 14 |
| Requirements: min Sun %, max night h, max comm gap h | `requirements` | defaults 40 / 36 / 24 (`goal.md` 8.2 examples) |
| Battery Wh, solar W, load W | `lander` | defaults 1500/250/80; label "scenario assumption, not NASA data" |

### M3.4 Metric cards (read-only, recompute on every store change) · ~1 h
From `evaluate(results, {startDate, delayDays, durationDays}, {...requirements, battery: lander})`:
- **Sun visible %**, **Earth visible %**, **Both %** (`metrics.sunPct/earthPct/bothPct`)
- **Longest night** and **longest comm gap** in hours, with start time
- **Countdowns at the current hour** (M1.1): "Sunset in N h" / "Sunrise in N h",
  "Earthset in N h" / "Earthrise in N h"
- **Solar elevation now** (big) and **highest Sun in window** (M1.3), plus **"Sun X° above the
  ridge"** from `sun_margin_deg` (M1.2)
- **Battery minimum in window** (`batteryTrace(...).minWh`)
- Pass/fail badge: `pass` from `evaluate`

### M3.5 Timeline bars (`goal.md` §3, M3 H6–10) · ~1.5 h
- One `<canvas>` per row, covering the mission window:
  1. Sun visible (`sun_lit`)
  2. Earth visible (`earth_vis`)
  3. Battery % (`batteryTrace`)
  4. optional: solar elevation line
- Tick labels in UTC dates.
- A vertical cursor at `currentHour`, and a red marker at `failure.hourIndex`.
- **Click or drag on a timeline → `store.set({ currentHour })`**. The 3D view jumps there
  (addendum section 6).
- Hover tooltip: timestamp, Sun/Earth state, margins in degrees.

### M3.6 First-failure banner · ~20 min
Text = `failureMessage(failure, siteName)` from `missionLogic.js`, **nothing typed in**.
Button "Show in 3D" → `store.set({ currentHour: failure.hourIndex })`.

### M3.7 Site comparison (challenge: "side-by-side… rapid comparison") · ~1.5 h
1. **Comparison table:** all sites for the current start/delay/duration/requirements, using
   `rankSites(list, opts, req, sortBy)`. Columns: site, pass/fail, sun %, Earth %, longest night,
   longest gap, first failure (time + kind). Sort selector: one metric at a time, no combined score.
2. **Delay-tolerance strip:** for each site, 31 small squares for delays 0…30 days (`delayScan`),
   green = pass, red = fail. Clicking a square sets that site + delay.
   This answers "the launch slipped N days, which sites still work?" at a glance.
   With the default scenario (landing 9 Jan 2027) it shows Site23 tolerating 3 days of slip,
   Site11 2, Site01 1, and Site04 none. See section 12.

### M3.8 About panel + public explainer · ~45 min (after the checkpoint)
- **"About this data"** (`goal.md` M3 H18–21): text from M5 (M5.4), covering sources, limits
  (interpolated DEM, point Sun/Earth, 2 m mast, 1 h step, geometric line of sight only),
  ray-cast meaning, and the scenario battery.
- **"Why is the south pole hard?"** (new, for educators and the public), 4–5 short lines plus one
  picture (M2's skyline plot):
  - The Sun never gets more than ~1.5° plus your distance from the pole above the horizon.
  - A ridge 10–100 km away can block it.
  - Earth rocks up and down by about ±7° each month (libration), so it slips behind hills for
    days at a time.
  - Moving 1 km or waiting 1 day can flip a site from working to failing.

### M3.9 Polish (step G) · ~1 h
Mobile layout (dashboard stacked above the 3D view, nothing overflows at 375 px), loading/error
states, keyboard focus on controls, legend for timeline colours. Optional: URL state
(`?site=site11&start=2027-01-09&delay=3`) so the demo opens straight on the scenario.

**Done when (M3):** Checkpoint 2 passes (section 11), and the comparison table + delay strip work for
all 5 sites.

---

## 7. M4 (simulation): tasks in order

### M4.1 Connect to the store (addendum section 6) · ~1 h
- In `Member4/src/main.js` / `LanderSimulation.js`, read `siteId`, `startDate`, `delayDays`,
  `durationDays`, `requirements` and `lander` from `store`.
- `evaluateMission()` must use `store.get().startDate`, not `timestamps[0]`.
- On a `siteId` change → `loadDataset(siteId)`.
- On a mission change → `evaluateMission()` + jump to the window start.
- On a `currentHour` change from the dashboard → `setHourIndex(currentHour)`.
- During replay, write `currentHour` back with `store.set`, at most a few times per second.
- Remove the temporary delay input from the timeline bar once the dashboard slider works.

### M4.2 Countdowns + solar elevation in the HUD · ~30 min
Next to the Sun/Earth badges: "Sunset in N h · Sun 1.1° (0.8° above ridge)" and
"Earthset in N h". Use M1.1/M1.3 functions and `sun_margin_deg`. Show "—" until M1's fields exist.

### M4.3 Labels still missing (addendum sections 3 and 6) · ~20 min
- **Exaggeration toggle:** while 3× or 5× is on, show "Sun/Earth enlarged ×N for visibility (true
  sizes 0.53° / 1.9°)".
- **WASD walking:** when the camera is more than 50 m from the lander, show "Mask line is for the
  lander position; you are N m away".
- **Agreement box tooltip** already says what the check proves. Keep it.

### M4.4 Mode B shadows at low Sun (`goal.md` section 13) · ~45 min
In `CelestialBodies.js`, add `this.sunLight.shadow.normalBias = 0.05`, try `bias = -0.0005`, and keep
the 2048 map. If striping stays, fit the shadow camera to the 61 km far grid. Pair with M2 (M2.8).
Cut-list item 4 allows dropping overview shadows if it eats time.

### M4.5 Remove dead code · ~15 min
These are unused since PR #5:
- `Member4/src/core/missionLogic.js` (copy of M1's)
- `Member4/src/core/raycast.js`
- `Member4/src/core/raycastWorker.js`
- `Member4/src/core/landerModel.js`

Delete them, run `npm run build`, and check nothing breaks. `fakeData.js` stays for the synthetic
fallback.

### M4.6 Orientation checks on Site04 (replaces `goal.md`'s Malapert/"south" claims) · ~20 min
Measured from our data, so use these:
- **Earth direction:** at site04, Earth's azimuth stays between **149° and 165°** all year.
- **Shackleton's floor:** about **4.6 km below** the lander, **12.9 km away, toward azimuth ~242°**
  (west-southwest). The terrain should drop away steeply in that direction. It is **not** "to the
  south", as `goal.md` section 13 says.
- **Malapert:** 128 km away at azimuth 160°, beyond the 30.7 km mesh and below the nearby rim.
  It won't appear as a mountain.
- **Mask line:** sits on the rendered skyline wherever the blocking ridge is < 30 km away, and floats
  above it where the ridge is farther (expected).

Compare a screenshot with M2's `docs/skylines/site04.png`.

### M4.7 Synthetic fallback check · 10 min
Rename `public/data` temporarily. The app must show "DATA: SYNTHETIC DEMO" and "synthetic:" in the
agreement box, never real site names with fake numbers.

### M4.8 Performance + phone pass (addendum H18–21) · ~45 min
Test on a low-end laptop and a phone. Keep 512×512 meshes, load only the current site, and dispose
geometries on site switch. Stretch only after everything else: original-vs-delayed side-by-side
(cut-list item 3).

**Done when (M4):** the dashboard and 3D view stay in sync both ways, the countdowns show, labels are
present, dead files are gone, `npm run build` passes, and there are no console errors on all 5 sites.

---

## 8. M5 (validation, write-up, submission)

### M5.1 `data_out/validation.json` (`goal.md` §5.2 #6) · ~1 h
One row per site and metric, schema
`{ site, metric, ours, reference, source, diff, notes }`:
- `sun_pct`: ours = `results/<site>.json` `summary.sun_pct` (2 m, all of 2027); reference = M2.2's
  Goddard value at the site point.
- `earth_pct`: same, with Goddard's Earth map (from M2.2).
- `raycast_agreement_sun` / `_earth`: read them from the app's agreement box for each site (computed
  live over the full year).
  - Measured so far: site01 Sun 99.92% / Earth 100.00%; site04 99.81% / 99.93%; site07 99.92% /
    99.95%; site11 99.92% / 100.00%; site23 99.65% / 99.97%.
  - Each is over the hours the 30.7 km heightmap can check. Record the "checked" hour counts the
    app shows too.
- `horizons_vs_spice_max_deg`: 0.0005 (`angles/<site>.json` `horizons_max_diff_deg`).
- `far_minus_near_dem_median_m`: from `mask/<site>.json` `dem.far_minus_near`.

**Notes must explain the Sun gap honestly.** Our 2 m values are 4–24 points above Goddard. Likely
reasons, stated as likely, not proven:
- Goddard's 60 m pixels average in lower ground around these peaks.
- Different time span (multi-year vs 2027).
- Different observer height. At 0 m ours drop to 37–54%.
- Point Sun vs partial disc is negligible here (≤0.2 points).

### M5.2 README rewrite (`goal.md` §12.2 checklist) · ~1 h
`README.md` is currently the old architecture proposal. Rewrite it to cover:
- problem, live URL, screenshot
- how it works (data flow diagram from this file)
- how to run (`Member4`: `npm ci && npm run dev`; pipelines: `Member1/README.md`, `Member2/README.md`)
- data sources and citations (Barker et al. 2021; LRO LOLA / PDS; NASA Goddard PGDA 69/78;
  NAIF SPICE DE440; JPL Horizons; ASU QuickMap)
- limits, validation table, team roster with roles, AI-use disclosure.

### M5.3 QuickMap / Moon Trek visual check (addendum M5 H10–14) · ~45 min
For site04: a QuickMap 3D/terrain screenshot from the lander point looking toward 242°
(Shackleton) and toward Earth (149–165°), next to the app's lander view at the same azimuths.
Put them in `docs/validation/`. Record layer, date, and the exact lat/lon from `sites.json`.

### M5.4 Methods + About text · ~45 min
Merge M2.3's `methods_terrain.md`, M1's engine notes, and the validation table into
`docs/methods.md`. Give M3 a short version for the About panel and the "Why is the south pole
hard?" explainer.

### M5.5 Demo script with real numbers · ~30 min
`goal.md` §12.1 uses numbers nobody computed ("92% illumination", "41 consecutive hours", "99.8%").
**Replace them with section 12 below.** Lead with the simulation (addendum section 9). Keep it to
the official length limit.

### M5.6 Release candidate, fresh-device test, video, submission (`goal.md` §12.2) · ~2 h
- Open the public URL logged out, in incognito, and on a phone over mobile data. Check for console
  errors on all 5 sites.
- Record the demo plus a backup take.
- Submit: live URL, repo, video, AI disclosure, credits.

### M5.7 `goal.md` corrections note · 10 min
Add a short section at the end of `goal.md` (don't rewrite it):
- The Malapert-toward-Earth and "Shackleton to the south" checks don't hold for our Site04 point;
  use M4.6's measured values.
- The site names are PGDA 78's (Site04 = Shackleton rim, Site07 = Peak near Shackleton,
  Site23 = Malapert massif…).
- The demo numbers are in section 12 of this file.

---

## 9. M6 (only if the team has a sixth person)
Take M5.2 (README), M5.4 (methods/About text), M5.5 (demo script), credits and the AI-use
disclosure. M5 keeps the validation table, QuickMap check, release testing and submission.

---

## 10. Assignment table (fill in names)

| Role | Name | Branch | Main tasks |
|---|---|---|---|
| M1 engine | | `m1-countdowns` | M1.1–M1.6 |
| M2 terrain | | `m2-polish` | M2.1–M2.9 |
| M3 dashboard | | `m3-dashboard` | M3.1–M3.9 |
| M4 simulation | | `m4-store` | M4.1–M4.8 |
| M5 validation & submission | | `m5-validation` | M5.1–M5.7 |
| M6 (optional) | | `m6-docs` | section 9 |

---

## 11. Checkpoint 2 (must all pass before the JSON freeze)

- [ ] Public URL opens (GitHub Pages) without login; no console errors.
- [ ] Dashboard: all 5 sites selectable; delay slider 0–30 changes every metric live.
- [ ] Timeline bars show Sun / Earth / battery for the window. Clicking moves the 3D view to that hour.
- [ ] First-failure banner text equals `failureMessage()` output; "Show in 3D" jumps there.
- [ ] Countdowns and solar elevation shown in the dashboard **and** the 3D HUD.
- [ ] Comparison table + delay-tolerance strip for all 5 sites.
- [ ] 3D view: mask line on the ridge; ray-cast agreement computed (not typed); replay + jump to failure.
- [ ] No literal metric numbers in HTML/JS. Check with `grep -rnE "[0-9]+\.[0-9]+%" Member4/src Member4/index.html`;
      only defaults (40/36/24/1500/250/80) and labels are allowed.

## 12. Real numbers for the demo (computed with `missionLogic.js`, 14-day window, defaults 40% / 36 h / 24 h, battery 1500 Wh / 250 W / 80 W)

**Landing on 1 Jan 2027 fails everywhere:** Earth is below the terrain at landing at all 5 sites,
and the 24 h comm limit breaks at mission hour 25. That's why the default nominal date is
**9 Jan 2027**.

| Site | Slip +0 d | +1 d | +2 d | +3 d | +4 d |
|---|---|---|---|---|---|
| site01 Connecting ridge | PASS (Earth 93.8%) | PASS | comm @ h335 | comm @ h311 | comm @ h287 |
| site04 Shackleton rim | comm @ h25 | comm @ h25 | battery @ h255 | battery @ h231 | battery @ h207 |
| site07 Peak near Shackleton | comm @ h25 | PASS | comm @ h336 | comm @ h312 | comm @ h288 |
| site11 de Gerlache rim | PASS (Earth 93.5%) | PASS | PASS | **comm @ h327** | comm @ h303 |
| site23 Malapert massif | PASS (Earth 99.7%) | PASS | PASS | PASS | comm @ h322 |

**Suggested demo line** (all of it comes from the app):
1. "Nominal landing 9 Jan 2027 at de Gerlache rim (Site11): all requirements met."
2. Drag the delay to **+3 days**. The banner reads: *"de Gerlache rim (PGDA Site11): Earth below the
   terrain horizon for more than 24 h. Contact was lost 2027-01-24 14:00 UTC; the limit was exceeded
   at 2027-01-25 14:00 UTC (mission hour 327)."*
3. The comparison strip shows **Malapert massif (Site23) still passes at +3 days** (fails at +4).
4. In 3D: "Show in 3D" → Earth drops behind the ridge, and the comm state turns DOWN.
5. Point at the ray-cast agreement box (live, e.g. site04 "Sun 99.8% of 8423 h · Earth 99.9%"), then
   at the validation table and the honest limits.

Re-run these numbers after any data rebuild (M1.6), from the repo root:
`node docs/demo_numbers.mjs` (optionally pass another nominal date, e.g.
`node docs/demo_numbers.mjs 2027-02-05T00:00:00Z`).

---

## 13. Cut list (if behind; from `goal.md` §11.1 plus the new items)

Drop in this order:
1. M2.7 / M1.5 nearby points
2. M2.6 LDEC
3. Level 2 shader shadows
4. The exaggeration toggle
5. Original-vs-delayed 3D split
6. Mode B shadows (M4.4)
7. Camera presets
8. Mast-height options (lock 2 m)
9. URL state, calendar/CSV extras

**Never cut:**
- Mode A with the mask line
- Mode C replay + jump to failure
- The delay slider
- The engine vs ray-cast metric
- The honest limits table
- **The countdowns** (cheap, and the challenge asks for them)
- The comparison strip
