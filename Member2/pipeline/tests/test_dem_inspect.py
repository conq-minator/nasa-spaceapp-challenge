"""Tests for T1. Run from repo root:  python -m pytest tests/terrain -v

Builds small synthetic GeoTIFFs in a Moon south-polar stereographic CRS,
so the checks do not depend on the real downloads.
"""
import math

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.dem_inspect import describe, sample_bilinear

R = 1737400.0
MOON_SPS = f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R} +units=m +no_defs"


def plane(x, y):
    return 1500.0 + 0.01 * x - 0.02 * y


def make_dem(path, x0, y0, n=64, res=5.0, fn=plane):
    left, top = x0 - n * res / 2, y0 + n * res / 2
    xs = left + (np.arange(n) + 0.5) * res
    ys = top - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    with rasterio.open(path, "w", driver="GTiff", height=n, width=n, count=1,
                       dtype="float32", crs=MOON_SPS,
                       transform=from_origin(left, top, res, res)) as dst:
        dst.write(fn(X, Y).astype("float32"), 1)
    return path


def test_tile_at_pole_is_minus_90(tmp_path):
    d = describe(make_dem(tmp_path / "pole.tif", 0.0, 0.0))
    assert d["lat"] == pytest.approx(-90.0, abs=1e-6)


def test_latitude_from_stereographic_radius(tmp_path):
    # south-polar stereographic, k0=1: rho = 2R tan(pi/4 + lat/2)
    lat = -89.0
    rho = 2 * R * math.tan(math.pi / 4 + math.radians(lat) / 2)   # ~30.3 km
    d = describe(make_dem(tmp_path / "s89.tif", 0.0, rho))
    assert d["lat"] == pytest.approx(lat, abs=1e-6)


def test_radius_read_from_file(tmp_path):
    d = describe(make_dem(tmp_path / "r.tif", 1000.0, 2000.0))
    assert d["ref_radius_m"] == pytest.approx(R)


def test_bilinear_exact_on_plane(tmp_path):
    p = make_dem(tmp_path / "plane.tif", 5000.0, -3000.0)
    with rasterio.open(p) as src:
        for dx, dy in [(0, 0), (3.3, -7.1), (-41.2, 12.9), (60.0, 60.0)]:
            x, y = 5000.0 + dx, -3000.0 + dy
            assert sample_bilinear(src, x, y) == pytest.approx(plane(x, y), abs=1e-3)


def test_outside_tile_is_nan(tmp_path):
    p = make_dem(tmp_path / "o.tif", 0.0, 0.0)
    with rasterio.open(p) as src:
        assert math.isnan(sample_bilinear(src, 10_000.0, 10_000.0))
