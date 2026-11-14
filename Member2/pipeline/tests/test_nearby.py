"""Nearby points reuse the parent heightmap with the lander moved by lander_offset_m.
Check that the offset convention (east, north) matches where the point really is."""
import math

import numpy as np
import pytest

from pipeline.export import NEARBY_DIRS
from pipeline.horizon import destination, team_grid
from pipeline.tests.test_horizon import R, gc_dist, write_dem


def _bilinear_team(z, east, north, cell, n):
    """Same lookup as Member2/src/raycast.js heightAt(): row 0 south, cell centres."""
    size = n * cell
    c = (east + size / 2) / cell - 0.5
    r = (north + size / 2) / cell - 0.5
    c0, r0 = int(math.floor(c)), int(math.floor(r))
    fc, fr = c - c0, r - r0
    lo = z[r0, c0] * (1 - fc) + z[r0, c0 + 1] * fc
    hi = z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c0 + 1] * fc
    return lo * (1 - fr) + hi * fr


@pytest.mark.parametrize("tag,word,az", NEARBY_DIRS)
def test_offset_point_lands_on_the_same_terrain_in_parent_heightmap(tmp_path, tag, word, az):
    # a bump exactly 1 km away in this direction
    _s0, la, lo = write_dem(tmp_path / "f.tif", lambda lat, lon: np.zeros_like(lat))
    plat, plon = destination(la, lo, az, 1000.0)
    bump = lambda lat, lon: 100.0 * np.exp(-(gc_dist(lat, lon, plat, plon) / 80.0) ** 2)
    s, la, lo = write_dem(tmp_path / f"{tag}.tif", bump)

    east = 1000.0 * math.sin(math.radians(az))      # what export.nearby_points writes
    north = 1000.0 * math.cos(math.radians(az))
    n, cell = 256, 10.0
    z = team_grid(la, lo, 0.0, s, n, cell, R)       # parent heightmap (curvature subtracted)
    curv = 1000.0 ** 2 / (2 * R)
    got = _bilinear_team(z, east, north, cell, n) + curv
    assert got == pytest.approx(100.0, abs=2.0), word   # the bump top is at the offset
    assert float(s(plat, plon)) == pytest.approx(100.0, abs=0.5)
