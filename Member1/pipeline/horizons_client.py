"""JPL Horizons client for LunaWise (M1, step 1). Sun / Earth azimuth + elevation
seen from a point on the Moon's surface.

What it does:
  site_coord(site)          -> SITE_COORD string from a data_out/sites.json entry
  build_params(...)         -> the Horizons query (one site, one body, one time span)
  fetch(params)             -> raw Horizons text; cached on disk, so each query runs only once
  parse(text)               -> {"t": [...], "az": [...], "el": [...]}

Smoke test against the real Horizons server (run from Member1/):
  py -m pipeline.horizons_client --site site04 --body sun --hours 48

Conventions (team contract): azimuth clockwise from lunar north, 0-360; elevation in degrees
above the local horizontal; times UTC "YYYY-MM-DDTHH:MM:SSZ"; heights metres above R = 1737.4 km.
"""
import argparse
import hashlib
import json
import math
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODIES = {"sun": "10", "earth": "399"}
M1 = Path(__file__).resolve().parent.parent
REPO = M1.parent
CACHE_DIR = M1 / "cache" / "horizons"          # git-ignored
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


class HorizonsError(RuntimeError):
    pass


# ----------------------------------------------------------------------------- query

def load_sites(path=REPO / "data_out" / "sites.json"):
    return {s["id"]: s for s in json.loads(Path(path).read_text())}


def site_coord(site):
    """'lon_east_0_360,lat,alt_km'. alt = ground + mast, metres above the 1737.4 km sphere."""
    lon = site["lon"] % 360.0
    alt_km = (site["ground_height_m"] + site["obs_height_m"]) / 1000.0
    return f"{lon:.6f},{site['lat']:.6f},{alt_km:.5f}"


def build_params(site, body, start, stop, step="60 min"):
    """start/stop: 'YYYY-MM-DD HH:MM' (UTC). Horizons includes BOTH ends."""
    if body not in BODIES:
        raise ValueError(f"body must be one of {list(BODIES)}")
    q = lambda v: f"'{v}'"                       # Horizons wants every value in single quotes
    return {
        "format": "json",
        "COMMAND": q(BODIES[body]),
        "OBJ_DATA": q("NO"),
        "MAKE_EPHEM": q("YES"),
        "EPHEM_TYPE": q("OBSERVER"),
        "CENTER": q("coord@301"),
        "COORD_TYPE": q("GEODETIC"),
        "SITE_COORD": q(site_coord(site)),
        "START_TIME": q(start),
        "STOP_TIME": q(stop),
        "STEP_SIZE": q(step),
        "QUANTITIES": q("4"),
        "ANG_FORMAT": q("DEG"),
        "APPARENT": q("AIRLESS"),
        "TIME_TYPE": q("UT"),
        "CSV_FORMAT": q("YES"),
        "EXTRA_PREC": q("YES"),
    }


# ----------------------------------------------------------------------------- fetch

def cache_path(params):
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
    return CACHE_DIR / f"{key}.txt"


def fetch(params, retries=4, pause_s=1.5, session=None):
    """Return the Horizons result text. Cached: the same params never hit the server twice.
    Horizons can report errors with HTTP 200, so the body is checked too."""
    cp = cache_path(params)
    if cp.exists():
        return cp.read_text()
    import requests
    s = session or requests
    for attempt in range(retries):
        r = s.get(API_URL, params=params, timeout=120)
        if r.status_code == 503:                     # busy: back off and retry
            time.sleep(pause_s * 2 ** (attempt + 1))
            continue
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            raise HorizonsError(data["error"])
        text = data.get("result", "")
        if "$$SOE" not in text:                       # error message inside a 200 response
            raise HorizonsError("no $$SOE in response. Start of response:\n" + text[:1500])
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cp.write_text(text)
        time.sleep(pause_s)                           # be polite to the server
        return text
    raise HorizonsError(f"Horizons still busy (503) after {retries} tries")


# ----------------------------------------------------------------------------- parse

_DATE = re.compile(r"(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?")


