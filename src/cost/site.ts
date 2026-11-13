/**
 * Site and surface-parking costs built from DoD Table 6 supporting-facility unit costs
 * (national average, Oct 2025 $, installed with contractor markups). Like the building
 * rates, they get the location factor and military-construction escalation.
 *
 * Areas come from Forma: site limit area, building footprint, and parking area/spots.
 * Open site = site area − footprint − parking area, split between hardscape and landscape.
 */
import { dod } from "./dodData"

const SF_PER_SY = 9

type Component = { code: string; qtyPerUnit: number; label: string }
type Assembly = { label: string; unit: "sf" | "stall"; components: Component[] }

/** $ per assembly unit, from the listed Table 6 items. */
function assemblyRate(a: Assembly) {
  return a.components.reduce((s, c) => s + perUnit(c.code) * c.qtyPerUnit, 0)
}
/** Table 6 item cost converted to $/sf (area items) or $/item. */
function perUnit(code: string) {
  const it = dod.siteItems[code]
  switch (it.unit) {
    case "SY":
      return it.usd / SF_PER_SY
    case "MSF":
      return it.usd / 1000
    default:
      return it.usd // SF, LF, EA
  }
}

export const ASSEMBLIES = {
  parkingPaving: {
    label: "Surface parking paving",
    unit: "sf",
    components: [
      { code: "93210-2-2", qtyPerUnit: 1, label: "Fine grading" },
      { code: "85110-6-1", qtyPerUnit: 1, label: "Crushed stone base, 4 in" },
      { code: "85110-1-3", qtyPerUnit: 1, label: "Asphalt wearing course, 3 in" },
    ],
  },
  parkingStriping: {
    label: "Stall striping",
    unit: "stall",
    components: [{ code: "85110-9-2", qtyPerUnit: 36, label: "Painted markings, 36 lf per stall" }],
  },
  hardscape: {
    label: "Hardscape",
    unit: "sf",
    components: [
      { code: "93210-2-2", qtyPerUnit: 1, label: "Fine grading" },
      { code: "85220-1-1", qtyPerUnit: 1, label: "Concrete walks/plazas, 4 in, with base" },
    ],
  },
  landscape: {
    label: "Landscape",
    unit: "sf",
    components: [
      { code: "93220-1-3", qtyPerUnit: 1, label: "Topsoil, 6 in" },
      { code: "93220-3-3", qtyPerUnit: 1, label: "Sod" },
      { code: "93220-8-3", qtyPerUnit: 1, label: "Irrigation" },
    ],
  },
} satisfies Record<string, Assembly>

export const assemblyNationalRate = (k: keyof typeof ASSEMBLIES) => assemblyRate(ASSEMBLIES[k])

export function assemblyBreakdown(k: keyof typeof ASSEMBLIES) {
  return ASSEMBLIES[k].components.map((c) => ({ ...c, item: dod.siteItems[c.code], usd: perUnit(c.code) * c.qtyPerUnit }))
}

export type SiteSettings = {
  /** Share of open site that is paved hardscape; the rest is landscape. */
  hardscapePct: number
  /** Optional allowance for utilities, drainage, lighting etc., as % of building cost. */
  utilitiesPct: number
  /** All-in local $/sf for open site; replaces the DoD hardscape/landscape calculation. */
  siteOverrideUsdPerSf?: number
  /** All-in local $/stall for surface parking; replaces the DoD paving + striping calculation. */
  parkingOverrideUsdPerStall?: number
}

export const defaultSiteSettings: SiteSettings = { hardscapePct: 30, utilitiesPct: 0 }

export type SiteLine = {
  key: "site" | "parking" | "utilities"
  label: string
  quantity: string
  subtotal: number | null
  /** Short unit rate for the summary table, e.g. "$11.44/sf". */
  rate?: string
  rateNote?: string
  issue?: string
}

const SF_PER_M2 = 10.7639

