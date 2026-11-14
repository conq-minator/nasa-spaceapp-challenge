// Tests for web/src/core/missionLogic.js. Run from web/:  node --test tests/missionLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as ml from "../src/core/missionLogic.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, "..", "..", "data_out");

// Hand-made results: n hours from 2027-01-01T00:00Z with given flags.
function fake(sun, earth = sun.map(() => 1)) {
  const t0 = Date.parse("2027-01-01T00:00:00Z");
  const t = sun.map((_, k) => new Date(t0 + k * 3600e3).toISOString().replace(".000Z", "Z"));
  return { site: "test", t, sun_lit: sun, earth_vis: earth };
}
const rep = (v, n) => Array(n).fill(v);

test("window: delay shifts the start by 24 h per day; truncation reported", () => {
  const r = fake(rep(1, 100));
  const w = ml.missionWindow(r, { delayDays: 1, durationDays: 2 });
  assert.equal(w.startIdx, 24); assert.equal(w.endIdx, 72); assert.equal(w.truncated, false);
  const late = ml.missionWindow(r, { delayDays: 3, durationDays: 2 });   // 72..120, data ends 100
  assert.equal(late.hours, 28); assert.equal(late.truncated, true);
  const w2 = ml.missionWindow(r, { startDate: "2027-01-01T10:00:00Z", durationDays: 1 });
  assert.equal(w2.startIdx, 10); assert.equal(w2.startT, "2027-01-01T10:00:00Z");
});

test("all lit: 100 %, no nights, no failure", () => {
  const r = fake(rep(1, 48));
  const e = ml.evaluate(r, { durationDays: 2 }, { maxNightH: 5, minSunPct: 50 });
  assert.equal(e.metrics.sunPct, 100); assert.equal(e.metrics.longestNightH, 0);
  assert.equal(e.failure, null); assert.equal(e.pass, true);
});

test("alternating: 50 %, nights of 1 h", () => {
  const r = fake(Array.from({ length: 48 }, (_, k) => k % 2));
  const m = ml.windowMetrics(r, ml.missionWindow(r, { durationDays: 2 }));
  assert.equal(m.sunPct, 50); assert.equal(m.longestNightH, 1);
});

test("a 50 h night crossing the window start counts only from landing", () => {
  const sun = [...rep(1, 10), ...rep(0, 50), ...rep(1, 40)];          // dark hours 10..59
  const r = fake(sun);
  const w = ml.missionWindow(r, { startDate: "2027-01-02T06:00:00Z", durationDays: 2 }); // idx 30
  const m = ml.windowMetrics(r, w);
  assert.equal(w.startIdx, 30);
  assert.equal(m.longestNightH, 30);                                   // 30..59 inside the window
  assert.equal(m.longestNightStart, "2027-01-02T06:00:00Z");
  const f = ml.firstFailure(r, w, { maxNightH: 24 });
  assert.equal(f.kind, "night");
  assert.equal(f.missionHour, 24);                                     // 25th dark hour
  assert.equal(f.hourIndex, 54); assert.equal(f.runStart, "2027-01-02T06:00:00Z");
  assert.equal(f.atLanding, true);
  assert.match(ml.failureMessage(f), /already dark at landing \(2027-01-02 06:00 UTC\)/);
});

test("first failure is the earliest; comm can come before night", () => {
  const sun = [...rep(1, 20), ...rep(0, 30)];
  const earth = [...rep(1, 5), ...rep(0, 45)];
  const f = ml.firstFailure(fake(sun, earth), { startIdx: 0, endIdx: 50, hours: 50 },
                            { maxNightH: 10, maxCommGapH: 10 });
  assert.equal(f.kind, "comm"); assert.equal(f.hourIndex, 15); assert.equal(f.runH, 11);
});

test("percent limits are judged at the window end", () => {
  const r = fake([...rep(1, 10), ...rep(0, 2), ...rep(1, 12)]);
  const f = ml.firstFailure(r, ml.missionWindow(r, { durationDays: 1 }),
                            { maxNightH: 5, minSunPct: 95 });
  assert.equal(f.kind, "sun_pct"); assert.equal(f.value, 91.7); assert.equal(f.missionHour, 23);
});

