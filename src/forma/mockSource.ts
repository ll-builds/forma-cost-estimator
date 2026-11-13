/**
 * MOCK DATA — for UI development outside Forma only.
 * Nothing here comes from a real project. The panel labels it as mock everywhere.
 */
import type { ProjectInputs } from "./types"

export function readMockInputs(): ProjectInputs {
  const ok = <T,>(api: string, value: T) => ({ ok: true as const, value, api: `[mock] ${api}` })
  const programs = [
    { functionId: "residential", functionName: "Residential", functionColor: "#e8b64c", areaM2: 8200 },
    { functionId: "office", functionName: "Office", functionColor: "#4c8be8", areaM2: 5400 },
    { functionId: "custom-1", functionName: "Innovation hub", functionColor: "#9b59b6", areaM2: 1250 },
    { functionId: "custom-2", functionName: "Retail – ground floor", functionColor: "#e74c3c", areaM2: null },
  ]
  return {
    source: "mock",
    fetchedAt: new Date().toISOString(),
    projectId: ok("Forma.getProjectId()", "mock-project-id"),
    project: ok("Forma.project.get()", {
      name: "Mock project (not real data)",
      countryCode: "us",
      timezone: "America/Denver",
      srid: 32613,
      hubId: "mock-hub",
    }),
    geoLocation: ok("Forma.project.getGeoLocation()", [39.7392, -104.9903] as [number, number]),
    presentationUnits: ok("Forma.getPresentationUnitSystem()", "imperial" as const),
    rootUrn: ok("Forma.udm.getRootUrn()", "urn:adsk-forma-elements:proposal:mock:mock:1"),
    proposal: {
      ok: false,
      api: "[mock] Forma.proposal.getId() + .get()",
      error: "Simulated: proposal API not supported in Unified Design Model sessions",
    },
    grossFloorArea: ok("Forma.areaMetrics.calculate({})", {
      unitOfMeasurement: "SQUARE_METER",
      totalM2: null,
      programs,
    }),
    site: ok("Forma.areaMetrics.calculate({}) → siteArea, buildingCoverage, parkingStatistics", {
      siteAreaM2: 12000,
      footprintM2: 3100,
      parkingSpots: 85,
      parkingAreaM2: 2600,
    }),
  }
}
