"""WORKPLAN M2.5 - download every raw NASA file the terrain pipeline needs into data_raw/.

Run from the repo root (standard library only, no extra packages):
    py Member2/pipeline/fetch_data.py --list        # what would be fetched, sizes, what is already here
    py Member2/pipeline/fetch_data.py               # everything (about 4.0 GB, mostly the 20 m DEM)
    py Member2/pipeline/fetch_data.py --only near roi illum   # skip the 3.7 GB far-field DEM

- Skips files already present with the right size; resumes partial downloads (.part files).
- Rejects HTML pages: PGDA answers missing files with an HTML "Not Found" page and HTTP 200,
  so every download is checked by size (from the server) and by its first bytes (TIFF / gzip / raw).
- Unpacks the ROI archives into data_raw/roi/SiteXX/ (the .gmt symlink inside is skipped).
"""
import argparse
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data_raw"
PGDA = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp"
PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img"
ILLUM = "https://pgda.gsfc.nasa.gov/data/MoonIllumination"
UA = {"User-Agent": "lunawise-fetch/1.0"}

TIFF = (b"II*\x00", b"II+\x00", b"MM\x00*", b"MM\x00+")
GZIP = (b"\x1f\x8b",)

FILES = []      # (group, relative path in data_raw, url, allowed magic or None for raw binary/text)
for s in ("Site01", "Site04", "Site07", "Site11", "Site23"):
    FILES.append(("near", f"dem/near/{s}_final_adj_5mpp_surf.tif", f"{PGDA}/{s}/{s}_final_adj_5mpp_surf.tif", TIFF))
for s in ("Site01", "Site04", "Site07", "Site11"):            # Site23 has no ROI file on PGDA
    FILES.append(("roi", f"roi/{s}_ROIs.tgz", f"{PGDA}/{s}/{s}_ROIs.tgz", GZIP))
FILES.append(("far", "dem/far/LDEM_80S_20M_FLOAT.LBL", f"{PDS}/LDEM_80S_20M_FLOAT.LBL", (b"PDS_VERSION",)))
FILES.append(("far", "dem/far/LDEM_80S_20M_FLOAT.IMG", f"{PDS}/LDEM_80S_20M_FLOAT.IMG", None))
FILES.append(("illum", "illum/AVGVISIB_85S_060M_201608.TIF", f"{ILLUM}/AVGVISIB_85S_060M_201608.TIF", TIFF))
FILES.append(("illum", "illum/AVGVISIB_85S_060M_201608_EARTH.TIF", f"{ILLUM}/AVGVISIB_85S_060M_201608_EARTH.TIF", TIFF))


def remote_size(url):
    req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        if "html" in (r.headers.get("Content-Type") or "").lower():
            raise RuntimeError(f"server returned an HTML page (file missing?): {url}")
        cr = r.headers.get("Content-Range")                     # "bytes 0-0/12345"
        return int(cr.split("/")[-1]) if cr else int(r.headers.get("Content-Length", 0))


def check_magic(path, magic):
    if magic is None:
        head = path.read_bytes()[:64] if path.stat().st_size < 64 else path.open("rb").read(64)
        if head.lstrip().lower().startswith((b"<!doctype", b"<html")):
            raise RuntimeError(f"{path.name} is an HTML page, not data")
        return
    head = path.open("rb").read(16)
    if not head.startswith(magic):
        raise RuntimeError(f"{path.name}: unexpected file start {head[:8]!r} (HTML error page?)")


def download(url, dest, size):
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(url, headers={**UA, **({"Range": f"bytes={have}-"} if have else {})})
    with urllib.request.urlopen(req, timeout=120) as r, open(part, "ab" if have else "wb") as f:
        if have and r.status != 206:                            # server ignored the range: restart
            f.seek(0); f.truncate(); have = 0
        done = have
        while chunk := r.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            if size > 50e6 and done % (200 << 20) < (1 << 20):
                print(f"    {done / 1e9:.2f} / {size / 1e9:.2f} GB", flush=True)
    if part.stat().st_size != size:
        raise RuntimeError(f"{dest.name}: got {part.stat().st_size} bytes, expected {size}")
    part.replace(dest)


def unpack_roi(tgz):
    out = tgz.parent / tgz.name.split("_")[0]
    out.mkdir(exist_ok=True)
    with tarfile.open(tgz) as t:
        members = [m for m in t.getmembers() if m.isfile() and "/" not in m.name and ".." not in m.name]
        t.extractall(out, members=members)
    return out, [m.name for m in members]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="show files, sizes and status; download nothing")
    ap.add_argument("--only", nargs="+", choices=["near", "roi", "far", "illum"], help="groups to fetch")
    ap.add_argument("--dest", default=str(RAW), help="data_raw folder (default: <repo>/data_raw)")
    a = ap.parse_args(argv)
    raw = Path(a.dest)
    todo = [f for f in FILES if not a.only or f[0] in a.only]

    total, bad = 0, []
    for group, rel, url, magic in todo:
        dest = raw / rel
        try:
            size = remote_size(url)
        except Exception as e:                                   # noqa: BLE001 - report and continue
            bad.append(f"{rel}: {e}")
            print(f"  [{group:5s}] {rel}  ERROR {e}")
            continue
        total += size
        present = dest.exists() and dest.stat().st_size == size
        print(f"  [{group:5s}] {rel}  {size / 1e6:9.1f} MB  {'present' if present else 'missing'}")
        if a.list or present:
            if present and group == "roi" and not a.list:
                unpack_roi(dest)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            download(url, dest, size)
            check_magic(dest, magic)
            if group == "roi":
                out, names = unpack_roi(dest)
                print(f"    unpacked {len(names)} files to {out}")
            print("    ok")
        except Exception as e:                                   # noqa: BLE001
            bad.append(f"{rel}: {e}")
            print(f"    FAILED: {e}")
    print(f"\n{len(todo)} files, {total / 1e9:.2f} GB in total" + (f"; {len(bad)} problem(s):" if bad else "; all OK"))
    for b in bad:
        print("  - " + b)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
