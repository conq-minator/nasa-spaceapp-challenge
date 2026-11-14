// LunaWise mission logic (M1). Pure functions: no DOM, no network, no randomness.
//
// Input is one data_out/results/<site>.json object:
//   { site, t: [ISO hourly UTC], sun_lit: [0|1], earth_vis: [0|1], summary, ... }
// Every number these functions return is counted from sun_lit / earth_vis. Nothing is estimated.
//
// Conventions
//   - Hour k covers [t[k], t[k] + 1 h). A mission window is [startIdx, endIdx), end exclusive.
//   - Landing = startDate + delayDays. Mission = durationDays after landing.
//   - Runs (nights, comm gaps) are counted from the landing hour: darkness before landing is not
//     experienced by the lander, so a night already in progress at landing counts from landing.
//   - A requirement "longest night <= X h" fails at the first hour where the dark run reaches X+1 h.
//
// Main entry points (used by M3's dashboard and M4's replay):
//   missionWindow(results, {startDate, delayDays, durationDays})
//   windowMetrics(results, win)
//   firstFailure(results, win, req)
//   evaluate(results, opts, req)            -> { window, metrics, failure, pass }
//   delayScan(results, opts, req, maxDelay) -> evaluate() for delay = 0..maxDelay days
//   rankSites(list, opts, req, sortBy)      -> sites that pass, sorted by one named metric
//   failureMessage(failure, siteName)       -> plain-language sentence built from the numbers
//   batteryTrace(results, win, battery)     -> hourly battery charge (Wh) from landing onward
//   countdowns(results, k), nextChange()    -> hours until sunset/sunrise and Earthset/Earthrise
//   countdownText(c, 'sun'|'earth')         -> "Sunset in 14 h (2027-01-10 14:00 UTC)"
//   sunElevationStats(angles, results, win, k) -> Sun elevation now / max / mean lit / margin
//
// Battery (goal.md 6.5), optional: pass req.battery = { capacityWh, solarW, loadW, startWh }.
//   SoC[h] = min(capacity, max(0, SoC[h-1] + solarW * sun_lit[h] - loadW)), 1 h steps,
//   starting at landing with startWh (default: full). "battery" failure = first hour SoC hits 0.
//   UI label: "Scenario engineering model, not official NASA spacecraft specification."

const HOUR_MS = 3600 * 1000;

/** Index of the hour containing `iso` (may be < 0 or >= t.length if outside the data). */
export function hourIndexOf(t, iso) {
  return Math.floor((Date.parse(iso) - Date.parse(t[0])) / HOUR_MS);
}

/** Format an ISO timestamp as "2027-03-12 04:00 UTC". */
export function fmtTime(iso) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Mission window. startDate: ISO string (default: first hour of the data).
 * Returns { startIdx, endIdx, hours, requestedHours, truncated, startT, endT }.
 * truncated = true when the window runs past the end of the data (or starts before it).
 */
export function missionWindow(results, { startDate, delayDays = 0, durationDays = 14 } = {}) {
  const n = results.t.length;
  const base = startDate ? hourIndexOf(results.t, startDate) : 0;
  const requestedStart = base + Math.round(24 * delayDays);
  const requestedHours = Math.round(24 * durationDays);
  const startIdx = Math.min(Math.max(requestedStart, 0), n);
  const endIdx = Math.min(Math.max(requestedStart + requestedHours, 0), n);
  const hours = Math.max(endIdx - startIdx, 0);
  return {
    startIdx, endIdx, hours, requestedHours,
    truncated: hours < requestedHours,
    startT: hours ? results.t[startIdx] : null,
    endT: hours ? results.t[endIdx - 1] : null,
  };
}

/** Longest run of `value` in arr[from, to). Returns { length, start } (start = absolute index). */
export function longestRun(arr, from, to, value = 0) {
  let best = 0, bestStart = null, cur = 0, curStart = null;
  for (let k = from; k < to; k++) {
    if (arr[k] === value) {
      if (cur === 0) curStart = k;
      cur++;
      if (cur > best) { best = cur; bestStart = curStart; }
    } else cur = 0;
  }
  return { length: best, start: bestStart };
}

