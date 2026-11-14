// Copies ../data_out -> public/data so Vite serves it at ./data (dev and build).
// data_out/ stays the single source of truth; public/data is git-ignored.
import { cpSync, rmSync, existsSync } from "node:fs";

const src = new URL("../../data_out/", import.meta.url);
const dst = new URL("../public/data/", import.meta.url);
if (!existsSync(src)) {
  console.error("sync-data: ../data_out not found; the simulation will fall back to synthetic data.");
  process.exit(0);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true, filter: (p) => !String(p).endsWith(".gitkeep") });
console.log("sync-data: copied data_out -> public/data");
