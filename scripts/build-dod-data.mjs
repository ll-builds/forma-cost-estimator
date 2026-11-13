/**
 * Converts the DoD Facilities Pricing Guide data tables (public release, WBDG) into
 * src/data/dod-cost-data.json for the extension.
 *
 * Usage:
 *   npm run build:cost-data
 *
 * To refresh when DoD publishes new tables: download the new xlsx files from
 * https://www.wbdg.org/dod/ufc/ufc-3-701-01 into data-sources/dod/, update the
 * FILES block below, and re-run.
 */
import ExcelJS from "exceljs"
import { mkdirSync, writeFileSync } from "node:fs"

const FILES = {
  /** UFS 3-701-01, 6 June 2026: Table 2 (Oct 2025 $), Table 4-1 ACF, Tables 4-2/4-3 escalation. */
  current: {
    path: "data-sources/dod/ufs_3_701_01_2026_Data_Tables.xlsx",
    doc: "UFS 3-701-01 DoD Facilities Pricing Guide (6 June 2026)",
    url: "https://legacy.wbdg.org/FFC/DOD/UFC/ufs_3_701_01_2026_Data_Tables.xlsx",
  },
  /** UFC 3-701-01 Change 7, 25 July 2025: Table 3 PRV unit costs ($ FY2025). 2026 edition marks these "TBP". */
  prv: {
    path: "data-sources/dod/ufc_3_701_01_2022_c7_Data_Tables.xlsx",
    doc: "UFC 3-701-01 DoD Facilities Pricing Guide, Change 7 (25 July 2025)",
    url: "https://legacy.wbdg.org/FFC/DOD/UFC/ARCHIVES/ufc_3_701_01_2022_c7_Data_Tables.xlsx",
  },
}
const OUT = "src/data/dod-cost-data.json"

const cell = (v) =>
  v && typeof v === "object" ? (v.result ?? v.text ?? v.richText?.map((x) => x.text).join("") ?? "") : (v ?? "")
const rows = (ws) => {
  const out = []
  for (let r = 1; r <= ws.rowCount; r++) out.push(ws.getRow(r).values.slice(1).map(cell))
  return out
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d
const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const clean = (s) => String(s).replace(/\s+/g, " ").trim()
/**
 * County match key. DoD names ("Norfolk (City)", "De Kalb") and Census full names
 * ("Norfolk city", "DeKalb County") both reduce to the same key ("norfolkcity", "dekalb").
 * Independent cities keep "city" so they don't collide with same-named counties.
 * Must match normCounty() in src/cost/dodData.ts.
 */
export const normCounty = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\(city\)/g, " city")
    .replace(/^ind\.?\s*city-/, "")
    .replace(/\bcity and borough\b|\bcensus area\b|\b(county|parish|borough|municipality|municipio)\b/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]/g, "")

/** Census renamed or split these since DoD's names were recorded. Old DoD key → current Census keys. */
const COUNTY_ALIASES = {
  alaska: {
    wadehampton: ["kusilvak"],
    valdezcordova: ["chugach", "copperriver"],
    princeofwalesouterketchikan: ["princeofwaleshyder"],
    wrangellpetersburg: ["wrangell", "petersburg"],
  },
  "south dakota": { shannon: ["oglalalakota"] },
}

async function load(path) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return wb
}

const cur = await load(FILES.current.path)
const prv = await load(FILES.prv.path)
const benchmarks = []

