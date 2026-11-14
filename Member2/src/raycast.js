// Member 2: independent ray-cast check of Sun/Earth visibility against the heightmaps.
//
// rayVisible marches a ray FORWARD from the mast toward (az, el) and asks "does it ever pass
// below the terrain?". The Python engine (Member2/pipeline) takes the MAX elevation angle of
// terrain samples per azimuth over 200 km. Same data, different code path, so agreement shows
// the conventions match (azimuth clockwise from north, east/north axes, row order, curvature,
// mast height). It does NOT show that the terrain data is accurate.
//
// Grids follow the team contract (goal.md 5.2 #5): data_out/heightmap/<site>.json +
// <site>_near.bin + <site>_far.bin, Float32 LE, row-major, ROW 0 = SOUTHERNMOST, x = east,
// y = north, lander at the centre, heights relative to the lander ground with curvature
// (d^2/2R) already subtracted, so the ray is a straight line: mast + d * tan(el).

export function makeGrid(meta, data) {
  if (data.length !== meta.nx * meta.ny) throw new Error("heightmap size mismatch");
  let max = -Infinity;
  for (const v of data) if (v > max) max = v;
  return { data, nx: meta.nx, ny: meta.ny, cellM: meta.cell_m, sizeM: meta.size_m, maxH: max };
}

export async function loadTerrain(basePath, siteId) {
  const meta = await (await fetch(`${basePath}/heightmap/${siteId}.json`)).json();
  const bin = async (f) => new Float32Array(await (await fetch(`${basePath}/heightmap/${f}`)).arrayBuffer());
  const [near, far] = await Promise.all([bin(meta.near.file), bin(meta.far.file)]);
  return { meta, near: makeGrid(meta.near, near), far: makeGrid(meta.far, far) };
}

// Bilinear height at east/north offset (m) using cell centres; NaN outside or no data.
export function heightAt(g, east, north) {
  const c = (east + g.sizeM / 2) / g.cellM - 0.5;
  const r = (north + g.sizeM / 2) / g.cellM - 0.5;
  const c0 = Math.floor(c), r0 = Math.floor(r);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= g.nx || r0 + 1 >= g.ny) return NaN;
  const fc = c - c0, fr = r - r0, i = r0 * g.nx + c0, d = g.data;
  const lo = d[i] * (1 - fc) + d[i + 1] * fc;
  const hi = d[i + g.nx] * (1 - fc) + d[i + g.nx + 1] * fc;
  return lo * (1 - fr) + hi * fr;
}

// true = the ray toward (azDeg, elDeg) from `mast` m above the ground clears the terrain grids.
export function rayVisible(t, mast, azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180;
  const sx = Math.sin(az), cy = Math.cos(az), tanEl = Math.tan((elDeg * Math.PI) / 180);
  const nearEdge = t.near.sizeM / 2, farEdge = t.far.sizeM / 2;
  const ceiling = Math.max(t.near.maxH, t.far.maxH);
  for (let d = t.near.cellM / 2; d <= farEdge * Math.SQRT2; ) {
    const ray = mast + d * tanEl;
    if (tanEl >= 0 && ray > ceiling) return true;      // rising and above every peak
    let h = heightAt(t.near, d * sx, d * cy);
    if (Number.isNaN(h)) h = heightAt(t.far, d * sx, d * cy);
    if (Number.isNaN(h)) return true;                  // left the far grid
    if (h > ray) return false;
    d += d < nearEdge ? t.near.cellM / 2 : t.far.cellM / 2;
  }
  return true;
}

// Linear interpolation of a horizon profile (deg) at azimuth az, wrapping at 360.
export function horizonAt(profile, az, stepDeg) {
  const n = profile.length;
  const pos = (((az % 360) + 360) % 360) / stepDeg;
  const i0 = Math.floor(pos) % n, f = pos - Math.floor(pos);
  return profile[i0] * (1 - f) + profile[(i0 + 1) % n] * f;
}

// Compare ray-cast verdicts with the engine mask (el > H(az)) over {az, el} samples, e.g. every
// hour of a site's Sun track. The engine searches 200 km; the grids only reach far.size_m/2.
// When the engine says "blocked" by terrain beyond the grid (distKm = mask
// horizon_dist_km_by_mast[mast]) the ray cannot see it: counted in `outOfGrid`, left out of pct.
export function agreement(t, mast, profile, samples, distKm = null) {
  const step = 360 / profile.length;
  const gridKm = (0.95 * t.far.sizeM) / 2 / 1000;
  let agree = 0, checked = 0, outOfGrid = 0;
  const mismatches = [];
  samples.forEach(({ az, el }, k) => {
    const engine = el > horizonAt(profile, az, step);
    if (!engine && distKm) {
      const i = Math.round((((az % 360) + 360) % 360) / step) % distKm.length;
      if (distKm[i] > gridKm) { outOfGrid++; return; }
    }
    const ray = rayVisible(t, mast, az, el);
    checked++;
    if (engine === ray) agree++;
    else if (mismatches.length < 50) mismatches.push({ k, az, el, engine, ray });
  });
  return { n: samples.length, checked, outOfGrid, agree,
           pct: checked ? (100 * agree) / checked : NaN, mismatches };
}