const pct = (count, hours) => (hours ? Math.round((1000 * count) / hours) / 10 : null);

/** Metrics over the window, counted from the hourly flags. */
export function windowMetrics(results, win) {
  const { sun_lit: s, earth_vis: e } = results;
  let sun = 0, earth = 0, both = 0;
  for (let k = win.startIdx; k < win.endIdx; k++) {
    sun += s[k]; earth += e[k]; both += s[k] & e[k];
  }
  const night = longestRun(s, win.startIdx, win.endIdx, 0);
  const gap = longestRun(e, win.startIdx, win.endIdx, 0);
  return {
    hours: win.hours,
    sunHours: sun, earthHours: earth, bothHours: both,
    sunPct: pct(sun, win.hours), earthPct: pct(earth, win.hours), bothPct: pct(both, win.hours),
    longestNightH: night.length,
    longestNightStart: night.start === null ? null : results.t[night.start],
    longestCommGapH: gap.length,
    longestCommGapStart: gap.start === null ? null : results.t[gap.start],
  };
}

export const DEFAULT_BATTERY = { capacityWh: 1500, solarW: 250, loadW: 80 };   // goal.md 6.5

function batteryParams(b) {
  const p = { ...DEFAULT_BATTERY, ...b };
  for (const k of ["capacityWh", "solarW", "loadW"]) {
    if (!(Number.isFinite(p[k]) && p[k] >= 0)) throw new Error(`battery.${k} must be a number >= 0`);
  }
  p.startWh = Math.min(p.startWh ?? p.capacityWh, p.capacityWh);
  return p;
}

/** Hourly state of charge (Wh) over the window, starting at landing. Index 0 = landing hour. */
export function batteryTrace(results, win, battery = {}) {
  const b = batteryParams(battery);
  const soc = new Float64Array(win.hours);
  let x = b.startWh;
  for (let k = win.startIdx, i = 0; k < win.endIdx; k++, i++) {
    x = Math.min(b.capacityWh, Math.max(0, x + b.solarW * results.sun_lit[k] - b.loadW));
    soc[i] = x;
  }
  return { socWh: soc, params: b,
           minWh: soc.length ? Math.min(...soc) : null,
           firstEmptyMissionHour: soc.findIndex((v) => v <= 0) };
}

/**
 * First requirement broken inside the window, or null if all pass.
 * req: { maxNightH, maxCommGapH, minSunPct, minEarthPct, battery } (any may be omitted / null).
 * Hour-by-hour limits (night, comm) are found at the hour they break; percentage limits can only
 * be judged at the end of the window. Ties at the same hour: night before comm.
 */
export function firstFailure(results, win, req = {}) {
  const { sun_lit: s, earth_vis: e, t } = results;
  let dark = 0, darkStart = null, noComm = 0, noCommStart = null;
  const b = req.battery ? batteryParams(req.battery) : null;
  let soc = b ? b.startWh : null;
  for (let k = win.startIdx; k < win.endIdx; k++) {
    if (s[k] === 0) { if (dark === 0) darkStart = k; dark++; } else dark = 0;
    if (e[k] === 0) { if (noComm === 0) noCommStart = k; noComm++; } else noComm = 0;
    const base = { hourIndex: k, missionHour: k - win.startIdx, timestamp: t[k] };
    if (req.maxNightH != null && dark > req.maxNightH) {
      return { kind: "night", ...base, limit: req.maxNightH, runH: dark,
               runStartIndex: darkStart, runStart: t[darkStart],
               atLanding: darkStart === win.startIdx && win.startIdx > 0 && s[win.startIdx - 1] === 0 };
    }
    if (req.maxCommGapH != null && noComm > req.maxCommGapH) {
      return { kind: "comm", ...base, limit: req.maxCommGapH, runH: noComm,
               runStartIndex: noCommStart, runStart: t[noCommStart],
               atLanding: noCommStart === win.startIdx && win.startIdx > 0 && e[win.startIdx - 1] === 0 };
    }
    if (b) {
      soc = Math.min(b.capacityWh, Math.max(0, soc + b.solarW * s[k] - b.loadW));
      if (soc <= 0) {
        return { kind: "battery", ...base, darkH: dark, battery: b,
                 runStart: darkStart === null ? null : t[darkStart] };
      }
    }
  }
  const m = windowMetrics(results, win);
  const end = { hourIndex: win.endIdx - 1, missionHour: win.hours - 1,
                timestamp: win.hours ? t[win.endIdx - 1] : null };
  if (req.minSunPct != null && m.sunPct !== null && m.sunPct < req.minSunPct) {
    return { kind: "sun_pct", ...end, limit: req.minSunPct, value: m.sunPct };
  }
  if (req.minEarthPct != null && m.earthPct !== null && m.earthPct < req.minEarthPct) {
    return { kind: "earth_pct", ...end, limit: req.minEarthPct, value: m.earthPct };
  }
  return null;
}

