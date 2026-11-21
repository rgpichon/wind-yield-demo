# Site data contract (planned JSON)

UTC throughout. Capacity factors dimensionless (0–1+ if observed exceeds nameplate). Wind speeds m s⁻¹. Powers MW. Energies MWh. No invented numbers in HTML — pages fetch JSON under `site/data/`.

Licence notes: ERA5 / C3S CC-BY-4.0 with Copernicus attribution (see site footer). Farm observations from Dryad package DOI [10.5061/dryad.w6m905qzk](https://doi.org/10.5061/dryad.w6m905qzk) (Dryad **CC0-1.0**) derived from BMRS © Elexon — see footer. Do **not** ship FINO or other restricted-licence series in `site/`.

---

## `kpis.json` (implemented)

| Field | Type | Unit / notes |
|-------|------|----------------|
| `data_as_of_utc` | string | ISO-8601 UTC |
| `kpis[]` | array | KPI definitions + values |
| `kpis[].id` | string | Stable id |
| `kpis[].label` | string | UI label |
| `kpis[].unit` | string | Display unit |
| `kpis[].value` | number \| null | Filled from calibration docs/CSVs or null |
| `kpis[].range` | object \| null | Optional `{low, high, note}` |
| `kpis[].citation` | object | `{file, detail}` provenance |

**Repo source:** calibration write-ups + `data/processed/calibration*` (gitignored data; values cited into this JSON for the static site).

---

## Planned (not yet populated)

### `grid_layers/{turbine}/{layer}.json`

- `turbine`: `onshore_reference` \| `offshore_reference`
- `layer`: `raw` \| `calibrated`
- Per cell: `cell_id`, `lat_deg_n`, `lon_deg_e`, `annual_cf`, `mean_hub_speed_m_s` (optional)
- Units: CF dimensionless; speed m s⁻¹; times UTC year label
- Source (planned): ERA5 + `windpower_v0` (+ v2 global output factor when calibrated)
- Licence: ERA5/C3S attribution

### `cell_stats/{cell_id}.json`

- `monthly_cf[12]`, `speed_histogram` `{bin_edges_m_s, counts}`
- Source: same stack; UTC months

### `featured_farm.json`

- Placeholder target: Hornsea One, year 2020
- Fields (planned): `farm`, `year`, `hourly` `{time_utc[], obs_cf[], model_cf_raw[], model_cf_cal[]}`, `capacity_mw`
- Source: Dryad + ERA5 panel used in calibration
- Licence: Dryad/Elexon + ERA5

### `onshore_vs_offshore.json`

- Summary tables for yield per MW, seasonality, duration curve, YoY spread
- Values: **null / absent until produced** — UI shows empty-state
- Onshore / Germany: badge **Indicative**, not validated

### `meta.json` (optional)

- `data_as_of_utc`, list of layer files present
