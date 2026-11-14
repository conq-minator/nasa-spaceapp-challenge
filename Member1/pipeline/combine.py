"""Step 4: apply M2's terrain horizon to M1's Sun/Earth angles
-> data_out/results/<site>.json (team contract, goal.md 5.2 #4).

For every hour k:
    sun_lit[k]   = 1 if sun_el[k]   > horizon_at(mask, sun_az[k])   else 0
    earth_vis[k] = 1 if earth_el[k] > horizon_at(mask, earth_az[k]) else 0
mask = M2's 2 m-mast horizon (mask/<site>.json "elev_deg", 360 bins, linear interpolation,
wrapping at 360). Sun and Earth are treated as points (disc centre), as the contract says.

Extras (readers that don't need them ignore them):
  sun_frac / earth_frac   fraction of the disc above the horizon, 0..1 (2 dp)
  summary_by_mast         the same summary for masts 0, 2, 5, 10 m
  longest_*_start         when the longest night / comm gap begins
  sun_margin_deg / earth_margin_deg   degrees above (+) / below (-) the skyline each hour (2 dp);
                          0.00 means within 0.005 deg of the skyline: use sun_lit/earth_vis as the verdict

Run from Member1/:
  py -m pipeline.combine            # all sites
  py -m pipeline.combine --site site04
"""
import argparse
import json
import math
import sys
from pathlib import Path

from pipeline import horizons_client as hc

DATA = hc.REPO / "data_out"
SUN_RADIUS_DEG = 0.2666      # 696,000 km at 1 AU, seen from the Moon (varies ~±1.7 % over a year)
EARTH_RADIUS_DEG = 0.9496    # 6,371 km at 384,400 km (varies ~±6 % with the Moon's distance)
MASTS = ["0", "2", "5", "10"]


def horizon_at(profile, az_deg, step=1.0):
    """Linear interpolation of the horizon profile at az_deg, wrapping at 360.
    Same function as M2's handoff 5.2 and Member2/src/raycast.js horizonAt()."""
    n = len(profile)
    pos = (az_deg % 360.0) / step
    i0 = int(pos) % n
    i1 = (i0 + 1) % n
    f = pos - int(pos)
    return profile[i0] * (1 - f) + profile[i1] * f


def disc_fraction(el, horizon, radius):
    """Fraction of a disc of angular radius `radius` above a locally flat horizon line."""
    x = (el - horizon) / radius
    if x >= 1:
        return 1.0
    if x <= -1:
        return 0.0
    return 1 - (math.acos(x) - x * math.sqrt(1 - x * x)) / math.pi


def longest_run(flags, value=0):
    """(length, start index) of the longest run of `value`. (0, None) if there is none."""
    best, best_start, cur, cur_start = 0, None, 0, None
    for k, f in enumerate(flags):
        if f == value:
            if cur == 0:
                cur_start = k
            cur += 1
            if cur > best:
                best, best_start = cur, cur_start
        else:
            cur = 0
    return best, best_start


def summarize(t, sun_lit, earth_vis):
    n = len(t)
    night, night_k = longest_run(sun_lit, 0)
    gap, gap_k = longest_run(earth_vis, 0)
    return {
        "total_hours": n,
        "sun_pct": round(100 * sum(sun_lit) / n, 1),
        "earth_pct": round(100 * sum(earth_vis) / n, 1),
        "both_pct": round(100 * sum(s & e for s, e in zip(sun_lit, earth_vis)) / n, 1),
        "longest_night_h": night,
        "longest_night_start": None if night_k is None else t[night_k],
        "longest_comm_gap_h": gap,
        "longest_comm_gap_start": None if gap_k is None else t[gap_k],
    }


def flags(ang, profile):
    sun = [1 if el > horizon_at(profile, az) else 0 for az, el in zip(ang["sun_az"], ang["sun_el"])]
    earth = [1 if el > horizon_at(profile, az) else 0
             for az, el in zip(ang["earth_az"], ang["earth_el"])]
    return sun, earth


