"""Sun / Earth azimuth + elevation from a fixed point on the Moon, computed locally with
NASA's SPICE toolkit (spiceypy) in the MOON_ME frame, which is the frame of the LOLA/PGDA DEMs.

Used to cross-check Horizons (frame_check.py), and as the fallback source of angles.
Needs the kernels from get_kernels.py.
"""
import math
from pathlib import Path

import numpy as np

from pipeline.get_kernels import KDIR, KERNELS

MOON_R_KM = 1737.4
NAIF_ID = {"sun": "10", "earth": "399"}
_loaded = False


def load_kernels(kdir=KDIR):
    global _loaded
    if _loaded:
        return
    import spiceypy as sp
    missing = [n for n in KERNELS if not (Path(kdir) / n).exists()]
    if missing:
        raise FileNotFoundError(f"missing SPICE kernels {missing} in {kdir}. "
                                "Run: py -m pipeline.get_kernels")
    for n in KERNELS:
        sp.furnsh(str(Path(kdir) / n))
    _loaded = True


def observer_pos_km(site):
    """Site position in MOON_ME, km: radius = 1737.4 km + ground + mast."""
    r = MOON_R_KM + (site["ground_height_m"] + site["obs_height_m"]) / 1000.0
    la, lo = math.radians(site["lat"]), math.radians(site["lon"])
    return np.array([r * math.cos(la) * math.cos(lo), r * math.cos(la) * math.sin(lo),
                     r * math.sin(la)])


def angles(site, body, times_iso):
    """times_iso: list of 'YYYY-MM-DDTHH:MM:SSZ' (UTC). Returns (az_deg list, el_deg list).
    Azimuth clockwise from north (azccw=False), elevation positive up (elplsz=True),
    light time + stellar aberration ('LT+S'), like Horizons' apparent airless values."""
    import spiceypy as sp
    load_kernels()
    pos = observer_pos_km(site)
    az, el = [], []
    for t in times_iso:
        et = sp.str2et(t.rstrip("Z"))                  # ISO strings are read as UTC
        azl, _lt = sp.azlcpo("ELLIPSOID", NAIF_ID[body], et, "LT+S", False, True,
                             pos, "MOON", "MOON_ME")
        az.append(math.degrees(azl[1]) % 360.0)
        el.append(math.degrees(azl[2]))
    return az, el