export function computeSiteLines(args: {
  site: { siteAreaM2: number | null; footprintM2: number | null; parkingSpots: number; parkingAreaM2: number } | null
  settings: SiteSettings
  acf: number | null
  escalation: number
  buildingSubtotal: number
}): SiteLine[] {
  const { site, settings, acf, escalation } = args
  const adj = (acf ?? NaN) * escalation
  const lines: SiteLine[] = []
  const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })
  const d2 = (v: number) => `$${v.toFixed(2)}`

  // ---- Open site (hardscape + landscape) ----
  if (!site) {
    lines.push({ key: "site", label: "Sitework", quantity: "—", subtotal: null, issue: "Couldn't read site areas from Forma" })
  } else if (!site.siteAreaM2) {
    lines.push({ key: "site", label: "Sitework", quantity: "—", subtotal: null, issue: "No site limit drawn in Forma" })
  } else if (site.footprintM2 === null) {
    lines.push({ key: "site", label: "Sitework", quantity: "—", subtotal: null, issue: "Forma couldn't calculate building footprint" })
  } else {
    const openSf = Math.max(0, (site.siteAreaM2 - site.footprintM2 - site.parkingAreaM2) * SF_PER_M2)
    const qty = `${n0(openSf)} sf`
    if (settings.siteOverrideUsdPerSf && settings.siteOverrideUsdPerSf > 0) {
      lines.push({ key: "site", label: "Sitework", quantity: qty, subtotal: openSf * settings.siteOverrideUsdPerSf, rate: `${d2(settings.siteOverrideUsdPerSf)}/sf`, rateNote: `Your rate, used as-is: ${d2(settings.siteOverrideUsdPerSf)}/sf` })
    } else if (acf === null) {
      lines.push({ key: "site", label: "Sitework", quantity: qty, subtotal: null, issue: "No location factor" })
    } else {
      const h = Math.min(100, Math.max(0, settings.hardscapePct)) / 100
      const blended = (assemblyNationalRate("hardscape") * h + assemblyNationalRate("landscape") * (1 - h)) * adj
      lines.push({
        key: "site",
        label: "Sitework",
        quantity: qty,
        subtotal: openSf * blended,
        rate: `${d2(blended)}/sf`,
        rateNote: `${Math.round(h * 100)}% hardscape at ${d2(assemblyNationalRate("hardscape"))}/sf + ${Math.round((1 - h) * 100)}% landscape at ${d2(assemblyNationalRate("landscape"))}/sf, × ${acf.toFixed(2)} location × ${escalation.toFixed(3)} escalation = ${d2(blended)}/sf`,
      })
    }
  }

  // ---- Surface parking ----
  if (site && (site.parkingSpots > 0 || site.parkingAreaM2 > 0)) {
    const areaSf = site.parkingAreaM2 * SF_PER_M2
    const qty = `${n0(site.parkingSpots)} stalls`
    if (settings.parkingOverrideUsdPerStall && settings.parkingOverrideUsdPerStall > 0) {
      lines.push({ key: "parking", label: "Surface parking", quantity: qty, subtotal: site.parkingSpots * settings.parkingOverrideUsdPerStall, rate: `$${n0(settings.parkingOverrideUsdPerStall)}/stall`, rateNote: `Your rate, used as-is: $${n0(settings.parkingOverrideUsdPerStall)}/stall` })
    } else if (acf === null) {
      lines.push({ key: "parking", label: "Surface parking", quantity: qty, subtotal: null, issue: "No location factor" })
    } else {
      const paving = areaSf * assemblyNationalRate("parkingPaving") * adj
      const striping = site.parkingSpots * assemblyNationalRate("parkingStriping") * adj
      const sub = paving + striping
      lines.push({
        key: "parking",
        label: "Surface parking",
        quantity: qty,
        subtotal: sub,
        rate: site.parkingSpots ? `$${n0(sub / site.parkingSpots)}/stall` : undefined,
        rateNote: `Paving ${d2(assemblyNationalRate("parkingPaving"))}/sf + striping ${d2(assemblyNationalRate("parkingStriping"))}/stall, × ${acf.toFixed(2)} location × ${escalation.toFixed(3)} escalation${site.parkingSpots ? ` ≈ $${n0(sub / site.parkingSpots)}/stall` : ""}`,
      })
    }
  }

  // ---- Utilities allowance ----
  if (settings.utilitiesPct > 0) {
    lines.push({
      key: "utilities",
      label: "Site utilities allowance",
      quantity: "",
      rate: `${settings.utilitiesPct}% of bldg`,
      subtotal: args.buildingSubtotal * (settings.utilitiesPct / 100),
      rateNote: "Your allowance for utilities, drainage, lighting and other site work not priced above",
    })
  }
  return lines
}
