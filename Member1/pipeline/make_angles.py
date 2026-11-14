"""Step 3: hourly Sun and Earth azimuth/elevation for a full year, every site
-> data_out/angles/<site>.json (team contract, goal.md 5.2 #2).

Source: SPICE (azlcpo, MOON_ME frame, DE440, light time + stellar aberration). The frame check
(frame_check.py) showed it matches JPL Horizons to < 0.0001 deg at all sites.
At the end, each site is spot-checked against the cached Horizons answers (no network).

Run from Member1/:
  py -m pipeline.make_angles                 # all sites, 2027-01-01 00:00 .. 2027-12-31 23:00 UTC
  py -m pipeline.make_angles --site site04
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline import horizons_client as hc

OUT = hc.REPO / "data_out" / "angles"
START = "2027-01-01T00:00:00Z"
HOURS = 8760                       # 2027 is not a leap year
SUN_RATE_DEG_H = 360.0 / (29.530589 * 24)   # one lap per synodic month


def hourly_times(start=START, hours=HOURS):
    t0 = datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return [(t0 + timedelta(hours=k)).strftime("%Y-%m-%dT%H:%M:%SZ") for k in range(hours)]


def check_angles(rec, site):
    """Sanity checks on one site's year. Returns a list of problems (empty = good)."""
    p = []
    n = len(rec["t"])
    for k in ("sun_az", "sun_el", "earth_az", "earth_el"):
        if len(rec[k]) != n:
            p.append(f"{k} has {len(rec[k])} values, t has {n}")
        if any(v != v for v in rec[k]):                      # NaN check
            p.append(f"{k} contains NaN")
    for k in ("sun_az", "earth_az"):
        if any(not 0 <= az < 360 for az in rec[k]):
            p.append(f"{k} contains azimuth outside [0, 360)")
    if len(set(rec["t"])) != n:
        p.append("duplicate timestamps")
    bound = 1.54 + (90 - abs(site["lat"])) + 0.1
    if max(abs(e) for e in rec["sun_el"]) > bound:
        p.append(f"sun elevation exceeds the {bound:.2f} deg geometric limit")
    steps = [(b - a + 180) % 360 - 180 for a, b in zip(rec["sun_az"], rec["sun_az"][1:])]
    rate = abs(sum(steps) / len(steps))
    if abs(rate - SUN_RATE_DEG_H) > 0.02:
        p.append(f"mean sun azimuth rate {rate:.4f} deg/h, expected {SUN_RATE_DEG_H:.4f}")
    if max(rec["earth_el"]) - min(rec["earth_el"]) > 20:
        p.append("earth elevation swings more than 20 deg (libration is only ~±7)")
    return p


def horizons_spot_check(site, rec):
    """Compare with the cached frame_check Horizons answers, if they exist (no network)."""
    idx = {t: k for k, t in enumerate(rec["t"])}
    worst = None
    for body in ("sun", "earth"):
        params = hc.build_params(site, body, "2027-01-01 00:00", "2027-12-31 12:00", step="876 h")
        if not hc.cache_path(params).exists():
            return None
        hz = hc.parse(hc.cache_path(params).read_text())
        for t, az, el in zip(hz["t"], hz["az"], hz["el"]):
            k = idx[t]
            d = max(abs((az - rec[f"{body}_az"][k] + 180) % 360 - 180), abs(el - rec[f"{body}_el"][k]))
            worst = d if worst is None else max(worst, d)
    return worst


def build_site(site, times, angle_fn=None):
    if angle_fn is None:
        from pipeline.spice_angles import angles as angle_fn
    rec = {"site": site["id"], "t": times}
    for body in ("sun", "earth"):
        az, el = angle_fn(site, body, times)
        rec[f"{body}_az"] = [round(v, 3) % 360.0 for v in az]
        rec[f"{body}_el"] = [round(v, 3) for v in el]
    rec["obs_height_m"] = site["obs_height_m"]
    rec["source"] = ("SPICE azlcpo, frame MOON_ME (moon_de440_220930.tf), ephemeris de440s.bsp, "
                     "abcorr LT+S; azimuth clockwise from north, elevation above local horizontal")
    return rec


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--site", action="append", help="default: all sites")
    p.add_argument("--out", default=str(OUT))
    p.add_argument("--sites", default=None,
                   help="sites file (default data_out/sites.json); e.g. data_out/nearby.json for "
                        "M2's computed nearby points")
    a = p.parse_args(argv)
    sites = hc.load_sites(a.sites) if a.sites else hc.load_sites()
    ids = a.site or list(sites)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    times = hourly_times()

    all_ok = True
    for sid in ids:
        site = sites[sid]
        rec = build_site(site, times)
        worst = horizons_spot_check(site, rec)
        rec["horizons_max_diff_deg"] = None if worst is None else round(worst, 4)
        problems = check_angles(rec, site)
        if worst is not None and worst > 0.1:
            problems.append(f"differs from Horizons by {worst:.3f} deg")
        (out / f"{sid}.json").write_text(json.dumps(rec, separators=(",", ":")))
        se, ee = rec["sun_el"], rec["earth_el"]
        print(f"{sid}: {len(times)} h  sun el {min(se):+.2f}..{max(se):+.2f}  "
              f"earth el {min(ee):+.2f}..{max(ee):+.2f}  "
              f"earth above 0 deg {100 * sum(e > 0 for e in ee) / len(ee):.1f}%  "
              f"Horizons diff {'n/a' if worst is None else f'{worst:.4f}'}  "
              f"{'OK' if not problems else 'PROBLEMS'}")
        for pr in problems:
            print("   - " + pr)
        all_ok &= not problems
    print(f"\nwrote {len(ids)} files to {out}" + ("" if all_ok else "  (with problems, see above)"))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