/** Window + metrics + first failure in one call. pass = no failure and a full-length window. */
export function evaluate(results, opts, req = {}) {
  const window = missionWindow(results, opts);
  const metrics = windowMetrics(results, window);
  const failure = window.hours ? firstFailure(results, window, req) : null;
  return { site: results.site, window, metrics, failure,
           pass: failure === null && !window.truncated && window.hours > 0 };
}

/** evaluate() for delays 0, 1, ..., maxDelayDays (whole days). */
export function delayScan(results, opts, req = {}, maxDelayDays = 30) {
  const out = [];
  for (let d = 0; d <= maxDelayDays; d++) {
    out.push({ delayDays: d, ...evaluate(results, { ...opts, delayDays: d }, req) });
  }
  return out;
}

/** First delay (days) at which the mission stops passing, given it passes at delay 0. */
export function firstFailingDelay(scan) {
  const hit = scan.find((r) => !r.pass);
  return hit ? hit.delayDays : null;
}

/**
 * Sites that pass, sorted by ONE named metric from windowMetrics (no composite score).
 * list: [{ name?, results }]. sortBy: "bothPct" | "sunPct" | "earthPct" | "longestNightH" | ...
 * Hours metrics (nights, gaps) sort ascending (shorter is better); percentages descending.
 */
export function rankSites(list, opts, req = {}, sortBy = "bothPct") {
  const evals = list.map(({ name, results }) => ({ name: name ?? results.site,
                                                   ...evaluate(results, opts, req) }));
  const asc = sortBy.endsWith("H");
  const passing = evals.filter((r) => r.pass)
    .sort((a, b) => (asc ? 1 : -1) * (a.metrics[sortBy] - b.metrics[sortBy]));
  const failing = evals.filter((r) => !r.pass);
  return { passing, failing, sortBy };
}

/** One plain sentence describing a failure, built only from its fields. */
export function failureMessage(f, siteName = "") {
  const at = siteName ? `${siteName}: ` : "";
  if (!f) return `${at}all requirements met in this window.`;
  const hr = `mission hour ${f.missionHour + 1}`;
  switch (f.kind) {
    case "night":
      return `${at}Sun below the terrain horizon for more than ${f.limit} h. ` +
             (f.atLanding ? `It was already dark at landing (${fmtTime(f.runStart)})`
                          : `Darkness began ${fmtTime(f.runStart)}`) +
             `; the limit was exceeded at ${fmtTime(f.timestamp)} (${hr}).`;
    case "comm":
      return `${at}Earth below the terrain horizon for more than ${f.limit} h. ` +
             (f.atLanding ? `Earth was already out of view at landing (${fmtTime(f.runStart)})`
                          : `Contact was lost ${fmtTime(f.runStart)}`) +
             `; the limit was exceeded at ${fmtTime(f.timestamp)} (${hr}).`;
    case "battery":
      return `${at}Battery empty at ${fmtTime(f.timestamp)} (${hr}), after ${f.darkH} h without ` +
             `sunlight (scenario: ${f.battery.capacityWh} Wh battery, ${f.battery.solarW} W solar, ` +
             `${f.battery.loadW} W load; not an official NASA spacecraft specification).`;
    case "sun_pct":
      return `${at}Sunlit for ${f.value}% of the mission, below the required ${f.limit}%.`;
    case "earth_pct":
      return `${at}Earth visible for ${f.value}% of the mission, below the required ${f.limit}%.`;
    default:
      return `${at}requirement "${f.kind}" not met at ${fmtTime(f.timestamp)}.`;
  }
}