test("delay scan and first failing delay", () => {
  const sun = [...rep(1, 72), ...rep(0, 48), ...rep(1, 200)];        // a 48 h night from hour 72
  const scan = ml.delayScan(fake(sun), { durationDays: 2 }, { maxNightH: 24 }, 5);
  // delay 2: window 48..95 sees dark 72..95 = 24 h (not > 24, passes);
  // delay 3: window 72..119 sees all 48 dark hours (fails); delay 4: 96..143 sees 24 h (passes)
  assert.deepEqual(scan.map((s) => s.pass), [true, true, true, false, true, true]);
  assert.equal(ml.firstFailingDelay(scan), 3);
});

test("rankSites keeps passing sites, sorted by one named metric", () => {
  const a = fake(rep(1, 48)); a.site = "a";
  const b = fake([...rep(1, 40), ...rep(0, 8)]); b.site = "b";
  const c = fake([...rep(1, 10), ...rep(0, 30), ...rep(1, 8)]); c.site = "c";
  const r = ml.rankSites([{ results: b }, { results: a }, { results: c }],
                         { durationDays: 2 }, { maxNightH: 12 }, "sunPct");
  assert.deepEqual(r.passing.map((x) => x.site), ["a", "b"]);
  assert.deepEqual(r.failing.map((x) => x.site), ["c"]);
});

test("failure message uses only computed numbers", () => {
  const f = { kind: "comm", limit: 40, runStart: "2027-03-12T04:00:00Z",
              timestamp: "2027-03-13T20:00:00Z", missionHour: 52 };
  assert.equal(ml.failureMessage(f, "Shackleton rim"),
    "Shackleton rim: Earth below the terrain horizon for more than 40 h. Contact was lost " +
    "2027-03-12 04:00 UTC; the limit was exceeded at 2027-03-13 20:00 UTC (mission hour 53).");
  assert.match(ml.failureMessage(null), /all requirements met/);
});

test("battery: starts full at landing, drains in the dark, fails at the first empty hour", () => {
  // 10 lit hours, then dark. 100 Wh battery, 20 W load: empty after 5 dark hours.
  const r = fake([...rep(1, 10), ...rep(0, 20)]);
  const w = ml.missionWindow(r, { durationDays: 30 / 24 });
  const bat = { capacityWh: 100, solarW: 50, loadW: 20 };
  const tr = ml.batteryTrace(r, w, bat);
  assert.equal(tr.socWh[0], 100);                     // full, charging capped at capacity
  assert.equal(tr.socWh[10], 80); assert.equal(tr.socWh[14], 0);
  assert.equal(tr.firstEmptyMissionHour, 14);
  const f = ml.firstFailure(r, w, { maxNightH: 100, battery: bat });
  assert.equal(f.kind, "battery"); assert.equal(f.missionHour, 14); assert.equal(f.darkH, 5);
  assert.match(ml.failureMessage(f), /Battery empty .*after 5 h without sunlight .*100 Wh/);
});

test("battery: starts at landing, not at the start of the data", () => {
  const r = fake([...rep(0, 30), ...rep(1, 30)]);    // dark for the first 30 h of the data
  const w = ml.missionWindow(r, { delayDays: 30 / 24, durationDays: 1 });
  const f = ml.firstFailure(r, w, { battery: { capacityWh: 100, solarW: 50, loadW: 20 } });
  assert.equal(f, null);                              // landed in sunlight: never empty
});

test("battery: zero values are respected, bad values rejected", () => {
  const r = fake(rep(0, 10));
  const w = ml.missionWindow(r, { durationDays: 10 / 24 });
  assert.equal(ml.firstFailure(r, w, { battery: { capacityWh: 100, loadW: 0 } }), null);
  assert.equal(ml.firstFailure(r, w, { battery: { capacityWh: 100, startWh: 0 } }).missionHour, 0);
  assert.throws(() => ml.batteryTrace(r, w, { loadW: -5 }), /loadW/);
});

