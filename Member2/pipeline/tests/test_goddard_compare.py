"""Tests for M2.2 goddard_compare (synthetic maps, no network)."""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from goddard_compare import compare, to_markdown  # noqa: E402

R = 1737400.0
SPS = f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R} +units=m +no_defs"


def make_map(path, value_fn, scale=None):
    n, res, half = 200, 60.0, 6000.0
    xs = -half + (np.arange(n) + 0.5) * res
    ys = half - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    arr = value_fn(X, Y)
    dtype = "int16" if scale else "float32"
    with rasterio.open(path, "w", driver="GTiff", height=n, width=n, count=1, dtype=dtype,
                       crs=SPS, transform=from_origin(-half, half, res, res)) as dst:
        dst.write((arr / scale).round().astype(dtype) if scale else arr.astype(dtype), 1)
        if scale:
            dst.scales = (scale,)
    return path


def setup(tmp_path, scale=None):
    crs = CRS.from_proj4(SPS)
    lon, lat = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True).transform(1000.0, -2000.0)
    sites = [{"id": "s1", "name": "Test site", "lat": lat, "lon": lon}]
    res = tmp_path / "results"
    res.mkdir()
    (res / "s1.json").write_text(json.dumps({"summary_by_mast": {
        "0": {"sun_pct": 50.0, "earth_pct": 30.0}, "2": {"sun_pct": 70.0, "earth_pct": 40.0}}}))
    maps = {"sun": make_map(tmp_path / "sun.tif", lambda X, Y: np.full_like(X, 0.65), scale),
            "earth": make_map(tmp_path / "earth.tif", lambda X, Y: np.full_like(X, 0.45), scale)}
    return sites, res, maps


def test_values_and_diffs(tmp_path):
    sites, res, maps = setup(tmp_path)
    rows = compare(sites, res, lambda k: rasterio.open(maps[k]))
    r = rows[0]
    assert r["goddard_sun_pct"] == 65.0 and r["goddard_earth_pct"] == 45.0
    assert r["diff_sun_0m"] == -15.0 and r["diff_sun_2m"] == 5.0
    assert r["diff_earth_0m"] == -15.0 and r["diff_earth_2m"] == -5.0
    markdown = to_markdown(rows)
    assert "Test site" in markdown and "diff 0 m" in markdown
    assert "| 50.0 | -15.0 | 70.0 | +5.0 |" in markdown


def test_int16_with_scale_metadata(tmp_path):
    sites, res, maps = setup(tmp_path, scale=4e-05)
    r = compare(sites, res, lambda k: rasterio.open(maps[k]))[0]
    assert abs(r["goddard_sun_pct"] - 65.0) < 0.1
    assert r["sun_scaled_by_label"] is False


def test_picks_pixel_under_site(tmp_path):
    crs = CRS.from_proj4(SPS)
    lon, lat = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True).transform(1000.0, -2000.0)
    sites, res, _ = setup(tmp_path)
    grad = make_map(tmp_path / "grad.tif", lambda X, Y: np.clip((X + 6000) / 12000, 0, 1))
    r = compare(sites, res, lambda k: rasterio.open(grad))[0]
    assert abs(r["goddard_sun_pct"] - 100 * (1000 + 6000) / 12000) < 0.6   # within one 60 m pixel
