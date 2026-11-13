/**
 * Resolves the project location to a DoD area cost factor (ACF).
 *
 * US projects: the county is found in the browser from bundled Census county boundaries
 * (no API call), then the county's DoD ACF is used, falling back to the state median when
 * DoD lists no site in that county. Outside the US: the country median of DoD's overseas
 * sites, if listed. Never silently uses another region: every result says which method was used.
 */
import { findCounty } from "./counties"
import { dod, normCounty } from "./dodData"

export type LocationFactor =
  | {
      ok: true
      acf: number
      method: "county" | "state-median" | "country-median"
      label: string
      detail: string
      range: [number, number]
    }
  | { ok: false; reason: string }

/** county = base name ("Denver"); countyLabel = full name ("Denver County", "Orleans Parish"). */
type CensusGeo = { state: string; county: string; countyLabel: string }

async function censusLookup(lat: number, lon: number): Promise<CensusGeo> {
  const hit = await findCounty(lat, lon)
  if (!hit) throw new Error("these coordinates aren't inside any US county")
  return hit
}

function countryName(code: string): string | undefined {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase())
  } catch {
    return undefined
  }
}

export async function resolveLocationFactor(
  geo: [number, number] | undefined,
  countryCode: string | undefined,
): Promise<LocationFactor> {
  const cc = countryCode?.toLowerCase()
  if (cc === "us") {
    if (!geo) return { ok: false, reason: "US project without coordinates; can't find the county." }
    let place: CensusGeo
    try {
      place = await censusLookup(geo[0], geo[1])
    } catch (e) {
      return { ok: false, reason: `Location lookup failed: ${e instanceof Error ? e.message : String(e)}` }
    }
    const st = dod.acf.conus[place.state.toLowerCase()]
    if (!st) return { ok: false, reason: `DoD lists no area cost factors for ${place.state}.` }
    // Independent cities: DoD sometimes lists "Norfolk" rather than "Norfolk (City)".
    const c =
      st.counties[normCounty(place.countyLabel)] ??
      (/ city$/i.test(place.countyLabel) && !st.counties[normCounty(place.county)]?.aliasOf ? st.counties[normCounty(place.county)] : undefined)
    if (c)
      return {
        ok: true,
        acf: c.acf,
        method: "county",
        label: `${place.countyLabel}, ${st.name}`,
        detail: `DoD area cost factor for ${place.countyLabel}${c.aliasOf ? ` (DoD lists it under its former name, ${c.aliasOf})` : ""} (${c.installations} DoD installation${c.installations > 1 ? "s" : ""}${c.cities.length ? `: ${c.cities.join(", ")}` : ""})`,
        range: [c.min, c.max],
      }
    return {
      ok: true,
      acf: st.median,
      method: "state-median",
      label: `${place.countyLabel}, ${st.name}`,
      detail: `No DoD site in ${place.countyLabel}. Using the median of ${st.countyCount} ${st.name} counties (range ${st.min}–${st.max}).`,
      range: [st.min, st.max],
    }
  }

  const name = cc ? countryName(cc) : undefined
  const entry = name ? dod.acf.oconus[name] : undefined
  if (name && entry)
    return {
      ok: true,
      acf: entry.median,
      method: "country-median",
      label: name,
      detail: `Median of ${entry.installations} DoD site${entry.installations > 1 ? "s" : ""} in ${name} (range ${entry.min}–${entry.max}). Overseas factors assume US construction methods.`,
      range: [entry.min, entry.max],
    }
  return { ok: false, reason: `DoD publishes no area cost factor for ${name ?? countryCode ?? "this location"}.` }
}
