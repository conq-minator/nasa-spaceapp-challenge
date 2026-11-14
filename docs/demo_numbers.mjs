// Prints the demo scenario numbers (WORKPLAN.md section 12) straight from data_out/ and
// web/src/core/missionLogic.js, so the demo script never contains a typed-in number.
//   node docs/demo_numbers.mjs                       (from the repo root)
//   node docs/demo_numbers.mjs 2027-01-09T00:00:00Z  (other nominal landing date)
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { evaluate, delayScan, failureMessage } =
  await import(pathToFileURL(path.join(root, "web/src/core/missionLogic.js")).href);

const startDate = process.argv[2] || "2027-01-09T00:00:00Z";
const durationDays = 14;
const req = { minSunPct: 40, maxNightH: 36, maxCommGapH: 24,
              battery: { capacityWh: 1500, solarW: 250, loadW: 80 } };   // goal.md 8.2 defaults
const sites = JSON.parse(readFileSync(path.join(root, "data_out/sites.json")));

console.log(`Nominal landing ${startDate}, ${durationDays}-day window, limits 40% / 36 h / 24 h, battery 1500 Wh / 250 W / 80 W\n`);
for (const s of sites) {
  const r = JSON.parse(readFileSync(path.join(root, `data_out/results/${s.id}.json`)));
  const cells = [0, 1, 2, 3, 4].map((d) => {
    const e = evaluate(r, { startDate, delayDays: d, durationDays }, req);
    return `+${d}d ${e.pass ? "PASS" : `${e.failure ? e.failure.kind + "@h" + (e.failure.missionHour + 1) : "truncated"}`}` +
           ` (sun ${e.metrics.sunPct}%, earth ${e.metrics.earthPct}%)`;
  });
  const ok = delayScan(r, { startDate, durationDays }, req, 30).filter((x) => x.pass).map((x) => x.delayDays);
  console.log(`${s.name}\n  ${cells.join(" | ")}\n  passing delays 0-30 d: ${ok.join(",") || "none"}`);
  const firstFail = [0, 1, 2, 3, 4].map((d) => evaluate(r, { startDate, delayDays: d, durationDays }, req))
    .find((e, d) => d > 0 && !e.pass);
  if (firstFail && firstFail.failure) console.log(`  first failing slip: ${failureMessage(firstFail.failure, s.name)}`);
  console.log();
}
