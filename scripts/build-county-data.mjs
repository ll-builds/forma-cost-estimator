/**
 * Converts the US Census Bureau cartographic boundary file for counties into
 * public/data/us-counties.json, so the extension can find a project's county in the
 * browser with no API call (and without sending coordinates anywhere).
 *
 * Usage:
 *   npm run build:county-data
 *
 * Source: https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html
 * To refresh, download a newer cb_<year>_us_county_5m.zip into data-sources/census/ and update SOURCE.
 *
 * Output format (compact): coordinates are quantized to 1e-4 degrees (~11 m) and
 * delta-encoded per ring. All rings of a county (outer rings and holes) are tested with
 * the even-odd rule, which handles holes and multi-part counties.
 */
import AdmZip from "adm-zip"
import { mkdirSync, writeFileSync } from "node:fs"
import * as shapefile from "shapefile"

const SOURCE = {
  path: "data-sources/census/cb_2024_us_county_5m.zip",
  name: "cb_2024_us_county_5m",
  doc: "US Census Bureau, 2024 cartographic boundary file, counties, 1:5,000,000",
  url: "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_5m.zip",
}
const OUT = "public/data/us-counties.json"
const Q = 1e4

const zip = new AdmZip(SOURCE.path)
const file = (ext) => {
  const e = zip.getEntry(`${SOURCE.name}.${ext}`)
  if (!e) throw new Error(`${SOURCE.name}.${ext} not found in ${SOURCE.path}`)
  return e.getData()
}

const source = await shapefile.open(file("shp"), file("dbf"), { encoding: "utf-8" })
const counties = []
let vertices = 0
for (let r = await source.read(); !r.done; r = await source.read()) {
  const { properties: p, geometry: g } = r.value
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates
  const rings = []
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const poly of polys)
    for (const ring of poly) {
      const enc = []
      let px = 0
      let py = 0
      for (const [x, y] of ring) {
        const qx = Math.round(x * Q)
        const qy = Math.round(y * Q)
        if (enc.length && qx === px && qy === py) continue
        enc.push(qx - px, qy - py)
        px = qx
        py = qy
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      vertices += enc.length / 2
      rings.push(enc)
    }
  counties.push({
    s: p.STATE_NAME,
    n: p.NAME,
    l: p.NAMELSAD,
    g: p.GEOID,
    b: [minX, minY, maxX, maxY].map((v) => Math.round(v * Q) / Q),
    r: rings,
  })
}
if (!counties.length || !counties[0].s) throw new Error("Unexpected shapefile fields; expected STATE_NAME, NAME, NAMELSAD, GEOID")

mkdirSync("public/data", { recursive: true })
writeFileSync(OUT, JSON.stringify({ source: SOURCE.doc, url: SOURCE.url, quantization: Q, counties }))
console.log(`Wrote ${OUT}: ${counties.length} counties, ${vertices} vertices`)
