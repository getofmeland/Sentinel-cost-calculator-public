// @vitest-environment node
/**
 * The decisive fact these tests pin down is that the "1 Hour" unit on the Graph
 * and Advanced Data Insights meters is a *vCore*-hour, not a pool-hour. That
 * distinction is worth 49x on a graph build, so the first tests reproduce
 * Microsoft's own worked examples exactly.
 *
 * https://learn.microsoft.com/en-us/azure/sentinel/billing
 */

import { describe, it, expect } from 'vitest'

import {
  computeComputeCosts,
  buildsPerMonth,
  DEFAULT_COMPUTE_CONFIG,
  GRAPH_SCHEDULE_RUNS_PER_MONTH,
  type ComputeConfig,
} from '../compute'
import {
  STATIC_PRICING_BUNDLE,
  GRAPH_RATE_USD_PER_VCORE_HOUR,
  ADVANCED_DATA_INSIGHTS_RATE_USD_PER_VCORE_HOUR,
  GRAPH_BUILD_VCORES,
  GRAPH_QUERY_VCORES,
  DAYS_PER_MONTH,
} from '../../data/pricing'

/** Graph on, one build, nothing else — isolates a single operation. */
const oneBuild: ComputeConfig = {
  ...DEFAULT_COMPUTE_CONFIG,
  graphEnabled: true,
  graphSchedule: 'on-demand',
  graphBuildsPerMonth: 1,
  graphBuildNotebookMinutes: 0,
}

describe("Microsoft's worked examples", () => {
  it('a 5-minute graph build costs 49 x rate x (5/60)', () => {
    // cost = 49 × (Price per vCore hour) × (5/60)
    const expected = 49 * GRAPH_RATE_USD_PER_VCORE_HOUR * (5 / 60)
    const r = computeComputeCosts({ ...oneBuild, graphBuildMinutes: 5 })
    expect(r.graphBuildMonthlyUsd).toBeCloseTo(expected, 2)
    // At UK South rates that is $15.31 — sanity check on the magnitude.
    expect(r.graphBuildMonthlyUsd).toBeCloseTo(15.31, 2)
  })

  it('a 1-minute graph query costs 6 x rate x (1/60)', () => {
    // cost = 6 × (Price per vCore hour) × (1/60), i.e. $0.375 each.
    // Asserted over 100 queries: a single one lands mid-penny and the monthly
    // figure is rounded to the penny for display, which would mask the rate.
    const perQuery = 6 * GRAPH_RATE_USD_PER_VCORE_HOUR * (1 / 60)
    expect(perQuery).toBeCloseTo(0.375, 5)

    const r = computeComputeCosts({
      ...oneBuild, graphBuildsPerMonth: 0, graphQueriesPerMonth: 100, graphQueryMinutes: 1,
    })
    expect(r.graphQueryMonthlyUsd).toBeCloseTo(perQuery * 100, 2)
  })

  it('is per vCore-hour, not per pool-hour — the 49x that decides the model', () => {
    // Guards the single most consequential modelling decision. If someone
    // "simplifies" this to a flat hourly rate, a build gets 49x too cheap.
    const r = computeComputeCosts({ ...oneBuild, graphBuildMinutes: 60 })
    const poolHourInterpretation = GRAPH_RATE_USD_PER_VCORE_HOUR
    expect(r.graphBuildMonthlyUsd).toBeCloseTo(GRAPH_BUILD_VCORES * GRAPH_RATE_USD_PER_VCORE_HOUR, 2)
    expect(r.graphBuildMonthlyUsd / poolHourInterpretation).toBeCloseTo(GRAPH_BUILD_VCORES, 5)
  })

  it('exposes the hourly rate so the UI can show why the number is so large', () => {
    const r = computeComputeCosts(oneBuild)
    expect(r.graphBuildHourlyRateUsd).toBeCloseTo(183.75, 2)
    expect(r.graphQueryHourlyRateUsd).toBeCloseTo(22.5, 2)
  })
})

