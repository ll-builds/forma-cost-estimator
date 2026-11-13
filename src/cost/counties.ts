/**
 * Finds the US county containing a point, entirely in the browser, using the Census
 * county boundaries in public/data/us-counties.json (built by scripts/build-county-data.mjs).
 * No API call is made and the project's coordinates never leave the browser.
 */

type CountyRecord = {
  /** State name, e.g. "Colorado". */
  s: string
  /** County base name, e.g. "Denver". */
  n: string
  /** Full name, e.g. "Denver County", "Orleans Parish". */
  l: string
  /** 5-digit FIPS code. */
  g: string
  /** Bounding box [minLon, minLat, maxLon, maxLat]. */
  b: [number, number, number, number]
  /** Rings, each a delta-encoded list of quantized x, y pairs. */
  r: number[][]
}
type CountyFile = { source: string; url: string; quantization: number; counties: CountyRecord[] }

export type CountyHit = { state: string; county: string; countyLabel: string; fips: string }

let filePromise: Promise<CountyFile> | undefined

function loadCounties(): Promise<CountyFile> {
  filePromise ??= fetch(`${import.meta.env.BASE_URL}data/us-counties.json`).then((res) => {
    if (!res.ok) throw new Error(`County boundaries failed to load (HTTP ${res.status})`)
    return res.json() as Promise<CountyFile>
  })
  // Allow a retry if loading failed.
  filePromise.catch(() => (filePromise = undefined))
  return filePromise
}

/** Even-odd ray casting over every ring of the county (handles holes and multi-part counties). */
function contains(c: CountyRecord, qx: number, qy: number): boolean {
  let inside = false
  for (const ring of c.r) {
    let x = 0
    let y = 0
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < ring.length; i += 2) {
      x += ring[i]
      y += ring[i + 1]
      xs.push(x)
      ys.push(y)
    }
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if (ys[i] > qy !== ys[j] > qy && qx < ((xs[j] - xs[i]) * (qy - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside
    }
  }
  return inside
}

export async function findCounty(lat: number, lon: number): Promise<CountyHit | undefined> {
  const data = await loadCounties()
  const q = data.quantization
  const qx = Math.round(lon * q)
  const qy = Math.round(lat * q)
  for (const c of data.counties) {
    const [minX, minY, maxX, maxY] = c.b
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue
    if (contains(c, qx, qy)) return { state: c.s, county: c.n, countyLabel: c.l, fips: c.g }
  }
  return undefined
}
