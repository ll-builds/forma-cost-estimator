import { useCallback, useEffect, useState } from "react"
import "./App.css"
import { EstimatePanel } from "./EstimatePanel"
import { readLiveInputs, subscribeToChanges } from "./forma/liveSource"
import { readMockInputs } from "./forma/mockSource"
import type { Probe, ProjectInputs } from "./forma/types"

const FT2_PER_M2 = 10.7639

/** Inside Forma the extension runs in an iframe. Opened directly, or with ?mock, use mock data. */
const useMock = window.self === window.top || new URLSearchParams(location.search).has("mock")

function fmtArea(m2: number | null, units: "metric" | "imperial") {
  if (m2 === null) return "Unable to calculate"
  const n = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return units === "imperial" ? `${n(m2 * FT2_PER_M2)} ft² (${n(m2)} m²)` : `${n(m2)} m² (${n(m2 * FT2_PER_M2)} ft²)`
}

function buildWarnings(d: ProjectInputs): { level: "warn" | "info"; text: string }[] {
  const w: { level: "warn" | "info"; text: string }[] = []
  if (d.source === "mock") w.push({ level: "warn", text: "Showing mock data. Nothing on this panel comes from a Forma project." })
  if (!d.geoLocation.ok) w.push({ level: "warn", text: "Could not read project location." })
  else if (!d.geoLocation.value) w.push({ level: "warn", text: "Project has no geolocation set." })
  w.push({ level: "info", text: "Location is coordinates plus country code only. The SDK has no city/metro name; mapping to a cost market is a separate step." })
  if (!d.grossFloorArea.ok) {
    w.push({ level: "warn", text: "Could not read gross floor area." })
  } else {
    const g = d.grossFloorArea.value
    if (g.programs.length === 0)
      w.push({ level: "warn", text: "No gross floor area found. GFA only counts supported buildings with explicitly defined floors." })
    const missing = g.programs.filter((p) => p.areaM2 === null)
    if (missing.length)
      w.push({ level: "warn", text: `Forma could not calculate area for: ${missing.map((p) => p.functionName).join(", ")}. Totals are incomplete.` })
    if (g.unitOfMeasurement !== "SQUARE_METER")
      w.push({ level: "warn", text: `Unexpected GFA unit "${g.unitOfMeasurement ?? "none"}". Expected SQUARE_METER.` })
  }
  w.push({ level: "info", text: "Imported models (for example, uploaded meshes) don't contribute to GFA. Check the scene for buildings this panel can't see." })
  if (!d.proposal.ok)
    w.push({ level: "info", text: "Proposal name unavailable (expected in Unified Design Model sessions). Using root URN as the design identity." })
  return w
}

function ProbeRow<T>({ label, p, render }: { label: string; p: Probe<T>; render: (v: T) => React.ReactNode }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{p.ok ? render(p.value) : <span className="err">Error: {p.error}</span>}</td>
      <td className="api">
        <span className={p.ok ? "dot ok" : "dot bad"} />
        <code>{p.api}</code>
      </td>
    </tr>
  )
}

export default function App() {
  const [data, setData] = useState<ProjectInputs | null>(null)
  const [loading, setLoading] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFatal(null)
    try {
      setData(useMock ? readMockInputs() : await readLiveInputs())
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    if (useMock) return
    let unsub: (() => void) | undefined
    subscribeToChanges(() => void load()).then((u) => (unsub = u), () => {})
    return () => unsub?.()
  }, [load])

  const units = data?.presentationUnits.ok ? data.presentationUnits.value : "metric"

  return (
    <main>
      <header className="toolbar">
        <span className={`badge ${useMock ? "mock" : "live"}`}>{useMock ? "Mock data" : "Live Forma data"}</span>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? "Reading…" : "Refresh"}
        </button>
      </header>

      {fatal && <p className="err">Failed to talk to Forma: {fatal}</p>}

      {data && <EstimatePanel key={data.projectId.ok ? data.projectId.value : "none"} data={data} />}

      {data && (
        <details className="diagnostics">
          <summary>Input diagnostics</summary>
          <ul className="warnings">
            {buildWarnings(data).map((w, i) => (
              <li key={i} className={w.level}>
                {w.text}
              </li>
            ))}
          </ul>

          <h2>Project and location</h2>
          <table>
            <tbody>
              <ProbeRow label="Project ID" p={data.projectId} render={(v) => v} />
              <ProbeRow label="Project" p={data.project} render={(v) => `${v.name} · country: ${v.countryCode.toUpperCase()} · ${v.timezone}`} />
              <ProbeRow
                label="Geolocation"
                p={data.geoLocation}
                render={(v) => (v ? `${v[0].toFixed(5)}, ${v[1].toFixed(5)} (lat, lon)` : "Not set")}
              />
              <ProbeRow label="Display units" p={data.presentationUnits} render={(v) => v} />
            </tbody>
          </table>

          <h2>Active design</h2>
          <table>
            <tbody>
              <ProbeRow label="Root URN" p={data.rootUrn} render={(v) => <code className="wrap">{v}</code>} />
              <ProbeRow label="Proposal" p={data.proposal} render={(v) => `${v.name ?? "(unnamed)"} · ${v.id}`} />
            </tbody>
          </table>

          <h2>Gross floor area by program</h2>
          {data.grossFloorArea.ok ? (
            <table className="programs">
              <thead>
                <tr>
                  <th>Program (as defined in Forma)</th>
                  <th>Function ID</th>
                  <th className="num">GFA</th>
                </tr>
              </thead>
              <tbody>
                {data.grossFloorArea.value.programs.map((p) => (
                  <tr key={p.functionId}>
                    <td>
                      <span className="swatch" style={{ background: p.functionColor }} />
                      {p.functionName}
                    </td>
                    <td>
                      <code>{p.functionId}</code>
                    </td>
                    <td className={p.areaM2 === null ? "num err" : "num"}>{fmtArea(p.areaM2, units)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Total (source unit: {data.grossFloorArea.value.unitOfMeasurement ?? "unknown"})</th>
                  <th className="num">
                    {data.grossFloorArea.value.totalM2 === null ? "Incomplete" : fmtArea(data.grossFloorArea.value.totalM2, units)}
                  </th>
                </tr>
              </tfoot>
            </table>
          ) : (
            <p className="err">
              {data.grossFloorArea.api} failed: {data.grossFloorArea.error}
            </p>
          )}

          <h2>Site and parking</h2>
          <table>
            <tbody>
              <ProbeRow
                label="Site metrics"
                p={data.site}
                render={(v) =>
                  `Site ${v.siteAreaM2 === null ? "unable to calculate" : fmtArea(v.siteAreaM2, units)} · footprint ${fmtArea(v.footprintM2, units)} · parking ${v.parkingSpots} spots, ${fmtArea(v.parkingAreaM2, units)}`
                }
              />
            </tbody>
          </table>

          <p className="meta">
            Source: {data.source} · read at {new Date(data.fetchedAt).toLocaleTimeString()}
            {!useMock && " · refreshes automatically after each saved change"}
          </p>
        </details>
      )}
    </main>
  )
}