describe('graph query minimum', () => {
  it('applies the documented one-minute floor to queries', () => {
    const tenSeconds = computeComputeCosts({
      ...oneBuild, graphBuildsPerMonth: 0, graphQueriesPerMonth: 1, graphQueryMinutes: 1 / 6,
    })
    const oneMinute = computeComputeCosts({
      ...oneBuild, graphBuildsPerMonth: 0, graphQueriesPerMonth: 1, graphQueryMinutes: 1,
    })
    expect(tenSeconds.graphQueryMonthlyUsd).toBeCloseTo(oneMinute.graphQueryMonthlyUsd, 5)
  })

  it('does not apply that floor to builds, which have no documented minimum', () => {
    const short = computeComputeCosts({ ...oneBuild, graphBuildMinutes: 0.5 })
    const oneMin = computeComputeCosts({ ...oneBuild, graphBuildMinutes: 1 })
    expect(short.graphBuildMonthlyUsd).toBeLessThan(oneMin.graphBuildMonthlyUsd)
  })
})

describe('rebuild schedule — the dominant cost driver', () => {
  it('maps each frequency to a runs-per-month count', () => {
    expect(GRAPH_SCHEDULE_RUNS_PER_MONTH.monthly).toBe(1)
    expect(GRAPH_SCHEDULE_RUNS_PER_MONTH.daily).toBeCloseTo(DAYS_PER_MONTH, 5)
    expect(GRAPH_SCHEDULE_RUNS_PER_MONTH.hourly).toBeCloseTo(DAYS_PER_MONTH * 24, 5)
  })

  it('treats a month as 52/12 weeks rather than exactly four', () => {
    expect(GRAPH_SCHEDULE_RUNS_PER_MONTH.weekly).toBeCloseTo(4.333, 3)
  })

  it('costs escalate steeply with frequency — the cliff users must see', () => {
    const at = (graphSchedule: ComputeConfig['graphSchedule']) =>
      computeComputeCosts({
        ...DEFAULT_COMPUTE_CONFIG,
        graphEnabled: true, graphSchedule, graphBuildMinutes: 5, graphBuildNotebookMinutes: 0,
      }).graphBuildMonthlyUsd

    expect(at('weekly')).toBeGreaterThan(at('monthly'))
    expect(at('daily')).toBeGreaterThan(at('weekly'))
    expect(at('hourly')).toBeGreaterThan(at('daily') * 20)
    // A daily 5-minute rebuild is about $466/month at UK South rates.
    expect(at('daily')).toBeCloseTo(466, 0)
  })

  it('uses the explicit count for on-demand rather than a frequency', () => {
    expect(buildsPerMonth({ ...oneBuild, graphBuildsPerMonth: 7 })).toBe(7)
  })
})

describe('a graph build bills both meters', () => {
  it('charges Advanced Data Insights for the notebook compute a build consumes', () => {
    // Microsoft: notebook/Spark compute used to build nodes and edges "is billed
    // independently per existing Sentinel data lake meters".
    const r = computeComputeCosts({
      ...oneBuild, graphBuildMinutes: 5, graphBuildNotebookMinutes: 10, adiPoolVCores: 32,
    })
    const expected = 32 * (10 / 60) * ADVANCED_DATA_INSIGHTS_RATE_USD_PER_VCORE_HOUR
    expect(r.graphNotebookMonthlyUsd).toBeCloseTo(expected, 2)
    expect(r.totalMonthlyUsd).toBeCloseTo(r.totalGraphMonthlyUsd + r.totalAdiMonthlyUsd, 2)
  })

  it('charges that notebook cost even when the user runs no notebooks of their own', () => {
    const r = computeComputeCosts({ ...oneBuild, graphBuildNotebookMinutes: 10, adiEnabled: false })
    expect(r.graphNotebookMonthlyUsd).toBeGreaterThan(0)
  })
})

