// Member 2: Web Worker that runs the full ray-cast agreement check off the main thread
// (goal.md H10-H12).
//   const w = new Worker(new URL("./raycastWorker.js", import.meta.url), { type: "module" });
//   w.postMessage({ basePath: new URL("./data", document.baseURI).href, siteId: "site04", mast: 2, samples: [{az, el}, ...] });
//   w.onmessage = (e) => e.data  // { siteId, mast, n, checked, outOfGrid, agree, pct, mismatches }
// `samples` is typically every hour of the Sun and Earth tracks from data_out/angles/<site>.json.
import { loadTerrain, agreement } from "./raycast.js";

const cache = new Map();

self.onmessage = async ({ data }) => {
  const { basePath = "./data", siteId, mast = 2, samples } = data;
  try {
    if (!cache.has(siteId)) {
      const [terrain, mask] = await Promise.all([
        loadTerrain(basePath, siteId),
        fetch(`${basePath}/mask/${siteId}.json`).then((r) => r.json()),
      ]);
      cache.set(siteId, { terrain, mask });
    }
    const { terrain, mask } = cache.get(siteId);
    const key = String(mast);
    const profile = mask.elev_deg_by_mast?.[key] ?? mask.elev_deg;
    const dist = mask.horizon_dist_km_by_mast?.[key] ?? null;
    self.postMessage({ siteId, mast, ...agreement(terrain, +mast, profile, samples, dist) });
  } catch (err) {
    self.postMessage({ siteId, mast, error: String(err) });
  }
};
