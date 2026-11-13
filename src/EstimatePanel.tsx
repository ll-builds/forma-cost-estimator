import { useEffect, useMemo, useState } from "react"
import { benchmarkById, dod, escalationYears } from "./cost/dodData"
import { computeEstimate, defaultRange, type ProgramChoice, suggestBenchmark } from "./cost/estimate"
import { type LocationFactor, resolveLocationFactor } from "./cost/location"
import { assemblyBreakdown, assemblyNationalRate, defaultSiteSettings, type SiteSettings } from "./cost/site"
import type { ProjectInputs } from "./forma/types"

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const usd2 = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
/** Compact millions for the range, e.g. $40.3M. */
const usdM = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })
const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })

const TABLE3 = dod.benchmarks.filter((b) => b.table === "Table 3").sort((a, b) => a.title.localeCompare(b.title))
const TABLE2 = dod.benchmarks.filter((b) => b.table === "Table 2")

type Saved = {
  choices: Record<string, ProgramChoice>
  year: number
  contingencyPct: number
  designPct: number
  acfOverride?: number
  siteSettings: SiteSettings
  range: { lowPct: number; highPct: number }
}

/** Mappings and assumptions are saved per Forma project in this browser. */
function useSaved(projectId: string) {
  const key = `cost-estimator:${projectId}`
  const [saved, setSaved] = useState<Saved>(() => {
    // US federal fiscal year starts 1 October.
    const now = new Date()
    const fy = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear()
    const year = escalationYears.find((y) => y >= fy) ?? escalationYears.at(-1) ?? fy
    const fallback: Saved = { choices: {}, year, contingencyPct: 0, designPct: 0, siteSettings: defaultSiteSettings, range: defaultRange }
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}")
      return { ...fallback, ...stored, siteSettings: { ...defaultSiteSettings, ...stored.siteSettings }, range: { ...defaultRange, ...stored.range } }
    } catch {
      return fallback
    }
  })
  useEffect(() => localStorage.setItem(key, JSON.stringify(saved)), [key, saved])
  return [saved, setSaved] as const
}

