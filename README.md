# Forma cost estimator

A private Forma Site Design extension that gives a concept-stage building construction estimate:

```
cost = GFA per program (sf) × DoD national $/sf × DoD area cost factor (location) × escalation
```

Read-only. It never modifies the model. It's a fully static site: no backend, no API keys, and no calls to outside services. The project's coordinates never leave the browser.

## Run it locally

```bash
npm install
npm run dev
```

- At http://localhost:5173 directly, the panel uses **mock** Forma data (orange badge), with Denver coordinates.
- Inside Forma it uses **live** data (green badge). Add `?mock` to force mock data.

## Host it (no local server needed)

1. `npm run build`. This writes the static site to `dist/`, about 2.7 MB, most of it the county boundaries.
2. Upload everything in `dist/` to any static host. Asset paths are relative, so a subfolder works too (for example, GitHub Pages at `https://<user>.github.io/<repo>/`). Use a host your organization approves.
3. In Forma's extension settings, change the panel URL from `http://localhost:5173/` to the hosted URL.
4. After code or data changes, rebuild and re-upload.

## How the estimate works

1. **Areas:** `Forma.areaMetrics.calculate({})` gives gross floor area per program in m², converted to sf.
2. **Location:** For US projects, the browser finds the county containing the project's lat/lon using bundled Census county boundaries (`public/data/us-counties.json`). The panel uses that county's DoD area cost factor, or the state median if DoD has no site in the county, and says which it used. Independent cities (for example, Norfolk, VA), renamed areas (Kusilvak, AK, formerly Wade Hampton) and spelling differences (DeKalb/De Kalb) are matched. Connecticut uses the state median, because Census replaced its counties with planning regions. Outside the US, it uses the country median of DoD overseas sites where listed. You can override the factor.
3. **Benchmarks:** Each Forma program gets a suggested DoD facility type based on its name. You can change it, leave it unpriced, or type your own local $/sf.
4. **Escalation:** DoD Tables 4-2/4-3 move prices to the selected construction-midpoint fiscal year.
5. **Site:** Open site area is the Forma site limit minus the building footprint and surface parking area. It's priced as a hardscape/landscape mix (default 30% hardscape) using DoD Table 6 unit costs for grading, concrete walks, topsoil, sod and irrigation.
6. **Surface parking:** Forma parking area and stall count, priced with DoD Table 6 grading, 4" stone base, 3" asphalt and 36 lf of striping per stall. Garages modeled as Forma buildings are priced as a building program.
7. **Optional allowances:** Site utilities allowance (% of building cost), contingency % and design % (DoD uses 5% and 9%). Contingency and design apply to building plus site.
8. **Range:** The total shows a likely value and a range, by default −20% / +30% (the narrow end of an AACE Class 5 concept estimate). You can change it.

Site and parking overrides ($/sf, $/stall) replace the DoD calculation with your own local rate.

Programs without a rate or area are flagged, and the total is labeled **incomplete**.

Mappings and assumptions are saved per project in the browser (`localStorage`).

## Data source

[DoD Facilities Pricing Guide](https://www.wbdg.org/dod/ufc/ufc-3-701-01), marked "Approved for public release; distribution unlimited":

| File (in `data-sources/dod/`) | Used for |
|---|---|
| `ufs_3_701_01_2026_Data_Tables.xlsx` (UFS 3-701-01, 6 June 2026) | Table 2 military construction unit costs (Oct 2025 $), Table 4-1 area cost factors (~15,500 US sites, 2,018 counties; 65 countries), Tables 4-2/4-3 escalation |
| `ufc_3_701_01_2022_c7_Data_Tables.xlsx` (Change 7, 25 July 2025) | Table 3 replacement-value unit costs ($ FY2025). The 2026 edition lists these as "to be published" |

`npm run build:cost-data` converts these into `src/data/dod-cost-data.json`. To refresh, download the new tables from WBDG into `data-sources/dod/`, update the file names in `scripts/build-dod-data.mjs`, and re-run.

County boundaries: [US Census Bureau cartographic boundary file](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html) `cb_2024_us_county_5m.zip` in `data-sources/census/`. `npm run build:county-data` converts it into `public/data/us-counties.json` (coordinates rounded to about 11 m). Projects within a few hundred meters of a county line can occasionally land in the neighboring county. Use the factor override if that matters.

### Limitations

- **Military standards:** DoD costs include military requirements such as antiterrorism features. Table 2 averages run well above typical commercial costs (for example, multi-purpose admin is about $943/sf). Suggestions prefer Table 3 entries, many based on Marshall & Swift commercial valuations. Review every mapping.
- **Planning level only:** DoD says these unit costs are for planning and are not reliable for individual project estimates.
- **Partial site scope:** Site pricing covers grading, paving, walks and landscape only. Utilities, storm drainage, lighting, retaining walls and mass earthwork need the utilities allowance. Special foundations, SIOH, furniture/IT, land and fees are excluded.
- **Gaps:** No DoD rate for some program types. Use an override.

## Load it in Forma

1. In a Forma project, open the extension menu → **Add extension** → settings icon → **Create extension**.
2. Allow your project ID (the `pro_…` part of the project URL).
3. Under Integration, add a floating panel button with your hosted URL, or `http://localhost:5173/` while developing (suggested size 700×700).
4. **Add extension** → find yours → **Add** → **Agree**, then open it from the left menu.

## Code layout

- `src/forma/`: Forma SDK reads (`liveSource.ts`), mock data (`mockSource.ts`), shared types
- `src/cost/dodData.ts`: typed DoD data, escalation
- `src/cost/counties.ts`: in-browser point-in-county lookup
- `src/cost/location.ts`: county → DoD area cost factor
- `src/cost/estimate.ts`: program → benchmark suggestions and the calculation
- `src/cost/site.ts`: site and surface-parking costs
- `src/EstimatePanel.tsx`: estimate UI. `src/App.tsx`: shell plus input diagnostics
- `scripts/build-dod-data.mjs`: DoD xlsx → JSON. `scripts/build-county-data.mjs`: Census shapefile → JSON
