// Run from Member2/:  node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { makeGrid, rayVisible, heightAt, agreement, horizonAt } from "../src/raycast.js";

const R = 1737400;

// Synthetic grid in the team layout: row 0 south, cell centres, curvature pre-subtracted.
function grid(fn, n, cell) {
  const size = n * cell, z = new Float32Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const e = (c + 0.5) * cell - size / 2, no = (r + 0.5) * cell - size / 2;
      z[r * n + c] = fn(e, no) - (e * e + no * no) / (2 * R);
    }
  return makeGrid({ nx: n, ny: n, cell_m: cell, size_m: size }, z);
}
const terrain = (fn) => ({ near: grid(fn, 512, 10), far: grid(fn, 512, 120) });

test("heightAt: row 0 is south, east is +x", () => {
  const g = grid((e, n) => e + 2 * n, 64, 10);
  const want = 123.4 + 2 * -56.7 - (123.4 ** 2 + 56.7 ** 2) / (2 * R);
  assert.ok(Math.abs(heightAt(g, 123.4, -56.7) - want) < 0.05);
  assert.ok(g.data[0] < g.data[63 * 64]);              // south row lower than north row
});

test("flat Moon: geometric dip -sqrt(2m/R)", () => {
  const t = terrain(() => 0);
  const dip = (-Math.sqrt((2 * 2) / R) * 180) / Math.PI; // ~-0.088 deg for a 2 m mast
  for (const az of [0, 45, 90, 200, 333]) {
    assert.equal(rayVisible(t, 2, az, dip + 0.02), true);
    assert.equal(rayVisible(t, 2, az, dip - 0.02), false);
  }
});

test("100 m hill 1 km east blocks az 90, not az 270", () => {
  const t = terrain((e, n) => 100 * Math.exp(-(((e - 1000) ** 2 + n ** 2) / 60 ** 2)));
  assert.equal(rayVisible(t, 2, 90, 4), false);
  assert.equal(rayVisible(t, 2, 90, 6), true);
  assert.equal(rayVisible(t, 2, 270, 0), true);
});

test("hill 1 km NORTH blocks az 0 (row order check)", () => {
  const t = terrain((e, n) => 100 * Math.exp(-((e ** 2 + (n - 1000) ** 2) / 60 ** 2)));
  assert.equal(rayVisible(t, 2, 0, 4), false);
  assert.equal(rayVisible(t, 2, 180, 0), true);
});

// Real export cross-check against data_out/ (skips until `py -m pipeline.export --all` has run).
const OUT = new URL("../../data_out/", import.meta.url);
for (const id of ["site01", "site04", "site07", "site11", "site23"]) {
  const meta = new URL(`heightmap/${id}.json`, OUT), mask = new URL(`mask/${id}.json`, OUT);
  test(`ray-cast vs engine agreement (${id})`, { skip: !existsSync(meta) || !existsSync(mask) }, () => {
    const m = JSON.parse(readFileSync(meta));
    const f32 = (f) => { const b = readFileSync(new URL(`heightmap/${f}`, OUT)); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
    const t = { near: makeGrid(m.near, f32(m.near.file)), far: makeGrid(m.far, f32(m.far.file)) };
    const mk = JSON.parse(readFileSync(mask));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const mast of ["2", "5", "10"]) {
      const prof = mk.elev_deg_by_mast[mast];
      const samples = Array.from({ length: 2000 }, () => {
        const az = rnd() * 360;
        return { az, el: horizonAt(prof, az, 1) + (rnd() - 0.5) * 10 }; // +-5 deg of the skyline
      });
      const a = agreement(t, +mast, prof, samples, mk.horizon_dist_km_by_mast[mast]);
      console.log(`  ${id} mast ${mast} m: ray-cast matches engine in ${a.pct.toFixed(1)}% of ${a.checked} ` +
                  `checkable samples; ${a.outOfGrid} blocked beyond the 30.7 km grid`);
      assert.ok(a.pct > 97, `agreement ${a.pct}%`);
    }
  });
}
