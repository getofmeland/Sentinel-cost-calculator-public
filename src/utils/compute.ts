import {
  PricingBundle,
  STATIC_PRICING_BUNDLE,
  DAYS_PER_MONTH,
  GRAPH_BUILD_VCORES,
  GRAPH_QUERY_VCORES,
  GRAPH_QUERY_MIN_MINUTES,
  GRAPH_ILLUSTRATIVE_BUILD_MINUTES,
  ADI_SESSION_STARTUP_MINUTES,
  type AdiPoolVCores,
} from '../data/pricing'
import { round2 } from './round'

/**
 * Cost model for the two Sentinel data lake compute meters: custom graph and
 * Advanced Data Insights (notebook/Spark compute).
 *
 * These behave unlike everything else in the calculator. Every other cost is
 * volume x rate; these are vCores x wall-clock time x rate, driven by how often
 * something runs rather than how much data arrives.
 *
 * Both are strictly opt-in. Enabling the data lake does not bill either meter:
 * the graphs auto-provisioned with the lake (Defender hunting graph, blast
 * radius, Purview insider risk) are explicitly free. Only custom graphs
 * authored in VS Code, and notebooks a user deliberately runs, are billable.
 *
 * Formulas are Microsoft's, from https://learn.microsoft.com/en-us/azure/sentinel/billing
 */

/**
 * Rebuild frequencies Microsoft offers when scheduling a graph job.
 *
 * This dropdown is the single most expensive choice in the product. The same
 * five-minute build costs roughly £49/month weekly, £346 daily and £8,299
 * hourly — and Microsoft's cost-management threshold enforcement covers
 * Advanced Data Insights but NOT graph, so there is no hard stop.
 */
export type GraphSchedule =
  | 'on-demand'
  | 'monthly'
  | 'weekly'
  | 'daily'
  | 'hourly'
  | 'by-the-minute'

export const GRAPH_SCHEDULE_RUNS_PER_MONTH: Record<GraphSchedule, number> = {
  'on-demand': 0,          // caller supplies an explicit count
  'monthly': 1,
  'weekly': 52 / 12,       // 4.33, not 4 — a month is not four weeks
  'daily': DAYS_PER_MONTH,
  'hourly': DAYS_PER_MONTH * 24,
  'by-the-minute': DAYS_PER_MONTH * 24 * 60,
}

export const GRAPH_SCHEDULE_LABELS: Record<GraphSchedule, string> = {
  'on-demand': 'On demand',
  'monthly': 'Monthly',
  'weekly': 'Weekly',
  'daily': 'Daily',
  'hourly': 'Hourly',
  'by-the-minute': 'By the minute',
}

export interface ComputeConfig {
  graphEnabled: boolean
  graphSchedule: GraphSchedule
  /** Used only when graphSchedule is 'on-demand' */
  graphBuildsPerMonth: number
  graphBuildMinutes: number
  graphQueriesPerMonth: number
  graphQueryMinutes: number
  /** Notebook minutes each build consumes — a build bills ADI as well as graph */
  graphBuildNotebookMinutes: number

  adiEnabled: boolean
  adiPoolVCores: AdiPoolVCores
  adiInteractiveHoursPerMonth: number
  adiInteractiveSessionsPerMonth: number
  adiScheduledHoursPerMonth: number
}

export const DEFAULT_COMPUTE_CONFIG: ComputeConfig = {
  // Both off by default: opt-in meters, and custom graphs are Preview.
  graphEnabled: false,
  graphSchedule: 'daily',
  graphBuildsPerMonth: 1,
  graphBuildMinutes: GRAPH_ILLUSTRATIVE_BUILD_MINUTES,
  graphQueriesPerMonth: 0,
  graphQueryMinutes: 1,
  graphBuildNotebookMinutes: 10,

  adiEnabled: false,
  adiPoolVCores: 32,
  adiInteractiveHoursPerMonth: 0,
  adiInteractiveSessionsPerMonth: 0,
  adiScheduledHoursPerMonth: 0,
}

export interface ComputeCostBreakdown {
  /** Graph meter only — builds */
  graphBuildMonthlyUsd: number
  /** Graph meter only — queries */
  graphQueryMonthlyUsd: number
  /** ADI incurred by graph builds, which bill both meters */
  graphNotebookMonthlyUsd: number
  /** ADI from notebook sessions the user runs directly */
  adiInteractiveMonthlyUsd: number
  adiScheduledMonthlyUsd: number
  /** Billable Spark start-up time, which is dead time before any code runs */
  adiStartupMonthlyUsd: number