// ---- Table 2: MILCON facility unit costs (GUC), $/SF as of Oct 2025 ----
{
  let section = ""
  for (const [i, v] of rows(cur.getWorksheet("Table 2")).entries()) {
    const title = clean(v[0])
    if (!title) continue
    if (/:\s*$/.test(title) && v.slice(1).every((x) => x === "")) {
      section = title.replace(/:\s*$/, "")
      continue
    }
    const perSm = num(v[2])
    const perSf = num(v[4])
    // Skip rows without a published $/m2 and $/SF pair (insufficient data "**", per-tower rows, duplicates).
    if (perSm === null || perSf === null || String(v[3]) === "VF") continue
    benchmarks.push({
      id: `T2-${i + 1}`,
      table: "Table 2",
      kind: "MILCON guidance unit cost",
      section,
      title,
      usdPerSf: round(perSf),
      priceBasis: "Oct 2025",
      escalation: "milcon",
      referenceSizeSf: num(v[3]),
      stdDevPct: num(v[6]) !== null ? round(num(v[6]) * 100, 0) : null,
      projects: num(v[7]),
      basisNote: `Average of ${num(v[7]) ?? "?"} DoD project awards, normalized to national average (ACF 1.0)`,
      sourceDoc: FILES.current.doc,
    })
  }
}

// ---- Table 3 (2025 edition): PRV unit costs for SF-measured facilities, $ FY2025 ----
{
  for (const v of rows(prv.worksheets.find((w) => /^Table 3/.test(w.name))).slice(4)) {
    const puc = num(v[3])
    if (v[2] !== "SF" || puc === null) continue
    benchmarks.push({
      id: `T3-${v[0]}`,
      table: "Table 3",
      kind: "Plant replacement value unit cost",
      section: `FAC ${v[0]}`,
      title: clean(v[1]),
      usdPerSf: round(puc),
      priceBasis: "FY2025",
      escalation: "prv",
      referenceSizeSf: num(v[5]),
      stdDevPct: null,
      projects: null,
      basisNote: clean(v[6]),
      sourceDoc: FILES.prv.doc,
    })
  }
}

// ---- Table 6: supporting facilities (site) unit costs, Oct 2025 $, national, installed with contractor markups ----
// Only the items used by the site/parking assemblies in src/cost/site.ts.
const SITE_ITEMS = ["93210-2-2", "85110-6-1", "85110-1-3", "85110-9-2", "85220-1-1", "93220-1-3", "93220-3-3", "93220-8-3"]
const siteItems = {}
for (const v of rows(cur.getWorksheet("Table 6"))) {
  const code = clean(v[0])
  if (!SITE_ITEMS.includes(code)) continue
  const usd = num(v[4])
  if (usd === null) throw new Error(`Table 6 item ${code} has no cost`)
  siteItems[code] = { code, description: clean(v[1]), unit: clean(v[3]), usd: round(usd), priceBasis: "Oct 2025" }
}
for (const c of SITE_ITEMS) if (!siteItems[c]) throw new Error(`Table 6 item ${c} not found; check the new tables`)

// ---- Escalation ----
const escalation = { milcon: { base: "Oct 2025", factors: {} }, prv: { base: "FY2025", factors: {} } }
for (const v of rows(cur.getWorksheet("Table 4-2"))) {
  if (num(v[3]) !== null && num(v[6]) !== null) escalation.milcon.factors[v[3]] = num(v[6])
}
{
  const raw = {}
  for (const v of rows(cur.getWorksheet("Table 4-3"))) if (num(v[2]) !== null && num(v[3]) !== null) raw[v[2]] = num(v[3])
  // Rebase so FY2025 = 1.0 (Table 3 costs are FY2025 dollars).
  for (const [y, f] of Object.entries(raw)) if (+y >= 2025) escalation.prv.factors[y] = round(f / raw[2025], 5)
}

