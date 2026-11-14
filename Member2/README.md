# Member 2: Terrain (horizon masks, heightmaps, ray-cast check)

Writes the terrain files in `data_out/` that M1 (combine) and M4 (lander view) read, following
the contract in `goal.md` section 5.2. Raw NASA rasters stay out of git (`data_raw/` is ignored).

## Run

From `Member2/`:

```powershell
py -m pip install -r ..\requirements.txt
py -m pytest pipeline/tests -q          # 18 tests, synthetic DEMs (no downloads needed)
py pipeline\fetch_data.py --list        # raw NASA data: what is needed, sizes, what is present
py pipeline\fetch_data.py               # download it into ..\data_raw\ (about 4 GB; --only near roi illum skips the 3.7 GB DEM)
py -m pipeline.export --all             # all 5 sites, about 1 minute; needs data_raw/ (below)
npm test                                # ray-cast checks, incl. agreement on the real data_out/
```

`--data-raw <folder>` points at a `data_raw/` somewhere else. `--site site04` runs one site.
`--nearby 1000` computes the nearby points (see below).

Goddard comparison (from the repo root): `py Member2/pipeline/goddard_compare.py` for the sites and
`py Member2/pipeline/goddard_compare.py --sites nearby.json --name goddard_nearby` for the nearby
points. Outputs go to `docs/validation/`; maps are read over HTTP (a few pixels), or `--local data_raw/illum`.

## Outputs (`data_out/`)

| File | Contract | Notes |
|---|---|---|
| `sites.json` | #1 | lat/lon/ground height read from the DEM at the chosen site point |
| `mask/<id>.json` | #3 | `elev_deg`: 360 bins, 2 m mast, az 0..359 clockwise from north. Extra fields: `elev_deg_by_mast` (0/2/5/10 m), `elev_deg_720_by_mast` (0.5 deg), `horizon_dist_km_by_mast` (how far away the blocking terrain is), `search_km`, `dem.far_minus_near` |
| `heightmap/<id>.json`, `<id>_near.bin`, `<id>_far.bin` | #5 | near 512x512 at 10 m (5.12 km), far 512x512 at 120 m (61.44 km). Float32 LE, row 0 = southernmost, x = east, y = north, heights relative to the lander ground with curvature d^2/2R already subtracted, sampled at cell centres |

`mask` is computed to **200 km** (the far heightmap is only for the 3D view and the ray-cast check).

## Method
- Horizon: for each azimuth, geodesic samples from the site (every 5 m pixel across the near tile,
  then max(5 m, 0.5 % of distance)) to 200 km; exact 3D elevation angle on the R = 1737.4 km sphere;
  mask = maximum. Near = PGDA 78 5 m tile, beyond it LOLA LDEM_80S_20M.
- Far DEM sanity check: far minus near over each 5 m tile, median within 0.06 m (MAD < 1 m) on all sites.
  The export stops if this is over 50 m (catches km/m or offset mistakes).
- Site points (never typed in):
  - Site01/04/07/11: the largest PGDA ROI in `SiteXX_ROIs.shp`. These are regions > 2500 m2 with
    > 70 % average illumination, Barker et al. 2021.
  - Site23: PGDA has no ROI file, so the same rule is applied to the PGDA 69 average-illumination
    map (`pipeline/site_from_illum.py`). On the four sites that have ROIs, that rule lands
    55-232 m from a PGDA ROI point.
- Ray-cast check (`src/raycast.js`): marches a straight ray through the near and far grids. It agrees
  with the mask in 99.7-100 % of checkable samples on all 5 sites. Samples blocked beyond the
  30.7 km grid can't be checked and are counted separately. This shows the conventions match
  (azimuth, axes, row order, curvature), not that the terrain is accurate.

## Limits
- Site23's search reaches only 181 km in some directions (edge of LDEM_80S_20M).
- The 0 m mask is dominated by the neighbouring 5 m pixels; use 2 m for results.
- DEM interpolation: PGDA 5 m tiles are ~90 % interpolated pixels (Barker et al. 2021).

## Raw data (`data_raw/`, not committed)
| Path | Source |
|---|---|
| `dem/near/SiteXX_final_adj_5mpp_surf.tif` (01, 04, 07, 11, 23) | https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/SiteXX/ |
| `roi/SiteXX/SiteXX_ROIs.shp` (01, 04, 07, 11) | same folder, `SiteXX_ROIs.tgz` (Site23 has none) |
| `dem/far/LDEM_80S_20M_FLOAT.IMG` + `.LBL` (3.7 GB) | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img/ |
| `illum/AVGVISIB_85S_060M_201608.TIF` (34 MB) | https://pgda.gsfc.nasa.gov/data/MoonIllumination/ |

