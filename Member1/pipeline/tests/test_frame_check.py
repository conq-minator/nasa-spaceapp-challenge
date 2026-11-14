"""Offline tests for step 2 (no internet, no kernels needed). Run from Member1/:
    py -m pytest pipeline/tests -q -p no:asyncio
"""
import math

import pytest

from pipeline import frame_check as fc
from pipeline import spice_angles as sa

SITE04 = {"id": "site04", "lat": -89.761966, "lon": -157.067197,
          "ground_height_m": 1729.12, "obs_height_m": 2.0}


def test_observer_matches_what_horizons_printed():
    # Horizons header on Avasyu's laptop:  Center cylindric: 202.932803, 7.22516, -1739.12
    x, y, z = sa.observer_pos_km(SITE04)
    assert math.hypot(x, y) == pytest.approx(7.22516, abs=1e-4)
    assert z == pytest.approx(-1739.12, abs=0.01)
    assert math.degrees(math.atan2(y, x)) % 360 == pytest.approx(202.932803, abs=1e-6)


def test_angle_diff_wraps():
    assert fc.angle_diff(359.9, 0.1) == pytest.approx(-0.2)
    assert fc.angle_diff(0.1, 359.9) == pytest.approx(0.2)
    assert fc.angle_diff(10.0, 10.0) == 0.0


def test_compare_reports_worst():
    c = fc.compare({"az": [359.95, 10.0], "el": [1.0, 2.0]},
                   {"az": [0.02, 10.05], "el": [1.03, 2.0]})
    assert c["max_daz"] == pytest.approx(0.07)
    assert c["max_del"] == pytest.approx(0.03)


def test_missing_kernels_give_clear_message(tmp_path, monkeypatch):
    pytest.importorskip("spiceypy")
    monkeypatch.setattr(sa, "_loaded", False)
    with pytest.raises(FileNotFoundError, match="get_kernels"):
        sa.load_kernels(tmp_path)
