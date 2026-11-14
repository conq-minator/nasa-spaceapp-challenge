"""Offline tests for step 4 (combine.py)."""
import json

import pytest

from pipeline import combine as cb
from pipeline import horizons_client as hc


def test_horizon_at_interpolates_and_wraps():
    prof = [float(i) for i in range(360)]          # horizon = azimuth number
    assert cb.horizon_at(prof, 10.0) == 10.0
    assert cb.horizon_at(prof, 10.25) == pytest.approx(10.25)
    assert cb.horizon_at(prof, 359.5) == pytest.approx(359 * 0.5 + 0 * 0.5)   # wraps to bin 0
    assert cb.horizon_at(prof, 370.0) == 10.0
    assert cb.horizon_at(prof, -1.0) == 359.0


def test_disc_fraction():
    assert cb.disc_fraction(1.0, 0.0, 0.25) == 1.0
    assert cb.disc_fraction(-1.0, 0.0, 0.25) == 0.0
    assert cb.disc_fraction(0.0, 0.0, 0.25) == pytest.approx(0.5)
    assert 0.5 < cb.disc_fraction(0.1, 0.0, 0.25) < 1.0


def test_longest_run():
    assert cb.longest_run([1, 0, 0, 1, 0, 0, 0, 1]) == (3, 4)
    assert cb.longest_run([1, 1, 1]) == (0, None)
    assert cb.longest_run([0, 0]) == (2, 0)


def _ang(sun_el, earth_el, az=90.0, site="siteXX"):
    n = len(sun_el)
    return {"site": site, "t": [f"2027-01-01T{h:02d}:00:00Z" for h in range(n)],
            "sun_az": [az] * n, "sun_el": sun_el, "earth_az": [az] * n, "earth_el": earth_el}


def _mask(h=0.5, site="siteXX"):
    prof = [h] * 360
    return {"site": site, "obs_height_m": 2.0, "az_step_deg": 1.0, "elev_deg": prof,
            "elev_deg_by_mast": {"2": prof, "10": [h - 1] * 360}}


def test_combine_flags_and_summary():
    # horizon 0.5 deg; Sun above it for hours 0,1,4; Earth above for 0..3
    res = cb.combine_site(_ang([1, 1, 0, 0.5, 1, 0], [2, 2, 2, 2, 0, 0]), _mask(0.5))
    assert res["sun_lit"] == [1, 1, 0, 0, 1, 0]                 # 0.5 is NOT > 0.5
    assert res["earth_vis"] == [1, 1, 1, 1, 0, 0]
    s = res["summary"]
    assert s["total_hours"] == 6
    assert s["sun_pct"] == 50.0 and s["earth_pct"] == pytest.approx(66.7)
    assert s["both_pct"] == pytest.approx(33.3)
    assert s["longest_night_h"] == 2 and s["longest_night_start"] == "2027-01-01T02:00:00Z"
    assert s["longest_comm_gap_h"] == 2
    assert res["summary_by_mast"]["10"]["sun_pct"] == 100.0      # lower horizon at 10 m
    assert set(res["summary_by_mast"]) == {"2", "10"}


def test_combine_rejects_bad_input():
    with pytest.raises(ValueError, match="mismatch"):
        cb.combine_site(_ang([1], [1], site="a"), _mask(site="b"))
    bad = _ang([1, 1], [1, 1])
    bad["earth_el"] = [1]
    with pytest.raises(ValueError, match="length"):
        cb.combine_site(bad, _mask())


def test_contract_fields_on_real_mask():
    mask = json.loads((hc.REPO / "data_out" / "mask" / "site04.json").read_text())
    ang = _ang([0.0] * 24, [0.0] * 24, site="site04")
    res = cb.combine_site(ang, mask)
    for k in ("site", "t", "sun_lit", "earth_vis", "summary"):
        assert k in res
    for k in ("sun_pct", "earth_pct", "both_pct", "longest_night_h", "longest_comm_gap_h"):
        assert k in res["summary"]
    assert set(res["sun_lit"]) <= {0, 1} and len(res["sun_lit"]) == 24
    json.dumps(res)


def test_margin_fields_match_flags():
    # WORKPLAN M1.2: margin = elevation - horizon; lit exactly when margin > 0
    res = cb.combine_site(_ang([1, 1, 0, 0.5, 1, 0], [2, 2, 2, 2, 0, 0]), _mask(0.5))
    assert res["sun_margin_deg"] == [0.5, 0.5, -0.5, 0.0, 0.5, -0.5]
    assert res["earth_margin_deg"] == [1.5, 1.5, 1.5, 1.5, -0.5, -0.5]
    assert [1 if m > 0 else 0 for m in res["sun_margin_deg"]] == res["sun_lit"]
    assert [1 if m > 0 else 0 for m in res["earth_margin_deg"]] == res["earth_vis"]
