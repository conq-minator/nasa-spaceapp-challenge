"""Terrain horizon mask (spec 4.2). OWNER: M2.

horizon_deg[mast][i] = max elevation angle (deg) of the terrain seen from the site at
azimuth i * 360/n_az (clockwise from north), with the observer `mast` metres above
the DEM surface. Exact 3D geometry on a sphere of radius R (lunar curvature included).

Pieces:
  DEMSampler(path)        bilinear height (m above R) at lat/lon, NaN outside/nodata.
                          CRS, radius, scale/offset, nodata all read from the file.
  LayeredSampler([a, b])  first non-NaN of several samplers (5 m near tile, then 20 m far DEM).
  compute_horizons(...)   all mast heights at once (terrain is sampled once).
"""
import numpy as np

MOON_R_M = 1737400.0  # default only; real runs pass the radius read from the DEM CRS


def unit(lat_deg, lon_deg):
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)


def destination(lat0, lon0, az_deg, dist_m, R=MOON_R_M):
    """Point reached by travelling dist_m from (lat0, lon0) on bearing az (clockwise from north)."""
    d = np.asarray(dist_m) / R
    la0, lo0, az = np.radians(lat0), np.radians(lon0), np.radians(az_deg)
    la = np.arcsin(np.sin(la0) * np.cos(d) + np.cos(la0) * np.sin(d) * np.cos(az))
    lo = lo0 + np.arctan2(np.sin(az) * np.sin(d) * np.cos(la0), np.cos(d) - np.sin(la0) * np.sin(la))
    return np.degrees(la), (np.degrees(lo) + 180) % 360 - 180


def elevation_angle(lat0, lon0, h_site, mast, lat_s, lon_s, h_s, R=MOON_R_M):
    """Elevation angle (deg) of sample points seen from the observer, curvature included."""
    up = unit(lat0, lon0)
    p0 = (R + h_site + mast) * up
    p = (R + np.asarray(h_s))[..., None] * unit(lat_s, lon_s)
    d = p - p0
    return np.degrees(np.arcsin((d @ up) / np.linalg.norm(d, axis=-1)))


def elevation_angle_arc(dist_m, h_s, h_obs_abs, R=MOON_R_M):
    """Same geometry as elevation_angle, written in (ground arc distance, height) form.

    Observer at radius R + h_obs_abs, sample at radius R + h_s, separated by arc dist_m.
    Cheaper (no 3-vectors) and exactly equivalent on a sphere.
    """
    th = np.asarray(dist_m) / R
    rs = R + np.asarray(h_s)
    up = rs * np.cos(th) - (R + h_obs_abs)
    horiz = rs * np.sin(th)
    return np.degrees(np.arctan2(up, horiz))


def sample_distances(pixel_m, max_m=200_000.0, dense_m=0.0):
    """Step = pixel size out to dense_m (every near-field pixel is visited), then
    max(pixel, ~0.5 % of distance) out to max_m."""
    out, d = [], pixel_m
    while d < max_m:
        out.append(d)
        d += pixel_m if d < dense_m else max(pixel_m, 0.005 * d)
    return np.array(out)


# ----------------------------------------------------------------------------- DEMs

class DEMSampler:
    """Bilinear sampler over a single-band projected GeoTIFF/IMG, loaded into memory."""

    def __init__(self, path, label=None, z_scale=1.0, window_xy=None, window_m=None,
                 apply_offset=True):
        """z_scale: extra multiplier after the file's own scale/offset (1000 for PDS LDEM
        float IMGs, which store km). window_xy/window_m: read only the square of half-size
        window_m (projected metres) around window_xy, so a 3.7 GB polar DEM fits in RAM."""
        import rasterio
        from pyproj import CRS, Transformer
        from rasterio.windows import from_bounds

        self.path = str(path)
        self.label = label or self.path
        with rasterio.open(path) as src:
            t = src.transform
            if abs(t.b) > 1e-12 or abs(t.d) > 1e-12:
                raise ValueError(f"{path}: rotated rasters not supported")
            win = None
            if window_xy is not None:
                x0, y0 = window_xy
                win = from_bounds(x0 - window_m, y0 - window_m, x0 + window_m, y0 + window_m, t)
                win = win.round_offsets().round_lengths().intersection(
                    rasterio.windows.Window(0, 0, src.width, src.height))
                t = src.window_transform(win)
            a = src.read(1, window=win, masked=True)
            off = np.float32(src.offsets[0] if apply_offset else 0.0)
            self.z = (a.astype("float32").filled(np.nan) * np.float32(src.scales[0])
                      + off) * np.float32(z_scale)
            self.crs = CRS.from_user_input(src.crs)
            self.t = t
            self.res_m = float(abs(t.a))
            h, w = self.z.shape
            self.bounds = rasterio.coords.BoundingBox(t.c, t.f + h * t.e, t.c + w * t.a, t.f)
        self.R = float(self.crs.ellipsoid.semi_major_metre)
        self._to_xy = Transformer.from_crs(self.crs.geodetic_crs, self.crs, always_xy=True)
        self._to_geo = Transformer.from_crs(self.crs, self.crs.geodetic_crs, always_xy=True)

    def xy(self, lat, lon):
        return self._to_xy.transform(np.asarray(lon, float), np.asarray(lat, float))

    def latlon(self, x, y):
        lon, lat = self._to_geo.transform(x, y)
        return lat, lon

    def sample_xy(self, x, y):
        t = self.t
        c = (np.asarray(x) - t.c) / t.a - 0.5   # pixel centres at +0.5
        r = (np.asarray(y) - t.f) / t.e - 0.5
        c0, r0 = np.floor(c).astype(np.int64), np.floor(r).astype(np.int64)
        fc, fr = c - c0, r - r0
        H, W = self.z.shape
        ok = (c0 >= 0) & (r0 >= 0) & (c0 + 1 < W) & (r0 + 1 < H)
        c0c, r0c = np.clip(c0, 0, W - 2), np.clip(r0, 0, H - 2)
        z = self.z
        z00, z01 = z[r0c, c0c].astype(float), z[r0c, c0c + 1].astype(float)
        z10, z11 = z[r0c + 1, c0c].astype(float), z[r0c + 1, c0c + 1].astype(float)
        top = z00 * (1 - fc) + z01 * fc
        bot = z10 * (1 - fc) + z11 * fc
        out = top * (1 - fr) + bot * fr
        return np.where(ok, out, np.nan)

    def __call__(self, lat, lon):
        x, y = self.xy(lat, lon)
        return self.sample_xy(x, y)

    def reach_m(self, lat0, lon0):
        """Distance from the site to the farthest tile corner (upper bound of coverage)."""
        x0, y0 = self.xy(lat0, lon0)
        b = self.bounds
        return float(max(np.hypot(cx - x0, cy - y0)
                         for cx in (b.left, b.right) for cy in (b.bottom, b.top)))