// ---- Table 4-1: area cost factors ----
const conus = {}
{
  const byCounty = new Map()
  for (const v of rows(cur.getWorksheet("Table 4-1 CONUS")).slice(1)) {
    const acf = num(v[12])
    const state = clean(v[8])
    if (acf === null || !state) continue
    const key = `${state.toLowerCase()}|${normCounty(v[9])}`
    if (!byCounty.has(key)) byCounty.set(key, { state, county: clean(v[9]), inst: new Map(), cities: new Set() })
    const e = byCounty.get(key)
    e.inst.set(clean(v[3]), acf) // one value per installation so large bases don't dominate
    if (v[10]) e.cities.add(clean(v[10]))
  }
  for (const e of byCounty.values()) {
    // Keyed by lowercase state name (source mixes "District of Columbia" / "District Of Columbia").
    const sk = e.state.toLowerCase()
    conus[sk] ??= { name: e.state, counties: {} }
    const vals = [...e.inst.values()]
    conus[sk].counties[normCounty(e.county)] = {
      name: e.county,
      acf: round(median(vals)),
      min: round(Math.min(...vals)),
      max: round(Math.max(...vals)),
      installations: vals.length,
      cities: [...e.cities].slice(0, 5),
    }
  }
  for (const [sk, aliases] of Object.entries(COUNTY_ALIASES)) {
    const counties = conus[sk]?.counties
    if (!counties) continue
    for (const [oldKey, newKeys] of Object.entries(aliases))
      for (const k of newKeys) if (counties[oldKey] && !counties[k]) counties[k] = { ...counties[oldKey], aliasOf: counties[oldKey].name }
  }
  for (const s of Object.values(conus)) {
    const vals = Object.values(s.counties).filter((c) => !c.aliasOf).map((c) => c.acf)
    Object.assign(s, { median: round(median(vals)), min: Math.min(...vals), max: Math.max(...vals), countyCount: vals.length })
  }
}
const oconus = {}
{
  const byCountry = new Map()
  for (const v of rows(cur.getWorksheet("Table 4-1 OCONUS")).slice(1)) {
    const acf = num(v[12])
    const country = clean(v[8])
    if (acf === null || !country) continue
    if (!byCountry.has(country)) byCountry.set(country, new Map())
    byCountry.get(country).set(clean(v[3]), acf)
  }
  for (const [country, inst] of byCountry) {
    const vals = [...inst.values()]
    oconus[country] = { median: round(median(vals)), min: round(Math.min(...vals)), max: round(Math.max(...vals)), installations: vals.length }
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  source: {
    publisher: "US Department of Defense, Tri-Service Committee on Cost Engineering (via WBDG)",
    distribution: "Approved for public release; distribution unlimited",
    landingPage: "https://www.wbdg.org/dod/ufc/ufc-3-701-01",
    files: Object.values(FILES).map(({ doc, url }) => ({ doc, url })),
    caveat:
      "DoD unit costs reflect military construction standards (for example, minimum antiterrorism features) and are intended for planning-level estimates, not individual project estimates.",
    includes: [
      "Building to the 5-foot line (standard foundations, envelope, interiors, MEP, built-in equipment)",
      "Sales tax on building materials",
      "Site: fine grading, surface parking paving and striping, concrete walks, topsoil, sod and irrigation (DoD Table 6 unit costs)",
    ],
    excludes: [
      "Site utilities beyond 5 ft, storm drainage, site lighting, retaining walls and mass earthwork (add with the utilities allowance)",
      "Special foundations",
      "Construction contingency (DoD uses 5%)",
      "Design (DoD uses 9%; 13% medical)",
      "Supervision, inspection and overhead (SIOH)",
      "Furniture, IT and equipment from other funds",
      "Land, financing, permits and fees",
    ],
  },
  benchmarks,
  siteItems,
  escalation,
  acf: { conus, oconus },
}
mkdirSync("src/data", { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log(
  `Wrote ${OUT}: ${benchmarks.length} benchmarks (${benchmarks.filter((b) => b.table === "Table 2").length} Table 2), ` +
    `${Object.keys(conus).length} states / ${Object.values(conus).reduce((s, x) => s + x.countyCount, 0)} counties, ` +
    `${Object.keys(oconus).length} countries; escalation years milcon=${Object.keys(escalation.milcon.factors)} prv=${Object.keys(escalation.prv.factors)}`,
)
