"""Horizon mask checks on synthetic south-polar stereographic DEMs. Run: py -m pytest pipeline/tests"""
import math

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

from pipeline.horizon import (DEMSampler, compute_horizons, destination, elevation_angle,
                              elevation_angle_arc, local_heightmap)

R = 1737400.0
SPS = f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R} +units=m +no_defs"
GEO = f"+proj=longlat +R={R} +no_defs"
LAT0 = -89.0
Y0 = 2 * R * math.tan(math.pi / 4 + math.radians(LAT0) / 2)   # tile centre on lon 0 meridian


def write_dem(path, fn, n=801, res=10.0, x0=0.0, y0=Y0):
    left, top = x0 - n * res / 2, y0 + n * res / 2
    xs = left + (np.arange(n) + 0.5) * res
    ys = top - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    lon, lat = Transformer.from_crs(SPS, GEO, always_xy=True).transform(X, Y)
    with rasterio.open(path, "w", driver="GTiff", height=n, width=n, count=1, dtype="float32",
                       crs=SPS, transform=from_origin(left, top, res, res)) as dst:
        dst.write(fn(lat, lon).astype("float32"), 1)
    s = DEMSampler(path)
    lat0, lon0 = s.latlon(x0, y0)
    return s, lat0, lon0


def gc_dist(lat1, lon1, lat2, lon2):
    a, b = np.radians(lat1), np.radians(lat2)
    dl = np.radians(lon2 - lon1)
    return R * np.arccos(np.clip(np.sin(a) * np.sin(b) + np.cos(a) * np.cos(b) * np.cos(dl), -1, 1))


def test_arc_form_matches_3d_form():
    la, lo = destination(-89.5, 40.0, 123.0, np.array([10.0, 1e3, 5e4]))
    h = np.array([5.0, 80.0, -300.0])
    a = elevation_angle(-89.5, 40.0, 100.0, 2.0, la, lo, h)
    b = elevation_angle_arc(np.array([10.0, 1e3, 5e4]), h, 102.0)
    assert np.allclose(a, b, atol=1e-9)


def test_flat_moon_gives_curvature_dip(tmp_path):
    """Smooth sphere: horizon = -sqrt(2m/R) (true geometric dip), every azimuth."""
    s, la, lo = write_dem(tmp_path / "flat.tif", lambda lat, lon: np.zeros_like(lat), n=1601)
    r = compute_horizons(la, lo, 0.0, [2, 5, 10], s, pixel_m=10.0, dense_m=7900, max_m=7900, R=R)
    for m in (2, 5, 10):
        expect = -math.degrees(math.sqrt(2 * m / R))
        assert np.allclose(r["horizon_deg"][m], expect, atol=0.003), m
        assert np.allclose(r["horizon_dist_m"][m], math.sqrt(2 * m * R), rtol=0.05)


def test_bump_appears_at_the_right_azimuth(tmp_path):
    """A 100 m hill 1 km EAST must block at az 90 (clockwise from north), not 270."""
    s0, la, lo = write_dem(tmp_path / "f.tif", lambda lat, lon: np.zeros_like(lat))
    plat, plon = destination(la, lo, 90.0, 1000.0)
    bump = lambda lat, lon: 100.0 * np.exp(-(gc_dist(lat, lon, plat, plon) / 60.0) ** 2)
    s, la, lo = write_dem(tmp_path / "bump.tif", bump)
    r = compute_horizons(la, lo, 0.0, [2], s, pixel_m=10.0, dense_m=4000, max_m=4000, R=R)
    h = np.array(r["horizon_deg"][2])
    peak_az = np.argmax(h) * 0.5
    assert peak_az == pytest.approx(90.0, abs=0.5)
    expect = math.degrees(math.atan2(98.0, 1000.0))          # ~5.6 deg
    assert h.max() == pytest.approx(expect, abs=0.1)
    assert h[540] < 0                                        # az 270: nothing there


def test_higher_mast_never_raises_horizon(tmp_path):
    rng = np.random.default_rng(1)
    k = rng.normal(size=(6, 2))
    rough = lambda lat, lon: 30 * np.sin(k[0, 0] * lat * 50 + k[0, 1] * lon) + 20 * np.cos(lon * 3)
    s, la, lo = write_dem(tmp_path / "rough.tif", rough)
    r = compute_horizons(la, lo, float(s(la, lo)), [0, 2, 5, 10], s, pixel_m=10.0,
                         dense_m=4000, max_m=4000, R=R)
    for lo_m, hi_m in ((0, 2), (2, 5), (5, 10)):
        assert np.all(r["horizon_deg"][hi_m] <= r["horizon_deg"][lo_m] + 1e-9)


def test_heightmap_east_is_east(tmp_path):
    s0, la, lo = write_dem(tmp_path / "f.tif", lambda lat, lon: np.zeros_like(lat))
    plat, plon = destination(la, lo, 90.0, 1000.0)
    bump = lambda lat, lon: 100.0 * np.exp(-(gc_dist(lat, lon, plat, plon) / 60.0) ** 2)
    s, la, lo = write_dem(tmp_path / "bump.tif", bump)
    hm, off = local_heightmap(la, lo, 0.0, s, 2000.0, 20.0, R)
    row, col = np.unravel_index(np.nanargmax(hm), hm.shape)
    assert off[col] == pytest.approx(1000.0, abs=20)          # east
    assert off[::-1][row] == pytest.approx(0.0, abs=20)       # on the E-W line


def test_team_grid_row0_is_south_and_curvature_subtracted(tmp_path):
    """Team heightmap contract: row 0 = southernmost, heights minus d^2/2R."""
    from pipeline.horizon import team_grid
    s0, la, lo = write_dem(tmp_path / "f.tif", lambda lat, lon: np.zeros_like(lat))
    plat, plon = destination(la, lo, 0.0, 1000.0)                 # hill 1 km NORTH
    bump = lambda lat, lon: 100.0 * np.exp(-(gc_dist(lat, lon, plat, plon) / 60.0) ** 2)
    s, la, lo = write_dem(tmp_path / "north.tif", bump)
    z = team_grid(la, lo, 0.0, s, 256, 10.0, R)
    row, col = np.unravel_index(np.nanargmax(z), z.shape)
    north = (row + 0.5) * 10.0 - 1280.0
    east = (col + 0.5) * 10.0 - 1280.0
    assert north == pytest.approx(1000.0, abs=10) and east == pytest.approx(0.0, abs=10)
    corner_d = math.hypot(1275.0, 1275.0)                         # flat ground away from the hill
    assert z[0, 0] == pytest.approx(-corner_d ** 2 / (2 * R), abs=0.01)