  graphBuildsPerMonth: number
  totalGraphMonthlyUsd: number
  totalAdiMonthlyUsd: number
  totalMonthlyUsd: number

  /** $/hour while a build runs — shown in the UI so the figure is believable */
  graphBuildHourlyRateUsd: number
  graphQueryHourlyRateUsd: number
  adiPoolHourlyRateUsd: number
}

function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** vCores x hours x rate — the whole model in one line. */
function vCoreHoursUsd(vCores: number, minutes: number, runs: number, rateUsd: number): number {
  return vCores * (nonNegative(minutes) / 60) * nonNegative(runs) * rateUsd
}

export function buildsPerMonth(config: ComputeConfig): number {
  return config.graphSchedule === 'on-demand'
    ? nonNegative(config.graphBuildsPerMonth)
    : GRAPH_SCHEDULE_RUNS_PER_MONTH[config.graphSchedule]
}

export function computeComputeCosts(
  config: ComputeConfig,
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
): ComputeCostBreakdown {
  const graphRate = pricing.graphRateUsdPerVCoreHour
  const adiRate = pricing.advancedDataInsightsRateUsdPerVCoreHour

  const runs = config.graphEnabled ? buildsPerMonth(config) : 0

  const graphBuildMonthlyUsd = vCoreHoursUsd(
    GRAPH_BUILD_VCORES, config.graphBuildMinutes, runs, graphRate,
  )

  // Queries have a documented one-minute floor; builds do not.
  const queryMinutes = Math.max(GRAPH_QUERY_MIN_MINUTES, nonNegative(config.graphQueryMinutes))
  const graphQueryMonthlyUsd = config.graphEnabled
    ? vCoreHoursUsd(GRAPH_QUERY_VCORES, queryMinutes, config.graphQueriesPerMonth, graphRate)
    : 0

  // A graph build also consumes notebook/Spark compute, billed separately under
  // ADI. Modelling graph alone would understate a build materially. This is
  // charged whenever graph is on, whether or not the user runs their own
  // notebooks, so it does not depend on adiEnabled.
  const graphNotebookMonthlyUsd = vCoreHoursUsd(
    config.adiPoolVCores, config.graphBuildNotebookMinutes, runs, adiRate,
  )

  const adiInteractiveMonthlyUsd = config.adiEnabled
    ? vCoreHoursUsd(config.adiPoolVCores, 60, config.adiInteractiveHoursPerMonth, adiRate)
    : 0

  const adiScheduledMonthlyUsd = config.adiEnabled
    ? vCoreHoursUsd(config.adiPoolVCores, 60, config.adiScheduledHoursPerMonth, adiRate)
    : 0

  const adiStartupMonthlyUsd = config.adiEnabled
    ? vCoreHoursUsd(
        config.adiPoolVCores, ADI_SESSION_STARTUP_MINUTES,
        config.adiInteractiveSessionsPerMonth, adiRate,
      )
    : 0

  const totalGraphMonthlyUsd = round2(graphBuildMonthlyUsd + graphQueryMonthlyUsd)
  const totalAdiMonthlyUsd = round2(
    graphNotebookMonthlyUsd + adiInteractiveMonthlyUsd + adiScheduledMonthlyUsd + adiStartupMonthlyUsd,
  )

  return {
    graphBuildMonthlyUsd: round2(graphBuildMonthlyUsd),
    graphQueryMonthlyUsd: round2(graphQueryMonthlyUsd),
    graphNotebookMonthlyUsd: round2(graphNotebookMonthlyUsd),
    adiInteractiveMonthlyUsd: round2(adiInteractiveMonthlyUsd),
    adiScheduledMonthlyUsd: round2(adiScheduledMonthlyUsd),
    adiStartupMonthlyUsd: round2(adiStartupMonthlyUsd),

    graphBuildsPerMonth: runs,
    totalGraphMonthlyUsd,
    totalAdiMonthlyUsd,
    totalMonthlyUsd: round2(totalGraphMonthlyUsd + totalAdiMonthlyUsd),

    graphBuildHourlyRateUsd: GRAPH_BUILD_VCORES * graphRate,
    graphQueryHourlyRateUsd: GRAPH_QUERY_VCORES * graphRate,
    adiPoolHourlyRateUsd: config.adiPoolVCores * adiRate,
  }
}