// ----------------------------------------------------------------------------------------------
// Countdowns (WORKPLAN M1.1): "Sunset in N h / Earthset in N h", the challenge's "time remaining
// before sunset or Earthset". Counted from the hourly flags, so the resolution is 1 hour.

/**
 * Hours until flags[k] changes value, looking forward from hour k.
 * Returns { now: 0|1, hours, at, atIndex }: `at` is the timestamp of the first hour with the
 * other value. If it never changes before the end of the data: { now, hours: null, at: null,
 * atIndex: null }. k outside the data -> null.
 * UI: now === 1 -> "Sunset in N h" (Earthset); now === 0 -> "Sunrise in N h" (Earthrise).
 */
export function nextChange(flags, t, k) {
  if (!(k >= 0 && k < flags.length)) return null;
  const now = flags[k];
  for (let j = k + 1; j < flags.length; j++) {
    if (flags[j] !== now) return { now, hours: j - k, at: t[j], atIndex: j };
  }
  return { now, hours: null, at: null, atIndex: null };
}

/** Both bodies at hour k: { sun: nextChange(sun_lit), earth: nextChange(earth_vis) }. */
export function countdowns(results, k) {
  return { sun: nextChange(results.sun_lit, results.t, k),
           earth: nextChange(results.earth_vis, results.t, k) };
}

/** Plain text for one countdown, e.g. "Sunset in 14 h (2027-01-10 14:00 UTC)". */
export function countdownText(c, body = "sun") {
  if (!c) return "—";
  const [up, down] = body === "sun" ? ["Sunrise", "Sunset"] : ["Earthrise", "Earthset"];
  const what = c.now ? down : up;
  if (c.hours === null) return `No ${what.toLowerCase()} before the end of the computed data`;
  return `${what} in ${c.hours} h (${fmtTime(c.at)})`;
}

// ----------------------------------------------------------------------------------------------
// Solar elevation (WORKPLAN M1.3): elevation drives solar power; the challenge asks to show it
// prominently. Input: data_out/angles/<site>.json (sun_el) + results (sun_lit) + a window.

/**
 * { nowDeg, maxDeg, maxAt, minDeg, meanLitDeg, nowMarginDeg } over the window.
 * nowDeg: Sun elevation at hour k (null if k is outside the data).
 * meanLitDeg: mean elevation over the window's hours with sun_lit == 1 (null if none).
 * nowMarginDeg: results.sun_margin_deg[k] (degrees above the terrain skyline) when present.
 * Values are rounded to 0.01 deg, like the source data.
 */
export function sunElevationStats(angles, results, win, k = win.startIdx) {
  const el = angles.sun_el;
  const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);
  let max = -Infinity, maxK = null, min = Infinity, litSum = 0, litN = 0;
  for (let j = win.startIdx; j < win.endIdx; j++) {
    if (el[j] > max) { max = el[j]; maxK = j; }
    if (el[j] < min) min = el[j];
    if (results.sun_lit[j] === 1) { litSum += el[j]; litN++; }
  }
  const has = win.endIdx > win.startIdx;
  const inData = k >= 0 && k < el.length;
  const margin = results.sun_margin_deg;
  return {
    nowDeg: inData ? r2(el[k]) : null,
    maxDeg: has ? r2(max) : null,
    maxAt: has ? results.t[maxK] : null,
    minDeg: has ? r2(min) : null,
    meanLitDeg: litN ? r2(litSum / litN) : null,
    nowMarginDeg: margin && inData ? r2(margin[k]) : null,
  };
}
