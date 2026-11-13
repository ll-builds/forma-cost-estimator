/**
 * Reads project inputs from Forma using only public SDK methods
 * (verified against forma-embedded-view-sdk 0.96.0 type definitions):
 *
 *   Forma.getProjectId()                      -> project id
 *   Forma.project.get()                       -> name, countryCode, timezone, srid, hubId
 *   Forma.project.getGeoLocation()            -> [latitude, longitude]
 *   Forma.getPresentationUnitSystem()         -> "metric" | "imperial"
 *   Forma.udm.getRootUrn()                    -> content identity (works in proposal and UDM sessions)
 *   Forma.proposal.getId() / .get()           -> proposal id + name (deprecated; legacy sessions only)
 *   Forma.areaMetrics.calculate({})           -> builtInMetrics.grossFloorArea.functionBreakdown
 *   Forma.udm.subscribe(..., debounced)       -> refresh trigger
 *
 * This module never writes to the model.
 */
import type { EmbeddedViewSdk } from "forma-embedded-view-sdk"
import type { ProgramArea, Probe, ProjectInputs } from "./types"

const TIMEOUT_MS = 15000

async function probe<T>(api: string, fn: () => Promise<T> | T): Promise<Probe<T>> {
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
      ),
    ])
    return { ok: true, value, api }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), api }
  }
}

let formaPromise: Promise<EmbeddedViewSdk> | undefined

/** Load the SDK lazily so the mock page works outside Forma. */
export function getForma(): Promise<EmbeddedViewSdk> {
  formaPromise ??= import("forma-embedded-view-sdk/auto").then((m) => m.Forma)
  return formaPromise
}

export async function readLiveInputs(): Promise<ProjectInputs> {
  const Forma = await getForma()
  const metrics = probe("Forma.areaMetrics.calculate({})", () => Forma.areaMetrics.calculate({}))
  const numOrNull = (v: number | "UNABLE_TO_CALCULATE") => (typeof v === "number" ? v : null)

  const [projectId, project, geoLocation, presentationUnits, rootUrn, proposal, grossFloorArea, site] =
    await Promise.all([
      probe("Forma.getProjectId()", () => Forma.getProjectId()),
      probe("Forma.project.get()", async () => {
        const p = await Forma.project.get()
        return {
          name: p.name,
          countryCode: p.countryCode,
          timezone: p.timezone,
          srid: p.srid,
          hubId: p.hubId,
        }
      }),
      probe("Forma.project.getGeoLocation()", () => Forma.project.getGeoLocation()),
      probe("Forma.getPresentationUnitSystem()", () => Forma.getPresentationUnitSystem()),
      probe("Forma.udm.getRootUrn()", async () => String(await Forma.udm.getRootUrn())),
      probe("Forma.proposal.getId() + .get()", async () => {
        const id = await Forma.proposal.getId()
        const element = await Forma.proposal.get({ proposalId: id })
        return { id, name: element.properties?.name }
      }),
      probe("Forma.areaMetrics.calculate({}) → grossFloorArea", async () => {
        const m = await metrics
        if (!m.ok) throw new Error(m.error)
        const gfa = m.value.builtInMetrics.grossFloorArea
        const programs: ProgramArea[] = gfa.functionBreakdown.map((f) => ({
          functionId: f.functionId,
          functionName: f.functionName,
          functionColor: f.functionColor,
          areaM2: typeof f.value === "number" ? f.value : null,
        }))
        const allNumeric = programs.every((p) => p.areaM2 !== null)
        return {
          unitOfMeasurement: gfa.unitOfMeasurement,
          totalM2: allNumeric ? programs.reduce((s, p) => s + (p.areaM2 ?? 0), 0) : null,
          programs,
        }
      }),
      probe("Forma.areaMetrics.calculate({}) → siteArea, buildingCoverage, parkingStatistics", async () => {
        const m = await metrics
        if (!m.ok) throw new Error(m.error)
        const b = m.value.builtInMetrics
        return {
          siteAreaM2: numOrNull(b.siteArea.value),
          footprintM2: numOrNull(b.buildingCoverage.value),
          parkingSpots: m.value.parkingStatistics.spots,
          parkingAreaM2: m.value.parkingStatistics.area,
        }
      }),
    ])

  return {
    source: "live",
    fetchedAt: new Date().toISOString(),
    projectId,
    project,
    geoLocation,
    presentationUnits,
    rootUrn,
    proposal,
    grossFloorArea,
    site,
  }
}

/** Calls onChange after each persisted model change. Returns an unsubscribe function. */
export async function subscribeToChanges(onChange: () => void): Promise<() => void> {
  const Forma = await getForma()
  const { unsubscribe } = await Forma.udm.subscribe(() => onChange(), {
    debouncedPersistedOnly: true,
  })
  return unsubscribe
}
