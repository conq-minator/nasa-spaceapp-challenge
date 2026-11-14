"""Offline tests for horizons_client (no internet needed). Run from Member1/:
    py -m pytest pipeline/tests -q
"""
import json

import pytest

from pipeline import horizons_client as hc

SITE04 = {"id": "site04", "lat": -89.761966, "lon": -157.067197,
          "ground_height_m": 1729.12, "obs_height_m": 2.0}

# Shaped like a Horizons CSV observer table (QUANTITIES=4). The two blank-ish columns after
# the date are Horizons' solar/lunar presence flags.
SAMPLE = """\
*******************************************************************************
Center body name: Moon (301)                      {source: DE441}
Center-site name: (user defined site below)
Center geodetic : 202.932803,-89.761966,1.7311200 {E-lon(deg),Lat(deg),Alt(km)}
*******************************************************************************
 Date__(UT)__HR:MN, , , Azimuth_(a-app), Elevation_(a-app),
*******************************************************************************
$$SOE
 2027-Jan-01 00:00, , ,  120.450000,  -0.820000,
 2027-Jan-01 01:00,*, ,  120.958000,  -0.750000,
 2027-Jan-01 02:00,*,m,  360.000000,   0.100000,
$$EOE
*******************************************************************************
"""


def test_site_coord_matches_handoff():
    # Value given in the M2 -> M1 handoff, section 6.1
    assert hc.site_coord(SITE04) == "202.932803,-89.761966,1.73112"


def test_build_params_quotes_values():
    p = hc.build_params(SITE04, "earth", "2027-01-01 00:00", "2027-01-02 23:00")
    assert p["COMMAND"] == "'399'"
    assert p["CENTER"] == "'coord@301'"
    assert p["SITE_COORD"] == "'202.932803,-89.761966,1.73112'"
    assert p["format"] == "json"                       # format is not quoted
    with pytest.raises(ValueError):
        hc.build_params(SITE04, "mars", "2027-01-01 00:00", "2027-01-02 00:00")


def test_parse_sample():
    tr = hc.parse(SAMPLE)
    assert tr["t"] == ["2027-01-01T00:00:00Z", "2027-01-01T01:00:00Z", "2027-01-01T02:00:00Z"]
    assert tr["az"] == [120.45, 120.958, 0.0]          # 360 wraps to 0
    assert tr["el"] == [-0.82, -0.75, 0.1]


def test_parse_without_header_uses_last_two_numbers():
    no_header = SAMPLE.replace(" Date__(UT)__HR:MN, , , Azimuth_(a-app), Elevation_(a-app),\n", "")
    assert hc.parse(no_header)["el"] == [-0.82, -0.75, 0.1]


def test_parse_rejects_error_text():
    with pytest.raises(hc.HorizonsError):
        hc.parse("Cannot interpret date. Type \"?!\" for help.")


def test_header_info_shows_observer():
    lines = hc.header_info(SAMPLE)
    assert any(ln.startswith("Center geodetic") for ln in lines)


def test_fetch_uses_cache_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(hc, "CACHE_DIR", tmp_path)
    p = hc.build_params(SITE04, "sun", "2027-01-01 00:00", "2027-01-01 02:00")
    hc.cache_path(p).write_text(SAMPLE)

    class NoNetwork:
        def get(self, *a, **k):
            raise AssertionError("should not touch the network")
    assert hc.fetch(p, session=NoNetwork()) == SAMPLE


class FakeResp:
    def __init__(self, status, payload):
        self.status_code, self._p = status, payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._p


def test_fetch_raises_on_error_with_http_200(tmp_path, monkeypatch):
    monkeypatch.setattr(hc, "CACHE_DIR", tmp_path)

    class Sess:
        def get(self, *a, **k):
            return FakeResp(200, {"error": "bad SITE_COORD"})
    p = hc.build_params(SITE04, "sun", "2027-01-01 00:00", "2027-01-01 02:00")
    with pytest.raises(hc.HorizonsError, match="bad SITE_COORD"):
        hc.fetch(p, session=Sess())
    assert not hc.cache_path(p).exists()               # errors are never cached


def test_fetch_retries_503_then_caches(tmp_path, monkeypatch):
    monkeypatch.setattr(hc, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(hc.time, "sleep", lambda s: None)
    replies = [FakeResp(503, {}), FakeResp(200, {"result": SAMPLE})]

    class Sess:
        def get(self, *a, **k):
            return replies.pop(0)
    p = hc.build_params(SITE04, "sun", "2027-01-01 00:00", "2027-01-01 02:00")
    assert hc.fetch(p, session=Sess()) == SAMPLE
    assert hc.cache_path(p).read_text() == SAMPLE


def _track(n=48, rate=0.508, el=0.5, gap_at=None):
    from datetime import datetime, timedelta
    t0 = datetime(2027, 1, 1)
    hours = [h + (1 if gap_at is not None and h >= gap_at else 0) for h in range(n)]
    return {"t": [(t0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in hours],
            "az": [(10 + rate * h) % 360 for h in hours], "el": [el] * n}


def test_checks_pass_on_good_sun_track():
    assert hc.check_track(_track(), SITE04, "sun") == []


def test_checks_catch_problems():
    assert any("time steps" in p for p in hc.check_track(_track(gap_at=10), SITE04, "sun"))
    assert any("limit" in p for p in hc.check_track(_track(el=3.0), SITE04, "sun"))   # >1.8 deg
    assert any("deg/h" in p for p in hc.check_track(_track(rate=15.0), SITE04, "sun"))


def test_real_sites_json_gives_handoff_coords():
    sites = hc.load_sites()
    expected = {"site01": "222.851347,-89.452675,1.95839", "site04": "202.932803,-89.761966,1.73112",
                "site07": "123.776844,-88.807326,1.65035", "site11": "291.624236,-88.668256,1.81619",
                "site23": "2.197695,-86.002750,5.15470"}
    assert {k: hc.site_coord(sites[k]) for k in expected} == expected
