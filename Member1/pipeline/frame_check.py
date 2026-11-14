"""Step 2: do Horizons and SPICE (MOON_ME) agree on Sun and Earth az/el?

Run from Member1/:
  py -m pipeline.get_kernels          # once
  py -m pipeline.frame_check          # all 5 sites, 10 times across 2027, Sun + Earth

Horizons queries are cached, so a re-run is instant. Pass: every |d_az| and |d_el| < 0.1 deg.
"""
import argparse
import sys

from pipeline import horizons_client as hc

TOL_DEG = 0.1


def angle_diff(a, b):
    """a - b for azimuths, wrapped to -180..180."""
    return (a - b + 180.0) % 360.0 - 180.0


def compare(hz, sp):
    """hz, sp: {"az": [...], "el": [...]} at the same times. Returns the worst differences."""
    daz = [angle_diff(a, b) for a, b in zip(hz["az"], sp["az"])]
    del_ = [a - b for a, b in zip(hz["el"], sp["el"])]
    return {"daz": daz, "del": del_,
            "max_daz": max(abs(x) for x in daz), "max_del": max(abs(x) for x in del_),
            "mean_daz": sum(daz) / len(daz)}


def main(argv=None):
    from pipeline import spice_angles
    p = argparse.ArgumentParser()
    p.add_argument("--site", action="append", help="default: all sites")
    a = p.parse_args(argv)
    sites = hc.load_sites()
    ids = a.site or list(sites)

    worst, ok = 0.0, True
    for sid in ids:
        site = sites[sid]
        for body in ("sun", "earth"):
            # 10 times spread over 2027: start + 9 steps of 876 h (36.5 days)
            params = hc.build_params(site, body, "2027-01-01 00:00", "2027-12-31 12:00",
                                     step="876 h")
            hz = hc.parse(hc.fetch(params))
            saz, sel = spice_angles.angles(site, body, hz["t"])
            c = compare(hz, {"az": saz, "el": sel})
            good = c["max_daz"] < TOL_DEG and c["max_del"] < TOL_DEG
            ok &= good
            worst = max(worst, c["max_daz"], c["max_del"])
            print(f"{sid} {body:5s} n={len(hz['t']):2d}  max|d_az| {c['max_daz']:.4f}  "
                  f"max|d_el| {c['max_del']:.4f}  mean d_az {c['mean_daz']:+.4f}  "
                  f"{'OK' if good else 'FAIL'}")
            if not good:
                for k in range(len(hz["t"])):
                    print(f"    {hz['t'][k]}  Horizons az {hz['az'][k]:8.3f} el {hz['el'][k]:7.3f}"
                          f"  SPICE az {saz[k]:8.3f} el {sel[k]:7.3f}")
    print(f"\nRESULT: {'Horizons and SPICE agree' if ok else 'DISAGREE'} "
          f"(worst difference {worst:.4f} deg, tolerance {TOL_DEG})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
