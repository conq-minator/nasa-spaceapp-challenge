"""Download the NASA/NAIF SPICE kernels LunaWise needs into Member1/kernels/ (git-ignored).

Run from Member1/:
  py -m pipeline.get_kernels

About 35 MB in total; de440s.bsp is most of it. Files already on disk are skipped.
If a file 404s, NAIF has renamed it: open the folder URL printed below in a browser,
download the newest file with the same stem, and put it in Member1/kernels/.
"""
import sys
from pathlib import Path

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = {   # file name -> folders to try, in order
    "naif0012.tls": ["lsk/"],                   # leap seconds (UTC <-> TDB)
    "pck00011.tpc": ["pck/"],                   # body shapes/radii (Moon = 1737.4 km sphere)
    "de440s.bsp": ["spk/planets/"],             # Sun, Earth, Moon positions 1849-2150
    "moon_pa_de440_200625.bpc": ["pck/"],       # Moon orientation (principal axes)
    "moon_de440_220930.tf": ["fk/satellites/", "fk/satellites/a_old_versions/"],
    # ^ defines MOON_ME (mean Earth). NAIF moved it to a_old_versions/ in 2025.
}
KDIR = Path(__file__).resolve().parent.parent / "kernels"


def main():
    import requests
    KDIR.mkdir(exist_ok=True)
    bad = []
    for name, folders in KERNELS.items():
        dest = KDIR / name
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  have {name} ({dest.stat().st_size / 1e6:.1f} MB)")
            continue
        for folder in folders:
            url = NAIF + folder + name
            print(f"  downloading {url}")
            r = requests.get(url, timeout=300, stream=True)
            if r.status_code == 200:
                break
            print(f"    HTTP {r.status_code}")
        if r.status_code != 200:
            print(f"    FAILED. Look in {NAIF + folders[0]}")
            bad.append(name)
            continue
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(dest)
        print(f"    ok ({dest.stat().st_size / 1e6:.1f} MB)")
    print("all kernels present" if not bad else f"MISSING: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
