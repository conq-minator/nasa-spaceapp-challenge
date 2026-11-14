// Builds data_out/validation.json (goal.md 5.2 #6, WORKPLAN M5.1) from computed files only:
//   - NASA Goddard comparison: docs/validation/goddard_terrain.json (Member2/pipeline/goddard_compare.py)
//   - SPICE vs JPL Horizons:    data_out/angles/<site>.json  horizons_max_diff_deg (Member1)
//   - far vs near DEM:          data_out/mask/<site>.json    dem.far_minus_near (Member2)
//   - ray cast vs engine:       recomputed here over every hour of 2027 with Member2/src/raycast.js
// Run from the repo root:  node docs/make_validation.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => JSON.parse(readFileSync(path.join(root, p)));
const { makeGrid, agreement } = await import(pathToFileURL(path.join(root, "Member2/src/raycast.js")).href);

const sites = rd("data_out/sites.json");
const goddard = Object.fromEntries(rd("docs/validation/goddard_terrain.json").map((r) => [r.site, r]));
const r1 = (v) => Math.round(v * 10) / 10;
const rows = [];

for (const s of sites) {
  const id = s.id;
  const g = goddard[id];
  const res = rd(`data_out/results/${id}.json`);
  const ang = rd(`data_out/angles/${id}.json`);
  const mask = rd(`data_out/mask/${id}.json`);

  // 1-2. NASA Goddard PGDA 69 (independent reference): average Sun / Earth visibility
  for (const k of ["sun", "earth"]) {
    const ours = res.summary_by_mast["2"][`${k}_pct`];
    const ref = g[`goddard_${k}_pct`];
    rows.push({
      site: id, metric: `${k}_pct`, ours, reference: ref,
      source: `NASA Goddard PGDA 69 AVGVISIB_85S_060M_201608${k === "earth" ? "_EARTH" : ""} (60 m pixel at the site point; 3x3 range ${g[`goddard_${k}_pct_3x3`].join("-")}%)`,
      diff: r1(ours - ref),
      notes: `Ours: all of 2027, hourly, 2 m mast (${res.summary_by_mast["0"][`${k}_pct`]}% at 0 m). Goddard: 18.6-year average at the surface, 60 m pixel. ` +
             "Likely reasons for the gap (not proven): the pixel averages lower ground around these high points; different time span; " +
             "different observer height; " + (k === "earth" ? "Goddard counts Earth visible if any part of its disc clears the terrain, we use the disc centre." :
             "point Sun vs partial disc is negligible here (<=0.2 points)."),
    });
  }

  // 3-4. Independent ray cast through the heightmaps vs the engine flags (consistency of code/conventions)
  const m = rd(`data_out/heightmap/${id}.json`);
  const f32 = (f) => { const b = readFileSync(path.join(root, "data_out/heightmap", f)); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
  const terrain = { near: makeGrid(m.near, f32(m.near.file)), far: makeGrid(m.far, f32(m.far.file)) };
  for (const body of ["sun", "earth"]) {
    const samples = ang[`${body}_az`].map((az, k) => ({ az, el: ang[`${body}_el`][k] }));
    const a = agreement(terrain, 2, mask.elev_deg_by_mast["2"], samples, mask.horizon_dist_km_by_mast["2"]);
    rows.push({
      site: id, metric: `raycast_agreement_${body}_pct`, ours: Math.round(a.pct * 100) / 100, reference: 100,
      source: "Member2/src/raycast.js (independent ray march through data_out/heightmap) vs the engine flags",
      diff: Math.round((a.pct - 100) * 100) / 100,
      notes: `Over the ${a.checked} hours of 2027 the 30.7 km heightmap can check; ${a.outOfGrid} h blocked by terrain beyond it are not checkable. ` +
             "Shows the code and conventions are consistent, not that the terrain is accurate.",
    });
  }

  // 5. Ephemeris: SPICE (MOON_ME) vs JPL Horizons
  rows.push({
    site: id, metric: "horizons_vs_spice_max_deg", ours: ang.horizons_max_diff_deg, reference: 0,
    source: "JPL Horizons API (coord@301) vs SPICE azlcpo, MOON_ME frame (Member1/pipeline/frame_check.py)",
    diff: ang.horizons_max_diff_deg,
    notes: "Largest azimuth/elevation difference over 10 times across 2027, Sun and Earth. Tolerance 0.1 deg.",
  });

  // 6. Terrain: 20 m far-field DEM vs the 5 m PGDA tile where they overlap
  const ov = mask.dem.far_minus_near;
  rows.push({
    site: id, metric: "far_minus_near_dem_median_m", ours: ov.median_m, reference: 0,
    source: `LOLA ${mask.dem.far} minus PGDA 78 ${mask.dem.near} at ${ov.n} random points in the 5 m tile`,
    diff: ov.median_m,
    notes: `Median absolute deviation ${ov.mad_m} m. The export stops if the median exceeds 50 m (catches km/m or offset errors).`,
  });
}

writeFileSync(path.join(root, "data_out/validation.json"), JSON.stringify(rows, null, 2) + "\n");
for (const r of rows) console.log(`${r.site.padEnd(7)} ${r.metric.padEnd(28)} ours ${String(r.ours).padStart(7)}  ref ${String(r.reference).padStart(6)}  diff ${r.diff}`);
console.log(`\nwrote data_out/validation.json (${rows.length} rows)`);
