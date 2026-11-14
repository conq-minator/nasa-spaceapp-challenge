"""Pick a site point for a PGDA 78 tile that has no ROI file (Site23). OWNER: M2.

Same rule PGDA used to draw its ROIs (Barker et al.: regions > 2500 m2 with average
illumination > 70 %), applied to the PGDA 69 average-illumination map instead:
  1. read the illumination map over the 5 m tile,
  2. keep pixels with illumination >= threshold, group 8-connected regions,
  3. take the LARGEST region (same choice as for the sites that do have ROIs),
  4. site = the region pixel nearest the region's centroid (always inside the region).
Prints slope of the 5 m DEM around the point so a bad pick (cliff) is obvious.

  py -m pipeline.site_from_illum data_raw/dem/near/Site23_final_adj_5mpp_surf.tif \
      data_raw/illum/AVGVISIB_85S_060M_201608.TIF
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from pipeline.horizon import DEMSampler


def _label(mask):
    """8-connected component labels (no scipy)."""
    lab = np.zeros(mask.shape, int)
    n = 0
    for r0, c0 in zip(*np.nonzero(mask)):
        if lab[r0, c0]:
            continue
        n += 1
        stack = [(r0, c0)]
        lab[r0, c0] = n
        while stack:
            r, c = stack.pop()
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    rr, cc = r + dr, c + dc
                    if (0 <= rr < mask.shape[0] and 0 <= cc < mask.shape[1]
                            and mask[rr, cc] and not lab[rr, cc]):
                        lab[rr, cc] = n
                        stack.append((rr, cc))
    return lab, n


def pick(dem_path, illum_path, threshold=0.70, margin_m=500.0):
    dem = DEMSampler(dem_path)
    b = dem.bounds
    with rasterio.open(illum_path) as src:
        from pyproj import CRS
        if abs(CRS.from_user_input(src.crs).ellipsoid.semi_major_metre - dem.R) > 1:
            raise ValueError("illumination map and DEM use different radii")
        win = from_bounds(b.left + margin_m, b.bottom + margin_m,
                          b.right - margin_m, b.top - margin_m, src.transform).round_offsets().round_lengths()
        a = (src.read(1, window=win, masked=True).astype(float).filled(np.nan)
             * src.scales[0] + src.offsets[0])           # int16 DN * 4e-05 = fraction
        t = src.window_transform(win)
        res = abs(t.a)
    scale = 100.0 if np.nanmax(a) > 1.5 else 1.0          # percent or fraction
    frac = a / scale
    lab, n = _label(frac >= threshold)
    if n == 0:
        raise ValueError(f"no pixel >= {threshold:.0%} illumination in tile (max {np.nanmax(frac):.1%})")
    sizes = np.bincount(lab.ravel())[1:]
    k = int(np.argmax(sizes)) + 1
    rr, cc = np.nonzero(lab == k)
    xs = t.c + (cc + 0.5) * t.a
    ys = t.f + (rr + 0.5) * t.e
    i = int(np.argmin((xs - xs.mean()) ** 2 + (ys - ys.mean()) ** 2))
    x, y = float(xs[i]), float(ys[i])

    # 5 m DEM slope over a 3x3 (15 m) and 13x13 (60 m) neighbourhood
    def slope(base):
        d = np.array([-base, 0, base], float)
        z = dem.sample_xy(x + d[None, :], y + d[:, None])
        gx = (z[1, 2] - z[1, 0]) / (2 * base)
        gy = (z[0, 1] - z[2, 1]) / (2 * base)
        return round(float(np.degrees(np.arctan(np.hypot(gx, gy)))), 1)

    lat, lon = dem.latlon(x, y)
    return {
        "x_m": x, "y_m": y, "lat": round(lat, 6), "lon_east": round(lon % 360, 6),
        "elev_m": round(float(dem.sample_xy(x, y)), 2),
        "illum_at_point": round(float(frac[rr[i], cc[i]]), 3),
        "region_illum_mean": round(float(np.nanmean(frac[lab == k])), 3),
        "region_illum_max": round(float(np.nanmax(frac[lab == k])), 3),
        "region_area_m2": float(sizes[k - 1] * res * res),
        "n_regions": int(n), "threshold": threshold, "map_res_m": res,
        "slope_deg_10m": slope(5.0), "slope_deg_60m": slope(30.0),
        "source": f"{Path(illum_path).name}: largest region >= {threshold:.0%} avg illumination, "
                  f"pixel nearest its centroid",
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    print(json.dumps(pick(sys.argv[1], sys.argv[2]), indent=2))
