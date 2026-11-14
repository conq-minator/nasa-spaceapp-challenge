# Member 1: Sun/Earth angles and results

This pipeline downloads the required SPICE kernels, computes hourly Sun and Earth azimuths and
elevations for each candidate site, then combines those angles with Member 2's terrain horizons.

## Setup and run

From the repository root, install the pinned Python dependencies:

```powershell
py -m pip install -r requirements.txt
```

Then run the pipeline from `Member1/`, in this order:

```powershell
py -m pipeline.get_kernels
py -m pipeline.make_angles
py -m pipeline.combine
py -m pytest pipeline/tests -q
```

The kernel download is skipped for files already present in `Member1/kernels/`. The angle and
combine steps accept `--site site04` to process just one site. Tests use synthetic inputs and do
not require downloading kernels.

## Outputs and assumptions

- `data_out/angles/<site>.json`: hourly Sun/Earth angles for 2027, computed with SPICE.
- `data_out/results/<site>.json`: hourly visibility flags and annual summaries using Member 2's
  2 m terrain horizon.
- Visibility flags treat the Sun and Earth as points at their disc centres. `sun_frac` and
  `earth_frac` are approximate disc fractions against a locally flat horizon.
- Angles are sampled hourly for 2027. The flat-horizon disc fractions do not model terrain-horizon
  changes across a body's disc.

The angle calculation requires the SPICE kernels downloaded by `pipeline.get_kernels`; the combine
step requires Member 2's masks in `data_out/mask/`.
