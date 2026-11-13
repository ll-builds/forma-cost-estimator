/**
 * Concept-stage building construction estimate:
 *   subtotal = GFA (sf) × DoD national $/SF × area cost factor × escalation
 * or, when the user overrides a rate, GFA × override (used as-is).
 */
import type { ProgramArea } from "../forma/types"
import { type Benchmark, benchmarkById, dod, escalationFactor } from "./dodData"
import { computeSiteLines, type SiteLine, type SiteSettings } from "./site"

/** Table 6 site costs are Oct 2025 $; DoD escalates them with the military construction factors (Table 4-2). */
const siteEscalation = (year: number) => dod.escalation.milcon.factors[String(year)] ?? 1

export const SF_PER_M2 = 10.7639

/**
 * Suggested DoD benchmark per program, matched on the Forma program name.
 * Suggestions only: the user confirms or changes each one. Unmatched programs stay unpriced.
 * Prefers Table 3 entries based on commercial (Marshall & Swift) valuations where DoD's
 * military-construction averages (Table 2) run far above typical commercial costs.
 */
const SUGGESTIONS: { match: RegExp; id: string }[] = [
  { match: /parking|garage|car ?park/i, id: "T3-8531" },
  { match: /hotel|lodging|hospitality|motel/i, id: "T3-7441" },
  { match: /retail|shop|store|mercantile|commercial/i, id: "T3-7346" },
  { match: /restaurant|dining|food|cafe/i, id: "T3-7331" },
  { match: /office|admin|workplace/i, id: "T3-6107" },
  { match: /child ?care|daycare|nursery|kindergarten|preschool/i, id: "T2-77" },
  { match: /school|education|classroom/i, id: "T2-90" },
  { match: /dorm|student hous/i, id: "T2-67" },
  { match: /residential|housing|apartment|multi-?family|living|condo|dwelling/i, id: "T3-7113" },
  { match: /hospital/i, id: "T3-5100" },
  { match: /clinic|medical|health/i, id: "T3-5500" },
  { match: /lab|research/i, id: "T3-1442" },
  { match: /warehouse|storage|logistic|industrial/i, id: "T3-7388" },
  { match: /fitness|gym|sport|recreation/i, id: "T3-7421" },
  { match: /library/i, id: "T3-7416" },
  { match: /theater|theatre|auditorium|cultural|cinema/i, id: "T3-7431" },
]

export function suggestBenchmark(p: Pick<ProgramArea, "functionName" | "functionId">): string | undefined {
  const text = `${p.functionName} ${p.functionId}`
  return SUGGESTIONS.find((s) => s.match.test(text) && benchmarkById.has(s.id))?.id
}

export type ProgramChoice = {
  /** Benchmark id, or "" for unpriced. */
  benchmarkId: string
  /** Local, current-dollar $/SF typed by the user; replaces the DoD calculation when set. */
  overrideUsdPerSf?: number
}

export type EstimateRow = {
  program: ProgramArea
  areaSf: number | null
  benchmark?: Benchmark
  /** Final $/SF used, after location and escalation (or the override). */
  rateUsdPerSf: number | null
  rateSource: "dod" | "override" | "none"
  escalation: number | null
  subtotal: number | null
  issue?: string
}

export type Estimate = {
  rows: EstimateRow[]
  buildingSubtotal: number
  siteLines: SiteLine[]
  siteSubtotal: number
  /** Building + site, before markups. */
  constructionSubtotal: number
  contingency: number
  design: number
  /** Likely total. */
  total: number
  low: number
  high: number
  complete: boolean
  issues: string[]
}

/**
 * Default accuracy range: AACE International 18R-97 Class 5 (concept screening) estimates
 * are typically −20% to −50% low and +30% to +100% high. We default to the narrow end.
 */
export const defaultRange = { lowPct: 20, highPct: 30 }

export function computeEstimate(args: {
  programs: ProgramArea[]
  choices: Record<string, ProgramChoice>
  acf: number | null
  year: number
  contingencyPct: number
  designPct: number
  site: Parameters<typeof computeSiteLines>[0]["site"]
  siteSettings: SiteSettings
  range: { lowPct: number; highPct: number }
}): Estimate {
  const issues: string[] = []
  const rows = args.programs.map((program): EstimateRow => {
    const areaSf = program.areaM2 === null ? null : program.areaM2 * SF_PER_M2
    const choice = args.choices[program.functionId]
    const benchmark = choice?.benchmarkId ? benchmarkById.get(choice.benchmarkId) : undefined
    const base = { program, areaSf, benchmark }
    if (areaSf === null)
      return { ...base, rateUsdPerSf: null, rateSource: "none", escalation: null, subtotal: null, issue: "Forma couldn't calculate its area" }
    if (choice?.overrideUsdPerSf !== undefined && choice.overrideUsdPerSf > 0)
      return { ...base, rateUsdPerSf: choice.overrideUsdPerSf, rateSource: "override", escalation: null, subtotal: areaSf * choice.overrideUsdPerSf }
    if (!benchmark)
      return { ...base, rateUsdPerSf: null, rateSource: "none", escalation: null, subtotal: null, issue: "No rate chosen" }
    if (args.acf === null)
      return { ...base, rateUsdPerSf: null, rateSource: "none", escalation: null, subtotal: null, issue: "No location factor" }
    const esc = escalationFactor(benchmark, args.year)
    const rate = benchmark.usdPerSf * args.acf * esc
    return { ...base, rateUsdPerSf: rate, rateSource: "dod", escalation: esc, subtotal: areaSf * rate }
  })

  for (const r of rows) if (r.issue) issues.push(`${r.program.functionName}: ${r.issue}`)
  if (rows.length === 0) issues.push("No gross floor area found in this design")
  const buildingSubtotal = rows.reduce((s, r) => s + (r.subtotal ?? 0), 0)

  const siteLines = computeSiteLines({
    site: args.site,
    settings: args.siteSettings,
    acf: args.acf,
    escalation: siteEscalation(args.year),
    buildingSubtotal,
  })
  for (const l of siteLines) if (l.issue) issues.push(`${l.label}: ${l.issue}`)
  const siteSubtotal = siteLines.reduce((s, l) => s + (l.subtotal ?? 0), 0)

  const constructionSubtotal = buildingSubtotal + siteSubtotal
  const contingency = constructionSubtotal * (args.contingencyPct / 100)
  const design = constructionSubtotal * (args.designPct / 100)
  const total = constructionSubtotal + contingency + design
  return {
    rows,
    buildingSubtotal,
    siteLines,
    siteSubtotal,
    constructionSubtotal,
    contingency,
    design,
    total,
    low: total * (1 - args.range.lowPct / 100),
    high: total * (1 + args.range.highPct / 100),
    complete: issues.length === 0,
    issues,
  }
}
