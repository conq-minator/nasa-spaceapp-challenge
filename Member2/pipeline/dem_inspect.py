"""T1 - Read each site DEM's metadata and take the site point from the file itself.

Usage:  python -m pipeline.terrain.dem_inspect data_raw/dem/near/*.tif
Writes: data/sites_draft.json  (review it before it becomes data/sites.json)

Nothing is hard-coded: CRS, reference radius, scale/offset and nodata
all come from the file. The site point is the tile centre (confirm this
matches PGDA product 78's description of its tiles).
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from pyproj import CRS, Transformer


def sample_bilinear(src, x, y):
    """Height (metres, scale/offset applied) at projected x, y. NaN if nodata/outside."""
    col, row = ~src.transform * (x, y)
    c, r = col - 0.5, row - 0.5            # pixel centres sit at +0.5
    c0, r0 = int(np.floor(c)), int(np.floor(r))
    a = src.read(1, window=Window(c0, r0, 2, 2), masked=True, boundless=True)
    a = a.astype("float64").filled(np.nan)
    a = a * src.scales[0] + src.offsets[0]
    fc, fr = c - c0, r - r0
    top = a[0, 0] * (1 - fc) + a[0, 1] * fc
    bot = a[1, 0] * (1 - fc) + a[1, 1] * fc
    return float(top * (1 - fr) + bot * fr)


def describe(path):
    path = Path(path)
    with rasterio.open(path) as src:
        crs = CRS.from_user_input(src.crs)
        to_geo = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
        cx = (src.bounds.left + src.bounds.right) / 2
        cy = (src.bounds.bottom + src.bounds.top) / 2
        lon, lat = to_geo.transform(cx, cy)
        elev = sample_bilinear(src, cx, cy)

        # cheap nodata check on a decimated read (full 5 m tiles can be large)
        step = max(1, max(src.width, src.height) // 1024)
        small = src.read(1, masked=True,
                         out_shape=(src.height // step, src.width // step))
        nodata_frac = float(np.ma.getmaskarray(small).mean())

        return {
            "id": path.stem,
            "file": str(path),
            "lat": round(lat, 6),
            "lon_east": round(lon % 360, 6),
            "elev_m": round(elev, 2),
            "center_xy_m": [cx, cy],
            "ref_radius_m": crs.ellipsoid.semi_major_metre,
            "crs_proj4": crs.to_proj4(),
            "res_m": list(src.res),
            "shape": [src.height, src.width],
            "dtype": src.dtypes[0],
            "nodata": src.nodata,
            "scale": src.scales[0],
            "offset": src.offsets[0],
            "units": src.units[0],
            "bounds_m": list(src.bounds),
            "nodata_frac_approx": round(nodata_frac, 4),
        }


def main(paths):
    rows = [describe(p) for p in paths]
    for d in rows:
        print(f"\n== {d['id']}")
        for k, v in d.items():
            if k != "id":
                print(f"  {k:20s} {v}")
    out = Path("data/sites_draft.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, indent=2))
    print(f"\nwrote {out} ({len(rows)} sites)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python -m pipeline.terrain.dem_inspect <dem.tif> [...]")
    main(sys.argv[1:])