export function EstimatePanel({ data }: { data: ProjectInputs }) {
  const projectId = data.projectId.ok ? data.projectId.value : "unknown"
  const [saved, setSaved] = useSaved(projectId)
  const [loc, setLoc] = useState<LocationFactor | "loading">("loading")

  const geo = data.geoLocation.ok ? data.geoLocation.value : undefined
  const country = data.project.ok ? data.project.value.countryCode : undefined
  const lat = geo?.[0]
  const lon = geo?.[1]
  useEffect(() => {
    let alive = true
    setLoc("loading")
    resolveLocationFactor(lat !== undefined && lon !== undefined ? [lat, lon] : undefined, country).then((r) => alive && setLoc(r))
    return () => {
      alive = false
    }
  }, [lat, lon, country])

  const programs = data.grossFloorArea.ok ? data.grossFloorArea.value.programs : []

  // Fill in suggestions for programs the user hasn't mapped yet (once per program).
  useEffect(() => {
    const missing = programs.filter((p) => !(p.functionId in saved.choices))
    if (!missing.length) return
    setSaved((s) => {
      const choices = { ...s.choices }
      for (const p of missing) choices[p.functionId] = { benchmarkId: suggestBenchmark(p) ?? "" }
      return { ...s, choices }
    })
  }, [programs, saved.choices, setSaved])

  const autoAcf = loc !== "loading" && loc.ok ? loc.acf : null
  const acf = saved.acfOverride ?? autoAcf
  const site = data.site.ok ? data.site.value : null
  const est = useMemo(
    () =>
      computeEstimate({
        programs,
        choices: saved.choices,
        acf,
        year: saved.year,
        contingencyPct: saved.contingencyPct,
        designPct: saved.designPct,
        site,
        siteSettings: saved.siteSettings,
        range: saved.range,
      }),
    [programs, saved, acf, site],
  )
  const setSite = (p: Partial<SiteSettings>) => setSaved((s) => ({ ...s, siteSettings: { ...s.siteSettings, ...p } }))
  const numOrUndef = (v: string) => (v ? Number(v) : undefined)

  const setChoice = (id: string, c: Partial<ProgramChoice>) =>
    setSaved((s) => ({ ...s, choices: { ...s.choices, [id]: { ...{ benchmarkId: "" }, ...s.choices[id], ...c } } }))

  const locLabel = loc === "loading" ? "Finding location…" : loc.ok ? loc.label : "Location not found"

  return (
    <section className="estimate">
      <div className="summary">
        <div className="summary-head">
          <div>
            <div className="summary-label">Estimated construction cost</div>
            <div className="summary-meta">
              {locLabel} · FY{saved.year} $
            </div>
          </div>
          <div className="summary-right">
            <div className="summary-total">{usd(est.total)}</div>
            <div className="summary-range">
              Range {usdM(est.low)} – {usdM(est.high)}
            </div>
          </div>
        </div>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num wide">Qty</th>
              <th className="num wide">Rate</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr className="group">
              <td>Building</td>
              <td className="wide" />
              <td className="wide" />
              <td className="num">{usd(est.buildingSubtotal)}</td>
            </tr>
            {est.rows.map((r) => (
              <tr key={r.program.functionId}>
                <td>
                  <span className="swatch" style={{ background: r.program.functionColor }} />
                  {r.program.functionName}
                  <div className="narrow note">
                    {r.areaSf === null ? "—" : `${n0(r.areaSf)} sf`}
                    {r.rateUsdPerSf !== null && ` × ${usd(r.rateUsdPerSf)}/sf`}
                  </div>
                </td>
                <td className="num wide">{r.areaSf === null ? "—" : `${n0(r.areaSf)} sf`}</td>
                <td className="num wide">{r.rateUsdPerSf === null ? "—" : `${usd(r.rateUsdPerSf)}/sf`}</td>
                <td className="num">{r.subtotal === null ? <span className="err">Not priced</span> : usd(r.subtotal)}</td>
              </tr>
            ))}
            <tr className="group">
              <td>Site</td>
              <td className="wide" />
              <td className="wide" />
              <td className="num">{usd(est.siteSubtotal)}</td>
            </tr>
            {est.siteLines.map((l) => (
              <tr key={l.key}>
                <td>
                  {l.label}
                  <div className="narrow note">
                    {l.quantity}
                    {l.rate && ` × ${l.rate}`}
                  </div>
                </td>
                <td className="num wide">{l.quantity}</td>
                <td className="num wide">{l.rate ?? "—"}</td>
                <td className="num">{l.subtotal === null ? <span className="err">Not priced</span> : usd(l.subtotal)}</td>
              </tr>
            ))}
            {(saved.contingencyPct > 0 || saved.designPct > 0) && (
              <tr className="group">
                <td>Allowances</td>
              <td className="wide" />
              <td className="wide" />
                <td className="num">{usd(est.contingency + est.design)}</td>
              </tr>
            )}
            {saved.contingencyPct > 0 && (
              <tr>
                <td>Contingency ({saved.contingencyPct}%)</td>
                <td className="num wide" />
                <td className="num wide" />
                <td className="num">{usd(est.contingency)}</td>
              </tr>
            )}
            {saved.designPct > 0 && (
              <tr>
                <td>Design ({saved.designPct}%)</td>
                <td className="num wide" />
                <td className="num wide" />
                <td className="num">{usd(est.design)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="calc-details">
        <summary>Show calculations and adjust</summary>
      <h2>Location</h2>
      <div className="card">
        {loc === "loading" ? (
          <p>Looking up location…</p>
        ) : loc.ok ? (
          <>
            <div className="row">
              <strong>{loc.label}</strong>
              <span className="pill">Area cost factor {loc.acf.toFixed(2)}</span>
            </div>
            <p className="note">
              {loc.detail}
              {loc.method !== "county" && <span className="warn-text"> Less precise than a county match.</span>}
            </p>
          </>
        ) : (
          <p className="err">{loc.reason} Enter an area cost factor below to price the estimate.</p>
        )}
        <label className="inline">
          Override factor
          <input
            type="number"
            step="0.01"
            min="0.3"
            placeholder={autoAcf?.toFixed(2) ?? "e.g. 1.00"}
            value={saved.acfOverride ?? ""}
            onChange={(e) => setSaved((s) => ({ ...s, acfOverride: e.target.value ? Number(e.target.value) : undefined }))}
          />
        </label>
        <p className="note">1.00 = DoD national average. Applies to all DoD rates.</p>
      </div>

      <h2>Assumptions</h2>
      <div className="card grid">
        <label>
          Construction midpoint
          <select value={saved.year} onChange={(e) => setSaved((s) => ({ ...s, year: Number(e.target.value) }))}>
            {escalationYears.map((y) => (
              <option key={y} value={y}>
                FY{y}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contingency %
          <input type="number" min="0" step="1" value={saved.contingencyPct} onChange={(e) => setSaved((s) => ({ ...s, contingencyPct: Number(e.target.value) || 0 }))} />
        </label>
        <label>
          Design %
          <input type="number" min="0" step="1" value={saved.designPct} onChange={(e) => setSaved((s) => ({ ...s, designPct: Number(e.target.value) || 0 }))} />
        </label>
        <p className="note full">DoD planning uses 5% contingency and 9% design (13% medical). Both are excluded from the unit costs and apply to building and site.</p>
        <label>
          Range low −%
          <input type="number" min="0" max="90" step="5" value={saved.range.lowPct} onChange={(e) => setSaved((s) => ({ ...s, range: { ...s.range, lowPct: Number(e.target.value) || 0 } }))} />
        </label>
        <label>
          Range high +%
          <input type="number" min="0" step="5" value={saved.range.highPct} onChange={(e) => setSaved((s) => ({ ...s, range: { ...s.range, highPct: Number(e.target.value) || 0 } }))} />
        </label>
        <p className="note full">
          Default −20% / +30% is the narrow end of an AACE Class 5 (concept screening) estimate, which allows −20% to −50% and +30% to +100%.
        </p>
      </div>

      <h2>Programs</h2>
      {est.rows.length === 0 && <p className="err">No gross floor area in this design.</p>}
      {est.rows.map((r) => {
        const c = saved.choices[r.program.functionId] ?? { benchmarkId: "" }
        const suggested = suggestBenchmark(r.program)
        return (
          <div key={r.program.functionId} className={`card program ${r.issue ? "has-issue" : ""}`}>
            <div className="row">
              <span>
                <span className="swatch" style={{ background: r.program.functionColor }} />
                <strong>{r.program.functionName}</strong>
              </span>
              <span>{r.areaSf === null ? "—" : `${n0(r.areaSf)} sf`}</span>
            </div>
            <label>
              DoD benchmark
              <select value={c.benchmarkId} onChange={(e) => setChoice(r.program.functionId, { benchmarkId: e.target.value })}>
                <option value="">— Unpriced —</option>
                {suggested && (
                  <optgroup label="Suggested">
                    <option value={suggested}>{optionLabel(suggested)}</option>
                  </optgroup>
                )}
                <optgroup label="Table 3: replacement value unit costs (FY2025 $)">
                  {TABLE3.map((b) => (
                    <option key={b.id} value={b.id}>
                      {optionLabel(b.id)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Table 2: military construction averages (Oct 2025 $)">
                  {TABLE2.map((b) => (
                    <option key={b.id} value={b.id}>
                      {optionLabel(b.id)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="inline">
              Override $/sf
              <input
                type="number"
                min="0"
                step="1"
                placeholder="local, current $"
                value={c.overrideUsdPerSf ?? ""}
                onChange={(e) => setChoice(r.program.functionId, { overrideUsdPerSf: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
            {r.rateSource === "dod" && r.benchmark && (
              <p className="note calc">
                {usd2(r.benchmark.usdPerSf)}/sf national ({r.benchmark.priceBasis}) × {acf?.toFixed(2)} location × {r.escalation?.toFixed(3)} escalation ={" "}
                <strong>{usd2(r.rateUsdPerSf!)}/sf</strong>
              </p>
            )}
            {r.rateSource === "override" && <p className="note calc">Your rate, used as-is: {usd2(r.rateUsdPerSf!)}/sf</p>}
            {r.benchmark && r.rateSource === "dod" && (
              <p className="note">
                {r.benchmark.table} · {r.benchmark.basisNote}
                {r.benchmark.stdDevPct !== null && ` · ±${r.benchmark.stdDevPct}% std dev`}
              </p>
            )}
            <div className="row subtotal">
              {r.issue ? <span className="err">{r.issue}</span> : <span />}
              <strong>{r.subtotal === null ? "—" : usd(r.subtotal)}</strong>
            </div>
          </div>
        )
      })}

      <h2>Site and parking</h2>
      <div className="card">
        {site ? (
          <p className="note">
            From Forma: site limit {site.siteAreaM2 ? `${n0(site.siteAreaM2 * 10.7639)} sf` : "not drawn"} · building footprint{" "}
            {site.footprintM2 === null ? "unknown" : `${n0(site.footprintM2 * 10.7639)} sf`} · surface parking {n0(site.parkingSpots)} stalls,{" "}
            {n0(site.parkingAreaM2 * 10.7639)} sf. Open site = site − footprint − parking.
          </p>
        ) : (
          <p className="err">Couldn't read site areas from Forma.</p>
        )}
        {est.siteLines.map((l) => (
          <div key={l.key} className="site-line">
            <div className="row">
              <strong>{l.label}</strong>
              <span>{l.subtotal === null ? "—" : usd(l.subtotal)}</span>
            </div>
            {l.rateNote && <p className="note calc">{l.rateNote}</p>}
            {l.issue && <p className="err note">{l.issue}</p>}
          </div>
        ))}
        <div className="grid">
          <label>
            Hardscape %
            <input type="number" min="0" max="100" step="5" value={saved.siteSettings.hardscapePct} onChange={(e) => setSite({ hardscapePct: Number(e.target.value) || 0 })} />
          </label>
          <label>
            Utilities allowance %
            <input type="number" min="0" step="1" value={saved.siteSettings.utilitiesPct} onChange={(e) => setSite({ utilitiesPct: Number(e.target.value) || 0 })} />
          </label>
          <label>
            Override site $/sf
            <input type="number" min="0" step="1" placeholder="local, current $" value={saved.siteSettings.siteOverrideUsdPerSf ?? ""} onChange={(e) => setSite({ siteOverrideUsdPerSf: numOrUndef(e.target.value) })} />
          </label>
          <label>
            Override parking $/stall
            <input type="number" min="0" step="100" placeholder="local, current $" value={saved.siteSettings.parkingOverrideUsdPerStall ?? ""} onChange={(e) => setSite({ parkingOverrideUsdPerStall: numOrUndef(e.target.value) })} />
          </label>
        </div>
        <p className="note">
          Utilities allowance is a % of building cost for utilities, storm drainage, site lighting and other work the DoD site rates below don't cover. Structured or
          below-grade parking modeled as Forma buildings is priced under Building.
        </p>
        <details>
          <summary className="note">DoD site unit costs used (national, Oct 2025)</summary>
          {(["parkingPaving", "parkingStriping", "hardscape", "landscape"] as const).map((k) => (
            <div key={k} className="note">
              <strong>
                {k === "parkingPaving" ? "Parking paving" : k === "parkingStriping" ? "Stall striping" : k === "hardscape" ? "Hardscape" : "Landscape"}:{" "}
                {usd2(assemblyNationalRate(k))}/{k === "parkingStriping" ? "stall" : "sf"}
              </strong>
              <ul>
                {assemblyBreakdown(k).map((c) => (
                  <li key={c.code}>
                    {c.label}: {usd2(c.usd)} (Table 6 item {c.code}, {usd2(c.item.usd)}/{c.item.unit})
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      </div>

      <details className="scope">
        <summary>What this includes and where the data comes from</summary>
        <p className="note">
          <strong>Includes:</strong> {dod.source.includes.join("; ")}.
        </p>
        <p className="note">
          <strong>Excludes:</strong> {dod.source.excludes.join("; ")}.
        </p>
        <p className="note warn-text">{dod.source.caveat}</p>
        <p className="note">
          Source: {dod.source.publisher}. {dod.source.distribution}.{" "}
          {dod.source.files.map((f) => (
            <span key={f.url}>
              <a href={f.url} target="_blank" rel="noreferrer">
                {f.doc}
              </a>
              .{" "}
            </span>
          ))}
          Location: US Census Geocoder and DoD Table 4-1 area cost factors. Escalation: DoD Tables 4-2 (military construction) and 4-3 (replacement value).
        </p>
      </details>
      </details>
    </section>
  )
}

function optionLabel(id: string) {
  const b = benchmarkById.get(id)!
  const t = b.title.replace(/\s*\/\d\/\s*|\*+/g, "").trim()
  return `${t.length > 60 ? t.slice(0, 58) + "…" : t} — $${Math.round(b.usdPerSf)}/sf`
}