def _iso(field):
    m = _DATE.search(field)
    if not m:
        raise HorizonsError(f"can't read date in {field!r}")
    y, mon, d, hh, mm, ss = m.groups()
    dt = datetime(int(y), MONTHS[mon], int(d), int(hh), int(mm), int(round(float(ss or 0))),
                  tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _columns(text):
    """Find the azimuth / elevation column numbers from the CSV header line above $$SOE."""
    head = text.split("$$SOE")[0].strip().splitlines()
    header = next((ln for ln in reversed(head) if "Date" in ln and "," in ln), None)
    if header is None:
        return None
    cols = [c.strip().lower() for c in header.split(",")]
    az = next((i for i, c in enumerate(cols) if c.startswith("azi")), None)
    el = next((i for i, c in enumerate(cols) if c.startswith("elev")), None)
    return (az, el) if az is not None and el is not None else None


def parse(text):
    """Rows between $$SOE and $$EOE -> {"t", "az", "el"} (az wrapped to 0-360)."""
    if "$$SOE" not in text or "$$EOE" not in text:
        raise HorizonsError("missing $$SOE/$$EOE markers")
    cols = _columns(text)
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    t, az, el = [], [], []
    for line in body.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        if cols:
            a, e = float(f[cols[0]]), float(f[cols[1]])
        else:                                          # fallback: last two numbers on the row
            nums = [x for x in f[1:] if re.fullmatch(r"[-+]?\d+(\.\d+)?", x)]
            a, e = float(nums[-2]), float(nums[-1])
        t.append(_iso(f[0]))
        az.append(a % 360.0)
        el.append(e)
    if not t:
        raise HorizonsError("no data rows between $$SOE and $$EOE")
    return {"t": t, "az": az, "el": el}


def header_info(text):
    """The lines that say where Horizons put the observer (useful for the frame check)."""
    keep = ("Center geodetic", "Center cylindric", "Center radii", "Center body name",
            "Center-site name", "Target body name", "Time ")
    return [ln.strip() for ln in text.split("$$SOE")[0].splitlines()
            if ln.strip().startswith(keep)]


# ----------------------------------------------------------------------------- checks

def check_track(track, site, body, step_h=1.0):
    """Sanity checks. Returns a list of problems (empty = all good)."""
    problems = []
    ts = [datetime.strptime(x, "%Y-%m-%dT%H:%M:%SZ") for x in track["t"]]
    gaps = {(b - a).total_seconds() / 3600 for a, b in zip(ts, ts[1:])}
    if gaps != {step_h}:
        problems.append(f"time steps are {sorted(gaps)} h, expected only {step_h}")
    if not all(0 <= a < 360 for a in track["az"]):
        problems.append("azimuth outside 0-360")
    if body == "sun":
        bound = 1.54 + (90 - abs(site["lat"])) + 0.1      # Moon's 1.54 deg tilt + co-latitude
        worst = max(abs(e) for e in track["el"])
        if worst > bound:
            problems.append(f"|sun_el| reaches {worst:.2f} deg, above the {bound:.2f} deg limit")
        # The Sun goes once round the sky per synodic month: about 360 / 708.7 h = 0.508 deg/h.
        rates = [((b - a + 180) % 360 - 180) for a, b in zip(track["az"], track["az"][1:])]
        mean_rate = sum(rates) / len(rates)
        if not 0.4 < abs(mean_rate) < 0.62:
            problems.append(f"sun azimuth moves {mean_rate:+.3f} deg/h, expected about 0.51")
    return problems


# ----------------------------------------------------------------------------- CLI

def main(argv=None):
    p = argparse.ArgumentParser(description="One Horizons query + sanity checks")
    p.add_argument("--site", default="site04")
    p.add_argument("--body", default="sun", choices=list(BODIES))
    p.add_argument("--start", default="2027-01-01 00:00")
    p.add_argument("--hours", type=int, default=48)
    a = p.parse_args(argv)

    site = load_sites()[a.site]
    t0 = datetime.strptime(a.start, "%Y-%m-%d %H:%M")
    stop = (t0 + timedelta(hours=a.hours - 1)).strftime("%Y-%m-%d %H:%M")   # inclusive end
    params = build_params(site, a.body, a.start, stop)
    print(f"{a.site} {site['name']}  SITE_COORD={params['SITE_COORD']}")
    text = fetch(params)
    print("\nHorizons says:")
    for ln in header_info(text):
        print("  " + ln)
    tr = parse(text)
    print(f"\n{len(tr['t'])} rows (expected {a.hours}). First and last 3:")
    for k in list(range(3)) + list(range(len(tr["t"]) - 3, len(tr["t"]))):
        print(f"  {tr['t'][k]}  az {tr['az'][k]:8.3f}  el {tr['el'][k]:7.3f}")
    print(f"  el range {min(tr['el']):.3f} .. {max(tr['el']):.3f} deg")
    problems = check_track(tr, site, a.body)
    if len(tr["t"]) != a.hours:
        problems.append(f"got {len(tr['t'])} rows, expected {a.hours}")
    print("\nCHECKS: " + ("all passed" if not problems else "PROBLEMS"))
    for pr in problems:
        print("  - " + pr)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
