"""Read PGDA 78 ROI shapefiles (polygon .shp + .dbf with X/Y point per ROI). OWNER: M2.

No GDAL/fiona needed: the files are tiny and the format is fixed. Coordinates are in the
same south-polar stereographic metres as the site DEMs (see the .prj next to the .shp).
"""
import struct
from pathlib import Path

import numpy as np


def _dbf(path):
    d = Path(path).read_bytes()
    nrec, hlen, rlen = struct.unpack("<IHH", d[4:12])
    fields = [(d[i:i + 11].split(b"\0")[0].decode(), d[i + 16]) for i in range(32, hlen - 1, 32)]
    rows = []
    for k in range(nrec):
        r, o, row = d[hlen + k * rlen: hlen + (k + 1) * rlen], 1, {}
        for name, n in fields:
            row[name] = r[o:o + n].decode().strip()
            o += n
        rows.append(row)
    return rows


def _polygons(path):
    b = Path(path).read_bytes()
    if struct.unpack("<i", b[32:36])[0] != 5:
        raise ValueError(f"{path}: expected polygon shapefile")
    out, p = [], 100
    while p < len(b):
        _num, clen = struct.unpack(">ii", b[p:p + 8])
        c = b[p + 8:p + 8 + clen * 2]
        nparts, npts = struct.unpack("<ii", c[36:44])
        o = 44 + 4 * nparts
        out.append(np.array(struct.unpack(f"<{2 * npts}d", c[o:o + 16 * npts])).reshape(-1, 2))
        p += 8 + clen * 2
    return out


def _inside(px, py, pts):
    """Even-odd point-in-polygon test."""
    x, y = pts[:, 0], pts[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    cross = ((y > py) != (y2 > py)) & (px < (x2 - x) * (py - y) / np.where(y2 == y, 1e-300, y2 - y) + x)
    return bool(np.count_nonzero(cross) % 2)


def _interior_point(pts, step=2.5):
    """Area centroid if it lies inside the polygon, else the interior grid point nearest it."""
    x, y = pts[:, 0], pts[:, 1]
    cr = x * np.roll(y, -1) - np.roll(x, -1) * y
    a = 0.5 * np.sum(cr)
    cx = np.sum((x + np.roll(x, -1)) * cr) / (6 * a)
    cy = np.sum((y + np.roll(y, -1)) * cr) / (6 * a)
    if _inside(cx, cy, pts):
        return float(cx), float(cy), "polygon centroid"
    gx, gy = np.meshgrid(np.arange(x.min(), x.max(), step), np.arange(y.min(), y.max(), step))
    cand = [(px, py) for px, py in zip(gx.ravel(), gy.ravel()) if _inside(px, py, pts)]
    px, py = min(cand, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
    return float(px), float(py), "interior point nearest centroid"


def read_rois(shp_path):
    """List of ROIs sorted largest first: {index, x, y, point_source, area_m2, n_vertices}.
    x/y = the point stored in the .dbf (PGDA's own representative point); if that field is
    unreadable (some .dbf files hold '*****' overflow), an interior point of the polygon."""
    shp = Path(shp_path)
    polys, rows = _polygons(shp), _dbf(shp.with_suffix(".dbf"))
    rois = []
    for i, (pts, row) in enumerate(zip(polys, rows)):
        x, y = pts[:, 0], pts[:, 1]
        area = 0.5 * abs(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
        try:
            px, py, src = float(row["X"]), float(row["Y"]), "dbf X/Y"
        except (KeyError, ValueError):
            px, py, src = _interior_point(pts)
        rois.append({"index": i + 1, "x": px, "y": py, "point_source": src,
                     "area_m2": round(float(area), 1), "n_vertices": int(len(pts))})
    return sorted(rois, key=lambda r: -r["area_m2"])
