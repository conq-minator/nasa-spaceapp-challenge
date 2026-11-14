"""M2.2 - NASA Goddard (PGDA product 69) reference values at our site points.

Samples the 85S 60 m average Sun-visibility and Earth-visibility maps (18.6-year hourly averages,
surface level) at each point in data_out/sites.json and puts them next to our 2027 sun_pct /
earth_pct at 0 m and 2 m (data_out/results/<id>.json summary_by_mast).

Maps are read over HTTP by default (range requests: only a few pixels are fetched, full
resolution). Use --local DIR to read files from disk instead.

Run from the repo root:
    py Member2/pipeline/goddard_compare.py
    py Member2/pipeline/goddard_compare.py --local data_raw/illum
Writes docs/validation/goddard_terrain.json and docs/validation/goddard_terrain.md for M5.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
MAPS = {"sun": "AVGVISIB_85S_060M_201608", "earth": "AVGVISIB_85S_060M_201608_EARTH"}
LABEL_SCALE = 4e-05      # PDS label scaling for the raw int16 products (WORKPLAN M2.2)
ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF")


def map_path(kind, local=None):
    if local:
        return str(Path(local) / f"{MAPS[kind]}.TIF")
    # The *_COG.TIF names listed on the PGDA page return an HTML "Not Found" page; the plain .TIF
    # files exist and the server supports range requests, so only the needed pixels are fetched.
    return f"/vsicurl/{BASE}{MAPS[kind]}.TIF"


def sample_fraction(src, lon, lat):
    """Visibility fraction at lon/lat: centre pixel and the 3x3 block around it (min, mean, max)."""
    crs = CRS.from_user_input(src.crs)
    x, y = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True).transform(lon, lat)
    row, col = src.index(x, y)
    win = rasterio.windows.Window(col - 1, row - 1, 3, 3)
    a = src.read(1, window=win, masked=True, boundless=True).astype("float64")
    a = a * src.scales[0] + src.offsets[0]
    scaled_by_label = False
    if np.ma.max(a) > 1.5:                      # GeoTIFF came without scale metadata
        a = a * LABEL_SCALE
        scaled_by_label = True
    if np.ma.max(a) > 1.0001 or np.ma.min(a) < -1e-4:
        raise ValueError(f"values outside 0..1 after scaling: {a.min()}..{a.max()}")
    return {"centre": float(a[1, 1]), "min": float(a.min()), "mean": float(a.mean()),
            "max": float(a.max()), "scaled_by_label": scaled_by_label}


def compare(sites, results_dir, open_map):
    rows = []
    with rasterio.Env(**ENV):
        srcs = {k: open_map(k) for k in MAPS}
        try:
            for s in sites:
                summ = json.loads((results_dir / f"{s['id']}.json").read_text())["summary_by_mast"]
                g = {k: sample_fraction(srcs[k], s["lon"], s["lat"]) for k in MAPS}
                row = {"site": s["id"], "name": s["name"]}
                for k in MAPS:
                    ref = round(100 * g[k]["centre"], 1)
                    row[f"goddard_{k}_pct"] = ref
                    row[f"goddard_{k}_pct_3x3"] = [round(100 * g[k]["min"], 1), round(100 * g[k]["max"], 1)]
                    for mast in ("0", "2"):
                        ours = summ[mast][f"{k}_pct"]
                        row[f"ours_{k}_pct_{mast}m"] = ours
                        row[f"diff_{k}_{mast}m"] = round(ours - ref, 1)
                    row[f"{k}_scaled_by_label"] = g[k]["scaled_by_label"]
                rows.append(row)
        finally:
            for src in srcs.values():
                src.close()
    return rows


def to_markdown(rows):
    out = ["# Our visibility vs NASA Goddard (PGDA 69, 85S 60 m)", "",
           "Goddard: 18.6-year hourly average, surface level, 60 m pixel at the site point "
           "(3x3 range in brackets). Ours: 2027, hourly, 0 m and 2 m mast. diff = ours - Goddard "
           "(percentage points).", "",
           "| Site | Goddard Sun % | Ours Sun 0 m | diff 0 m | Ours Sun 2 m | diff 2 m | "
           "Goddard Earth % | Ours Earth 0 m | diff 0 m | Ours Earth 2 m | diff 2 m |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        out.append(
            f"| {r['name']} | {r['goddard_sun_pct']} ({r['goddard_sun_pct_3x3'][0]}–{r['goddard_sun_pct_3x3'][1]}) "
            f"| {r['ours_sun_pct_0m']} | {r['diff_sun_0m']:+} | {r['ours_sun_pct_2m']} "
            f"| {r['diff_sun_2m']:+} "
            f"| {r['goddard_earth_pct']} ({r['goddard_earth_pct_3x3'][0]}–{r['goddard_earth_pct_3x3'][1]}) "
            f"| {r['ours_earth_pct_0m']} | {r['diff_earth_0m']:+} | {r['ours_earth_pct_2m']} "
            f"| {r['diff_earth_2m']:+} |")
    out += ["", "Likely reasons for differences (stated as likely, not proven): the 60 m pixel averages "
            "lower ground around these high points; different time span (18.6 years vs 2027); "
            "different observer height (Goddard is at the surface); Goddard counts Earth visible if any "
            "part of its disc clears the terrain, we use the disc centre."]
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", help="folder with the two .TIF maps (default: read COGs over HTTP)")
    ap.add_argument("--sites", default="sites.json",
                    help="points file in data_out/ (e.g. nearby.json for M2's nearby points)")
    ap.add_argument("--name", default="goddard_terrain",
                    help="output base name in docs/validation/ (e.g. goddard_nearby)")
    args = ap.parse_args()
    sites = json.loads((ROOT / "data_out" / args.sites).read_text())
    rows = compare(sites, ROOT / "data_out" / "results",
                   lambda k: rasterio.open(map_path(k, args.local)))
    out = ROOT / "docs" / "validation"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{args.name}.json").write_text(json.dumps(rows, indent=2))
    (out / f"{args.name}.md").write_text(to_markdown(rows), encoding="utf-8")
    print(to_markdown(rows))
    print(f"wrote docs/validation/{args.name}.json and .md")


if __name__ == "__main__":
    main()