The far IMG is opened through its `.LBL`. Values are **km** above 1737.4 km; GDAL reports OFFSET = 1737.4,
which must not be added (handled in `pipeline/export.py`).

## Nearby points ("custom coordinates", WORKPLAN M2.7)

The challenge asks for custom coordinates and for showing why small moves matter. A live horizon
needs the 3.7 GB DEM, which a static site can't do, so we **precompute real alternatives**: 4 points
1 km north/east/south/west of each site (20 points), with the same pipeline as the sites
(5 m + 20 m DEM to 200 km, SPICE angles, M1's `combine.py`). `README.md` rule 4: only these
computed points may be offered. Never show numbers for a spot that wasn't computed.

**Files (separate from `sites.json`, so the site picker is unchanged):**

| File | Contents |
|---|---|
| `data_out/nearby.json` | list like `sites.json` plus `parent`, `offset_bearing_deg`, `offset_dist_m`, `lander_offset_m` `[east, north]` in metres from the parent lander, `heightmap_of` (= parent id) |
| `data_out/mask/<id>.json` | real horizon for the point (same format as the sites, plus `parent`) |
| `data_out/angles/<id>.json`, `data_out/results/<id>.json` | M1's SPICE angles and hourly flags for the point |

Ids look like `site04_w1km`. There are **no heightmaps per point**. Each point lies inside the parent's
5.12 km near grid, so the 3D view loads the parent heightmap and puts the lander at
`lander_offset_m` (`test_nearby.py` checks that this offset lands on the right terrain).

**What 1 km does** (2027, 2 m mast, sun % / Earth %):

| Site | at the site | 1 km N | 1 km E | 1 km S | 1 km W |
|---|---|---|---|---|---|
| site01 | 86.1 / 51.1 | 58.8 / 26.8 | 44.7 / 51.0 | 34.9 / 50.8 | 34.9 / 0.0 |
| site04 | 80.2 / 43.4 | 32.6 / 35.5 | 30.4 / 32.5 | 44.5 / 21.6 | 28.6 / 3.2 |
| site07 | 82.6 / 50.5 | 53.0 / 29.9 | 52.8 / 23.1 | 29.2 / 48.1 | 45.1 / 55.6 |
| site11 | 83.0 / 54.9 | 9.4 / 0.0 | 43.8 / 54.6 | 74.3 / 55.0 | 45.7 / 0.0 |
| site23 | 74.9 / 61.3 | 44.3 / 100.0 | 43.8 / 67.8 | 36.6 / 23.5 | 57.5 / 58.5 |

**Independent check:** NASA Goddard's PGDA 69 Sun map, sampled at the same 20 points, shows the same
drop-offs (e.g. site11 1 km N: Goddard 3.7%, ours 6.9% at 0 m / 9.4% at 2 m). Correlation with
our 0 m values is r = 0.78, with a median difference of 5.4 points. The site points were chosen as
PGDA's best-lit regions, so most nearby points are worse; that is the expected "small move, big
change" result, not an error.

**Rebuild** (from the repo root; needs `data_raw/` and M1's SPICE kernels):
```
cd Member2; py -m pipeline.export --all --nearby 1000                 # masks + data_out/nearby.json (~80 s)
cd ../Member1; py -m pipeline.make_angles --sites ../data_out/nearby.json   # SPICE angles (~10 s)
py -m pipeline.combine --site site01_n1km --site site01_e1km ...       # every id in nearby.json
```

**For M4 (2D map / "custom expedition") and M3:**
1. Load `nearby.json` together with `sites.json`.
2. When the user clicks on the map, find the nearest computed point (a site or a nearby point).
   - **Within 600 m:** snap to it and show its real `angles/`, `results/` and `mask/`.
   - **Farther:** show "not computed here: nearest computed point is X km away" and **no** Sun/Earth
     numbers. This replaces `computeCustomEphemeris()`: that formula is off from SPICE by a median
     91° in Sun azimuth and 4.8° in Earth elevation at site04.
3. 3D view for a nearby point: load `heightmap/<heightmap_of>.json` and move the lander to
   `lander_offset_m` (x = east, z = −north in the Three.js scene).
   - The mask line and the Sun/Earth come from the nearby point's own files.
   - The in-browser ray-cast check assumes the lander is at the grid centre, so show it as "n/a
     (offset point)" for nearby points, or offset the ray origin by `lander_offset_m`.
