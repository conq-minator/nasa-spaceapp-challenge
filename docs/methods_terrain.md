# Terrain: data, method and limits (M2)

Plain-language notes for the methods page and the About panel. Numbers here come from
`data_out/` and `Member2/README.md`; re-check them if the data is rebuilt.

## Data
- **Near terrain:** NASA Goddard PGDA product 78, 5 m/pixel LOLA elevation tiles for the named
  south-pole sites (Barker et al. 2021, *Planetary & Space Science* 203, 105119).
  GeoTIFF, south polar stereographic, MOON_ME frame (DE421), heights in metres above a
  1737.4 km sphere.
- **Far terrain:** LOLA polar gridded product `LDEM_80S_20M` (20 m/pixel, 80–90°S) from the
  LOLA PDS archive. Its values are stored in kilometres; the export converts them and checks
  them against the 5 m tile (median difference about 0 m, spread under 1 m on every site).
- **Site points:** never typed in.
  - Sites 01, 04, 07 and 11: the largest PGDA "region of interest" for that site
    (areas over 2500 m² with more than 70% average illumination, Barker et al. 2021).
  - Site 23 (Malapert massif) has no PGDA ROI file, so the same rule was applied to the
    PGDA product 69 average-illumination map. On the four sites that do have ROIs, this rule
    lands 55–232 m from a PGDA ROI point.

## Method
- From each site point we look in 720 directions (every 0.5°).
- Along each direction we sample the terrain along the curved surface: every 5 m pixel inside
  the near tile, then every 5 m or 0.5% of the distance, whichever is larger, out to 200 km.
- For every sample we compute the exact 3D elevation angle on the 1737.4 km sphere, so the
  Moon's curvature is included. The horizon in that direction is the largest angle found.
- This is done for observer (mast) heights of 0, 2, 5 and 10 m. **Results use 2 m.**

## Checks
- **Ray-cast agreement:** an independent ray-march in the browser (`Member2/src/raycast.js`)
  agrees with the horizon in 99.7–100% of the checkable hours on all five sites. This shows the
  code and conventions are consistent (azimuth direction, axes, row order, curvature). It does
  **not** show the terrain itself is accurate.
- **Skyline plots:** `docs/skylines/` shows each site's horizon with a year of Sun and Earth
  positions. At Shackleton rim, Earth sits at azimuth 149–165°, where the terrain horizon is a
  fraction of a degree, so Earth spends much of each month below it.
- **NASA comparison:** `docs/validation/goddard_terrain.md` compares our Sun and Earth
  percentages with NASA Goddard's published maps (PGDA product 69).

## Limits (show these honestly)
- About 90% of the 5 m pixels are interpolated between laser tracks (Barker et al. 2021).
- The horizon search reaches 200 km, except at Site 23, which reaches only about 181 km in some
  directions (edge of the 20 m map).
- The 0 m horizon is dominated by the neighbouring 5 m pixels; use 2 m for results.
- Visibility flags use the Sun and Earth disc centres; `sun_frac` and `earth_frac` approximate
  disc fractions against a locally flat horizon. Angles are sampled hourly for 2027, so the disc
  fractions do not account for terrain-horizon changes across each body's disc.
- "Earth visible" means a clear geometric line of sight, not a radio link calculation.
- The 3D view's terrain reaches only 30.7 km from the lander. Ridges farther away are in the
  horizon line but not drawn as mountains (grey bands in the skyline plots).
- Terrain is in the DE421 lunar frame; the Sun/Earth angles use DE440 kernels. The difference is
  expected to be small at our scale but has not been measured.