describe('Advanced Data Insights', () => {
  const adiOnly: ComputeConfig = {
    ...DEFAULT_COMPUTE_CONFIG, adiEnabled: true, adiPoolVCores: 12,
  }

  it('bills pool vCores x hours', () => {
    const r = computeComputeCosts({ ...adiOnly, adiInteractiveHoursPerMonth: 10 })
    expect(r.adiInteractiveMonthlyUsd)
      .toBeCloseTo(12 * 10 * ADVANCED_DATA_INSIGHTS_RATE_USD_PER_VCORE_HOUR, 2)
  })

  it('scales with pool size, so the pool choice is visible in the cost', () => {
    const small = computeComputeCosts({ ...adiOnly, adiPoolVCores: 12, adiInteractiveHoursPerMonth: 10 })
    const large = computeComputeCosts({ ...adiOnly, adiPoolVCores: 80, adiInteractiveHoursPerMonth: 10 })
    expect(large.adiInteractiveMonthlyUsd / small.adiInteractiveMonthlyUsd).toBeCloseTo(80 / 12, 3)
  })

  it('charges billable start-up dead time per interactive session', () => {
    const r = computeComputeCosts({
      ...adiOnly, adiPoolVCores: 80, adiInteractiveSessionsPerMonth: 20,
    })
    // 6 minutes of Spark start-up before any user code runs.
    expect(r.adiStartupMonthlyUsd)
      .toBeCloseTo(80 * (6 / 60) * 20 * ADVANCED_DATA_INSIGHTS_RATE_USD_PER_VCORE_HOUR, 2)
  })

  it('separates interactive from scheduled, mirroring Microsoft cost management', () => {
    const r = computeComputeCosts({
      ...adiOnly, adiInteractiveHoursPerMonth: 5, adiScheduledHoursPerMonth: 5,
    })
    expect(r.adiInteractiveMonthlyUsd).toBeCloseTo(r.adiScheduledMonthlyUsd, 5)
  })
})

describe('opt-in behaviour', () => {
  it('costs nothing by default — both meters are opt-in', () => {
    const r = computeComputeCosts(DEFAULT_COMPUTE_CONFIG)
    expect(r.totalMonthlyUsd).toBe(0)
  })

  it('defaults both toggles off, since enabling the lake does not bill these', () => {
    // The graphs auto-provisioned with the data lake are explicitly free.
    expect(DEFAULT_COMPUTE_CONFIG.graphEnabled).toBe(false)
    expect(DEFAULT_COMPUTE_CONFIG.adiEnabled).toBe(false)
  })

  it('seeds build duration from Microsoft\'s illustrative figure', () => {
    expect(DEFAULT_COMPUTE_CONFIG.graphBuildMinutes).toBe(5)
  })

  it('disabling graph removes its cost entirely, including the notebook part', () => {
    const r = computeComputeCosts({ ...oneBuild, graphEnabled: false, graphBuildNotebookMinutes: 30 })
    expect(r.totalMonthlyUsd).toBe(0)
  })
})

describe('input guarding', () => {
  it('rejects negative counts and durations rather than crediting the bill', () => {
    const r = computeComputeCosts({
      ...oneBuild,
      graphBuildMinutes: -100, graphBuildsPerMonth: -5,
      adiEnabled: true, adiInteractiveHoursPerMonth: -10,
    })
    expect(r.totalMonthlyUsd).toBeGreaterThanOrEqual(0)
  })

  it('degrades NaN input to zero rather than propagating it', () => {
    const r = computeComputeCosts({ ...oneBuild, graphBuildMinutes: NaN })
    expect(Number.isFinite(r.totalMonthlyUsd)).toBe(true)
    expect(r.totalMonthlyUsd).toBe(0)
  })
})

describe('live pricing', () => {
  it('uses rates from the supplied bundle, not hardcoded constants', () => {
    const doubled = {
      ...STATIC_PRICING_BUNDLE,
      graphRateUsdPerVCoreHour: STATIC_PRICING_BUNDLE.graphRateUsdPerVCoreHour * 2,
    }
    const base = computeComputeCosts({ ...oneBuild, graphBuildMinutes: 5 })
    const dbl = computeComputeCosts({ ...oneBuild, graphBuildMinutes: 5 }, doubled)
    expect(dbl.graphBuildMonthlyUsd).toBeCloseTo(base.graphBuildMonthlyUsd * 2, 2)
  })

  it('the static bundle carries both compute rates', () => {
    expect(STATIC_PRICING_BUNDLE.graphRateUsdPerVCoreHour).toBe(GRAPH_RATE_USD_PER_VCORE_HOUR)
    expect(STATIC_PRICING_BUNDLE.advancedDataInsightsRateUsdPerVCoreHour)
      .toBe(ADVANCED_DATA_INSIGHTS_RATE_USD_PER_VCORE_HOUR)
    expect(GRAPH_QUERY_VCORES).toBe(6)
  })
})