class LayeredSampler:
    """First non-NaN height from a list of samplers (finest first)."""

    def __init__(self, samplers):
        self.samplers = list(samplers)

    def __call__(self, lat, lon):
        out = None
        for s in self.samplers:
            h = s(lat, lon)
            out = h if out is None else np.where(np.isnan(out), h, out)
        return out


# ----------------------------------------------------------------------------- horizon

def compute_horizons(lat0, lon0, h_site, masts, dem_sampler, pixel_m=5.0,
                     max_m=200_000.0, dense_m=0.0, n_az=720, R=MOON_R_M):
    """Horizon profile for every mast height. Returns dict with:
       horizon_deg {mast: [n_az]}, horizon_dist_m {mast: [n_az]} (distance of the
       blocking point), valid_reach_m [n_az] (farthest DEM sample that had data)."""
    dists = sample_distances(pixel_m, max_m, dense_m)
    az = np.arange(n_az) * 360.0 / n_az
    la, lo = destination(lat0, lon0, az[:, None], dists[None, :], R)
    h = dem_sampler(la, lo)                                   # (n_az, n_d)
    valid = ~np.isnan(h)
    if not valid[:, 0].all():
        raise ValueError("DEM has no data right next to the site")
    reach = np.where(valid, dists[None, :], 0.0).max(axis=1)

    hz, hd = {}, {}
    for m in masts:
        e = elevation_angle_arc(dists[None, :], h, h_site + m, R)
        e = np.where(valid, e, -np.inf)
        k = np.argmax(e, axis=1)
        hz[m] = e[np.arange(n_az), k]
        hd[m] = dists[k]
    return {"horizon_deg": hz, "horizon_dist_m": hd, "valid_reach_m": reach,
            "n_samples_per_az": int(dists.size)}


def compute_horizon(lat0, lon0, h_site, mast, dem_sampler, pixel_m=5.0,
                    max_m=200_000.0, n_az=720, R=MOON_R_M):
    """Single-mast convenience wrapper (kept for older callers)."""
    return compute_horizons(lat0, lon0, h_site, [mast], dem_sampler, pixel_m,
                            max_m, 0.0, n_az, R)["horizon_deg"][mast]


# ----------------------------------------------------------------------------- heightmap

def local_heightmap(lat0, lon0, h_site, dem_sampler, half_m, spacing_m, R=MOON_R_M):
    """Grid of terrain heights on local east/north offsets (great-circle arc distance and
    bearing from the site, the same convention as the horizon). Row 0 = north edge,
    column 0 = west edge. Values are metres relative to the site surface (NaN = no data)."""
    n = int(round(2 * half_m / spacing_m)) + 1
    off = -half_m + np.arange(n) * spacing_m
    E, N = np.meshgrid(off, off[::-1])
    d = np.hypot(E, N)
    az = np.degrees(np.arctan2(E, N))
    la, lo = destination(lat0, lon0, az, d, R)
    return (dem_sampler(la, lo) - h_site).astype("float32"), off


def team_grid(lat0, lon0, h_site, dem_sampler, n, cell_m, R=MOON_R_M):
    """Heightmap in the team contract (goal.md 5.2 #5, read by Member4 raycast/TerrainMesh):
    n x n cells of cell_m, lander at grid centre, x = east, y = north, ROW 0 = SOUTHERNMOST,
    value of cell (r, c) sampled at its centre ((c+0.5)*cell - size/2, (r+0.5)*cell - size/2).
    Heights are metres relative to the lander ground with spherical curvature PRE-SUBTRACTED
    (h - h_site - d^2 / 2R), so a straight ray mast + d*tan(el) can be tested directly.
    NaN where no DEM covers the cell."""
    size = n * cell_m
    off = (np.arange(n) + 0.5) * cell_m - size / 2
    E, N = np.meshgrid(off, off)                    # row index grows northward
    d = np.hypot(E, N)
    la, lo = destination(lat0, lon0, np.degrees(np.arctan2(E, N)), d, R)
    return (dem_sampler(la, lo) - h_site - d * d / (2 * R)).astype("float32")
