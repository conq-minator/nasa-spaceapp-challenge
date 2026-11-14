"""Offline tests for step 3 (no kernels needed: a fake angle function stands in for SPICE)."""
import json
import math

from pipeline import make_angles as ma

SITE04 = {"id": "site04", "lat": -89.761966, "lon": -157.067197,
          "ground_height_m": 1729.12, "obs_height_m": 2.0}


def fake_angles(site, body, times):
    """Sun circles once per synodic month at ~1.1 deg; Earth bobs around 5 deg."""
    n = len(times)
    if body == "sun":
        return ([(60 - ma.SUN_RATE_DEG_H * k) % 360 for k in range(n)],
                [1.1 + 0.5 * math.sin(k / 4000) for k in range(n)])
    return ([(160 + 3 * math.sin(k / 300)) % 360 for k in range(n)],
            [5 * math.sin(k / 330) for k in range(n)])


def test_hourly_times_cover_2027_exactly():
    t = ma.hourly_times()
    assert len(t) == 8760 and len(set(t)) == 8760
    assert t[0] == "2027-01-01T00:00:00Z" and t[-1] == "2027-12-31T23:00:00Z"
    assert t[744] == "2027-02-01T00:00:00Z"            # month boundary: 31 * 24


def test_build_site_follows_contract():
    rec = ma.build_site(SITE04, ma.hourly_times(), angle_fn=fake_angles)
    for k in ("site", "t", "sun_az", "sun_el", "earth_az", "earth_el"):
        assert k in rec
    assert rec["site"] == "site04"
    assert all(len(rec[k]) == 8760 for k in ("sun_az", "sun_el", "earth_az", "earth_el"))
    assert all(0 <= a < 360 for a in rec["sun_az"] + rec["earth_az"])
    def boundary_angles(site, body, times):
        return ([360.0, -0.0004] + [12.3456] * (len(times) - 2), [0.0] * len(times))
    wrapped = ma.build_site(SITE04, ma.hourly_times(), angle_fn=boundary_angles)
    assert wrapped["sun_az"][:3] == [0.0, 0.0, 12.346]
    json.dumps(rec)                                      # serialisable


def test_checks_pass_on_good_data():
    rec = ma.build_site(SITE04, ma.hourly_times(), angle_fn=fake_angles)
    assert ma.check_angles(rec, SITE04) == []


def test_checks_catch_bad_data():
    rec = ma.build_site(SITE04, ma.hourly_times(), angle_fn=fake_angles)
    rec["sun_el"][100] = 4.0                             # impossible at Shackleton (> 1.8 deg)
    rec["earth_az"] = rec["earth_az"][:-1]               # length mismatch
    rec["earth_az"][0] = 360.0                           # azimuth range is [0, 360)
    rec["t"][5] = rec["t"][4]                            # duplicate hour
    p = " | ".join(ma.check_angles(rec, SITE04))
    assert ("geometric limit" in p and "earth_az has" in p and "azimuth outside" in p
            and "duplicate" in p)


def test_checks_catch_wrong_sun_rate():
    def fast(site, body, times):
        az, el = fake_angles(site, body, times)
        return ([(a * 2) % 360 for a in az], el) if body == "sun" else (az, el)
    rec = ma.build_site(SITE04, ma.hourly_times(), angle_fn=fast)
    assert any("azimuth rate" in x for x in ma.check_angles(rec, SITE04))
