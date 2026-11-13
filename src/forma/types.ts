/**
 * Normalized inputs the cost estimator needs, independent of where they came from.
 * All areas are stored in square meters (the Forma SDK always works in metric).
 */

export type DataSource = "live" | "mock"

/** Result of one SDK call, so the panel can show exactly what worked and what didn't. */
export type Probe<T> =
  | { ok: true; value: T; api: string }
  | { ok: false; error: string; api: string }

export type ProgramArea = {
  functionId: string
  /** Label exactly as defined in Forma (built-in or custom function). */
  functionName: string
  functionColor: string
  /** Square meters, or null when Forma reports UNABLE_TO_CALCULATE. */
  areaM2: number | null
}

export type ProjectInputs = {
  source: DataSource
  fetchedAt: string
  projectId: Probe<string>
  project: Probe<{
    name: string
    countryCode: string
    timezone: string
    srid: number
    hubId: string
  }>
  /** [latitude, longitude] in WGS84. */
  geoLocation: Probe<[number, number] | undefined>
  presentationUnits: Probe<"metric" | "imperial">
  /** Content identity of the loaded design. Changes on every edit. */
  rootUrn: Probe<string>
  /** Legacy proposal sessions only; rejects in Unified Design Model sessions. */
  proposal: Probe<{ id: string; name: string | undefined }>
  grossFloorArea: Probe<{
    unitOfMeasurement: string | undefined
    totalM2: number | null
    programs: ProgramArea[]
  }>
  /** From the same areaMetrics call. Areas in m²; null when Forma reports UNABLE_TO_CALCULATE. */
  site: Probe<{
    /** Total of site limit polygons. 0 when no site limit is drawn. */
    siteAreaM2: number | null
    /** Area covered by buildings (footprint). */
    footprintM2: number | null
    parkingSpots: number
    parkingAreaM2: number
  }>
}