def combine_site(ang, mask):
    if len(mask["elev_deg"]) != 360 or mask.get("az_step_deg", 1.0) != 1.0:
        raise ValueError("expected a 360-bin mask at 1 deg steps")
    n = len(ang["t"])
    for k in ("sun_az", "sun_el", "earth_az", "earth_el"):
        if len(ang[k]) != n:
            raise ValueError(f"angles: {k} length {len(ang[k])} != t length {n}")
    if ang["site"] != mask["site"]:
        raise ValueError(f"site mismatch: angles {ang['site']} vs mask {mask['site']}")

    prof = mask["elev_deg"]
    sun_lit, earth_vis = flags(ang, prof)
    sun_frac = [round(disc_fraction(el, horizon_at(prof, az), SUN_RADIUS_DEG), 2)
                for az, el in zip(ang["sun_az"], ang["sun_el"])]
    earth_frac = [round(disc_fraction(el, horizon_at(prof, az), EARTH_RADIUS_DEG), 2)
                  for az, el in zip(ang["earth_az"], ang["earth_el"])]
    # WORKPLAN M1.2: degrees above (+) or below (-) the terrain skyline at the body's azimuth;
    # the same quantity that decides sun_lit / earth_vis (lit when > 0).
    sun_margin = [round(el - horizon_at(prof, az), 2) for az, el in zip(ang["sun_az"], ang["sun_el"])]
    earth_margin = [round(el - horizon_at(prof, az), 2)
                    for az, el in zip(ang["earth_az"], ang["earth_el"])]

    by_mast = {}
    for m in MASTS:
        p = mask.get("elev_deg_by_mast", {}).get(m)
        if p:
            s, e = flags(ang, p)
            by_mast[m] = summarize(ang["t"], s, e)

    return {
        "site": ang["site"],
        "t": ang["t"],
        "sun_lit": sun_lit,
        "earth_vis": earth_vis,
        "summary": summarize(ang["t"], sun_lit, earth_vis),
        "obs_height_m": mask["obs_height_m"],
        "sun_frac": sun_frac,
        "earth_frac": earth_frac,
        "sun_margin_deg": sun_margin,
        "earth_margin_deg": earth_margin,
        "summary_by_mast": by_mast,
        "method": ("point Sun/Earth: lit/visible if disc-centre elevation > terrain horizon at its "
                   "azimuth (M2 mask, linear interpolation). sun_frac/earth_frac: disc fraction above "
                   f"a locally flat horizon, radii {SUN_RADIUS_DEG} / {EARTH_RADIUS_DEG} deg."),
    }


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--site", action="append", help="default: all sites")
    p.add_argument("--data", default=str(DATA))
    a = p.parse_args(argv)
    data = Path(a.data)
    ids = a.site or [s["id"] for s in json.loads((data / "sites.json").read_text())]
    (data / "results").mkdir(parents=True, exist_ok=True)

    print(f"{'site':7s} {'sun%':>6s} {'earth%':>7s} {'both%':>6s} {'night_h':>8s} {'gap_h':>6s}"
          f"   sun% at mast 0/2/5/10 m")
    for sid in ids:
        ang = json.loads((data / "angles" / f"{sid}.json").read_text())
        mask = json.loads((data / "mask" / f"{sid}.json").read_text())
        res = combine_site(ang, mask)
        (data / "results" / f"{sid}.json").write_text(json.dumps(res, separators=(",", ":")))
        s = res["summary"]
        masts = " / ".join(f"{res['summary_by_mast'][m]['sun_pct']:.1f}"
                           for m in MASTS if m in res["summary_by_mast"])
        print(f"{sid:7s} {s['sun_pct']:6.1f} {s['earth_pct']:7.1f} {s['both_pct']:6.1f} "
              f"{s['longest_night_h']:8d} {s['longest_comm_gap_h']:6d}   {masts}")
        print(f"        longest night starts {s['longest_night_start']}, "
              f"longest comm gap starts {s['longest_comm_gap_start']}")
    print(f"\nwrote {len(ids)} files to {data / 'results'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
