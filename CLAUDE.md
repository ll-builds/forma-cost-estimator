# Project instructions: Forma cost estimator

General Forma extension knowledge (SDK facts, registering, hosting, Windows pitfalls, UI defaults):
@../shared/forma-extensions-guide.md

The rest of this file is specific to this project. These are settled decisions. Apply them; don't re-derive or re-debate them unless the user asks.

## This project

- **What it is:** A static extension (TypeScript, React, Vite) that estimates concept-stage construction cost from Forma floor areas, DoD unit costs and county location factors.
- **Where it lives:** https://ll-builds.github.io/forma-cost-estimator/ (repo `ll-builds/forma-cost-estimator`, **public**).
- **Deploys:** Pushing to `main` runs `.github/workflows/deploy.yml`, which publishes to GitHub Pages. Ask before pushing anything new.
- **Commits:** This repo's `user.email` is set to the GitHub noreply address. Keep it that way.
- **Forma APIs used:**
  - Location and project metadata.
  - Presentation units.
  - `udm.getRootUrn`.
  - `areaMetrics.calculate({})`: GFA by function, siteArea, buildingCoverage, parkingStatistics.
  - `udm.subscribe`.

## Architecture rules

- **Fully static:** No backend, no API keys, no runtime calls to outside services. Project coordinates never leave the browser. Don't add a runtime API without asking.
- **County lookup:** Runs in the browser from `public/data/us-counties.json`. It's built from Census `cb_2024_us_county_5m.zip` by `npm run build:county-data` (coordinates quantized to 1e-4°, delta-encoded, even-odd point-in-polygon). It matched the Census API on 30/30 test points.
- **Cost data:** Comes only from the DoD Facilities Pricing Guide (approved for public release). `npm run build:cost-data` turns `data-sources/dod/*.xlsx` into `src/data/dod-cost-data.json`.
- **County name matching:** `normCounty()` exists in both `scripts/build-dod-data.mjs` and `src/cost/dodData.ts` and must stay identical.
  - Independent cities keep "city" (`norfolkcity`).
  - Spaces and accents are stripped (`dekalb`, `donaana`).
  - Renamed areas use `COUNTY_ALIASES` (Wade Hampton → Kusilvak, and others).
  - If DoD lists an independent city without "(City)", fall back to the base name.
  - Connecticut uses the state median, because Census planning regions don't match DoD's counties.
- **Vite:** The dev server ignores `data-sources/`.

## Estimating decisions

- **Formula:** Program GFA (sf) × DoD national $/sf × area cost factor × escalation. Overrides are local $/sf used as-is, with no factor or escalation.
- **Benchmarks:**
  - Suggestions prefer Table 3 (FY2025 replacement-value costs, often Marshall & Swift commercial valuations) over Table 2 (military construction averages, about 2× commercial).
  - Table 3's 2026 edition says "TBP", so it comes from the 2025 Change 7 tables.
  - Unknown programs stay unpriced.
- **Escalation:** Table 2 and Table 6 (site) use Table 4-2. Table 3 uses Table 4-3, rebased to FY2025 = 1.0. The default midpoint is the current federal fiscal year (starts 1 October).
- **Site:** Open site = site limit − footprint − surface parking area. It's priced as a hardscape/landscape mix, 30% hardscape by default. No site limit means "Not priced".
- **Parking:** Surface parking = paving assembly (grading + 4" stone + 3" asphalt) × area + 36 lf of striping per stall. Garages modeled as Forma buildings are priced as building programs.
- **Range:** Default −20% / +30% (narrow end of AACE Class 5).
- **Allowances:** Utilities allowance (% of building), contingency and design are 0 by default. DoD planning uses 5% and 9%.
- **State:** Mappings and settings are saved per project in `localStorage`.

## UI (beyond the shared defaults)

- **Groups:** Building, Site and Allowances (only when set).
- **Sections:** Location, Assumptions, Programs, Site and parking, and the data source sit under "Show calculations and adjust". Input diagnostics sit in their own collapsed section.