// --- Real data: JS full-year metrics must equal combine.py's summary exactly. ---
const SITES = ["site01", "site04", "site07", "site11", "site23"];
for (const id of SITES) {
  const p = join(DATA, "results", `${id}.json`);
  test(`real ${id}: JS metrics over the whole year match combine.py summary`,
       { skip: !existsSync(p) && "no results file" }, () => {
    const r = JSON.parse(readFileSync(p, "utf8"));
    const w = ml.missionWindow(r, { durationDays: r.t.length / 24 });
    const m = ml.windowMetrics(r, w);
    const s = r.summary;
    assert.equal(w.hours, s.total_hours);
    assert.equal(m.sunPct, s.sun_pct); assert.equal(m.earthPct, s.earth_pct);
    assert.equal(m.bothPct, s.both_pct);
    assert.equal(m.longestNightH, s.longest_night_h);
    assert.equal(m.longestCommGapH, s.longest_comm_gap_h);
    assert.equal(m.longestNightStart, s.longest_night_start);
  });
}

// ---- M1.1 countdowns -------------------------------------------------------------------------
test("nextChange: hours until the flag changes, null when it never does", () => {
  const r = fake([1, 1, 0, 0, 1]);
  assert.deepEqual(ml.nextChange(r.sun_lit, r.t, 0), { now: 1, hours: 2, at: r.t[2], atIndex: 2 });
  assert.deepEqual(ml.nextChange(r.sun_lit, r.t, 2), { now: 0, hours: 2, at: r.t[4], atIndex: 4 });
  assert.equal(ml.nextChange(r.sun_lit, r.t, 4).hours, null);        // last hour: no change ahead
  assert.equal(ml.nextChange(fake(rep(1, 5)).sun_lit, r.t, 0).hours, null);
  assert.equal(ml.nextChange(r.sun_lit, r.t, 99), null);              // outside the data
  const [a, b] = [[0, 1], [0, 1]];
  assert.equal(ml.nextChange(a, b, 0).hours, 1);
});

test("countdowns + countdownText use the right words for each body and state", () => {
  const r = fake([1, 1, 0], [0, 1, 1]);
  const c = ml.countdowns(r, 0);
  assert.equal(c.sun.hours, 2);
  assert.equal(c.earth.hours, 1);
  assert.equal(ml.countdownText(c.sun, "sun"), "Sunset in 2 h (2027-01-01 02:00 UTC)");
  assert.equal(ml.countdownText(c.earth, "earth"), "Earthrise in 1 h (2027-01-01 01:00 UTC)");
  assert.match(ml.countdownText(ml.countdowns(r, 2).sun, "sun"), /^No sunrise before the end/);
  assert.equal(ml.countdownText(null), "—");
});

// ---- M1.3 solar elevation stats --------------------------------------------------------------
test("sunElevationStats: now / max / min / mean over lit hours / margin", () => {
  const r = fake([0, 1, 1, 0]);
  r.sun_margin_deg = [-0.5, 0.25, 0.4, -0.1];
  const angles = { sun_el: [0.1, 1.2, 1.6, 0.9] };
  const win = { startIdx: 0, endIdx: 4, hours: 4 };
  const s = ml.sunElevationStats(angles, r, win, 1);
  assert.deepEqual(s, { nowDeg: 1.2, maxDeg: 1.6, maxAt: r.t[2], minDeg: 0.1, meanLitDeg: 1.4, nowMarginDeg: 0.25 });
  const none = ml.sunElevationStats(angles, fake(rep(0, 4)), win, 0);
  assert.equal(none.meanLitDeg, null);
  assert.equal(none.nowMarginDeg, null);                              // no margin field present
});

test("real data: countdown agrees with the flags and margin sign agrees with sun_lit", { skip: !existsSync(join(DATA, "results", "site04.json")) }, () => {
  const r = JSON.parse(readFileSync(join(DATA, "results", "site04.json")));
  for (const k of [0, 500, 4000]) {
    const c = ml.countdowns(r, k).sun;
    if (c.hours !== null) {
      assert.notEqual(r.sun_lit[k + c.hours], r.sun_lit[k]);
      for (let j = k; j < k + c.hours; j++) assert.equal(r.sun_lit[j], r.sun_lit[k]);
    }
  }
  if (r.sun_margin_deg) {
    let bad = 0;
    r.sun_lit.forEach((f, k) => { if ((r.sun_margin_deg[k] > 0 ? 1 : 0) !== f && Math.abs(r.sun_margin_deg[k]) > 0.01) bad++; });
    assert.equal(bad, 0, "sun_margin_deg sign must match sun_lit (except rounding at 0.00)");
  }
});
