// @vitest-environment node
/**
 * Sizing a commitment tier against real daily volume.
 *
 * The property these pin is not "picks a sensible tier" but "never picks a tier
 * that costs more than another over the same days". Cost is piecewise-linear
 * with a commitment floor, so an off-by-one in the overage handling produces a
 * plausible-looking recommendation that is quietly wrong — the shape of every
 * pricing bug this project has shipped.
 */

import { describe, it, expect } from 'vitest'
import { sizeTierOnDailyVolume } from '../tierSizing'
import { analyseUsage } from '../analysis'
import { parseUsagePaste } from '../usageParser'
import { STATIC_PRICING_BUNDLE, DAYS_PER_MONTH } from '../../data/pricing'
import { costAtVolume, tierLabel } from '../tiers'

const flat = (gb: number, days = 31) => Array.from({ length: days }, () => gb)

describe('daily tier sizing', () => {
  it('returns null when there are no days', () => {
    expect(sizeTierOnDailyVolume([])).toBeNull()
  })

  it('agrees with average-based sizing when every day is identical', () => {
    // No variability means no information to exploit; disagreeing here would
    // mean the two code paths simply compute different things.
    const r = sizeTierOnDailyVolume(flat(300))!
    expect(r.disagrees).toBe(false)
    expect(r.differenceMonthlyUsd).toBeCloseTo(0, 6)
    expect(r.minGbPerDay).toBeCloseTo(300, 6)
    expect(r.maxGbPerDay).toBeCloseTo(300, 6)
  })

  it('never picks a tier beaten by another over the same days', () => {
    // The exhaustive property. Any candidate cheaper than the chosen one is a bug.
    const shapes = [
      flat(50), flat(120), flat(650), flat(3000),
      [...flat(28, 25), ...flat(900, 6)],          // steady month with a migration
      [...flat(400, 15), ...flat(120, 16)],        // a decommission mid-month
      Array.from({ length: 31 }, (_, i) => 200 + i * 12), // steady growth
    ]
    for (const days of shapes) {
      const r = sizeTierOnDailyVolume(days, STATIC_PRICING_BUNDLE)!
      const toMonthly = (t: number) => (t / days.length) * DAYS_PER_MONTH
      const paygMonthly = toMonthly(
        days.reduce((a, gb) => a + gb * STATIC_PRICING_BUNDLE.paygRateUsd, 0),
      )
      const allCosts = [
        paygMonthly,
        ...STATIC_PRICING_BUNDLE.commitmentTiers.map(t =>
          toMonthly(days.reduce((a, gb) => a + costAtVolume(t, gb), 0))),
      ]
      expect(r.bestMonthlyUsd).toBeCloseTo(Math.min(...allCosts), 4)
    }
  })

  it('prefers a lower tier than the average would, on a spiky month', () => {
    // 25 quiet days and 6 huge ones. The average is dragged up by the spike;
    // committing to it means paying for volume that arrives on six days a month.
    const days = [...flat(120, 25), ...flat(1200, 6)]
    const r = sizeTierOnDailyVolume(days, STATIC_PRICING_BUNDLE)!
    const mean = days.reduce((a, b) => a + b, 0) / days.length

    expect(r.meanGbPerDay).toBeCloseTo(mean, 4)
    expect(r.maxGbPerDay).toBe(1200)
    expect(r.peakToMedianRatio).toBeGreaterThan(1.5)

    // Whatever it picks must be no worse than the average-based choice against
    // the real days — that is the entire claim the feature makes.
    expect(r.bestMonthlyUsd).toBeLessThanOrEqual(r.meanBasedMonthlyUsd + 1e-6)
    expect(r.differenceMonthlyUsd).toBeGreaterThanOrEqual(-1e-6)
  })

  it('costs the average-based choice against real days, not against the average', () => {
    // Guards a subtle self-flattery: reporting the mean-based option at its own
    // idealised cost would compare a fiction with a fact and overstate the win.
    const days = [...flat(100, 20), ...flat(900, 11)]
    const r = sizeTierOnDailyVolume(days, STATIC_PRICING_BUNDLE)!
    if (r.meanBasedTierLabel) {
      const tier = STATIC_PRICING_BUNDLE.commitmentTiers
        .find(t => tierLabel(t) === r.meanBasedTierLabel)!
      const actual = (days.reduce((a, gb) => a + costAtVolume(tier, gb), 0) / days.length) * DAYS_PER_MONTH
      expect(r.meanBasedMonthlyUsd).toBeCloseTo(actual, 4)
    }
  })

  it('reports the spread it sized against', () => {
    const r = sizeTierOnDailyVolume([100, 200, 300, 400, 500])!
    expect(r.minGbPerDay).toBe(100)
    expect(r.maxGbPerDay).toBe(500)
    expect(r.medianGbPerDay).toBe(300)
    expect(r.dayCount).toBe(5)
  })

  it('ignores impossible days rather than letting them poison the maths', () => {
    const r = sizeTierOnDailyVolume([100, NaN, 200, -5, Infinity])!
    expect(r.dayCount).toBe(2)
    expect(Number.isFinite(r.bestMonthlyUsd)).toBe(true)
  })
})

describe('daily sizing inside the full analysis', () => {
  const paste = [
    'TableName\tPlan\tBillableMB',
    `SigninLogs\tAnalytics\t${300 * 1000 * 31}`,
  ].join('\n')

  it('falls back to average sizing when no daily data is supplied', () => {
    const r = analyseUsage(parseUsagePaste(paste, 31))
    expect(r.dailySizing).toBeNull()
    const opp = r.opportunities.find(o => o.kind === 'commitment-tier')
    expect(opp?.detail).toMatch(/optional daily volume query/i)
  })

  it('uses the daily series when supplied and says what it sized against', () => {
    const r = analyseUsage(parseUsagePaste(paste, 31), STATIC_PRICING_BUNDLE, [
      ...flat(120, 25), ...flat(1200, 6),
    ])
    expect(r.dailySizing).not.toBeNull()
    const opp = r.opportunities.find(o => o.kind === 'commitment-tier')!
    expect(opp.detail).toMatch(/actual days/i)
    expect(opp.detail).toMatch(/range/i)
  })

  it('keeps the headline honest — saving never exceeds current spend', () => {
    const mixed = [
      'TableName\tPlan\tBillableMB',
      `SigninLogs\tAnalytics\t${200 * 1000 * 31}`,
      `CommonSecurityLog\tAnalytics\t${150 * 1000 * 31}`,
      `ContainerLogV2\tAnalytics\t${90 * 1000 * 31}`,
    ].join('\n')
    const r = analyseUsage(parseUsagePaste(mixed, 31), STATIC_PRICING_BUNDLE, [
      ...flat(80, 20), ...flat(700, 11),
    ])
    expect(r.totalAddressableSavingUsd).toBeLessThan(r.currentMonthlyUsd)
    expect(r.totalAddressableSavingUsd).toBeGreaterThan(0)
  })

  it('scales the daily series by the moves, so tier sizing stays sequenced', () => {
    // ContainerLogV2 leaves for Basic. The tier must be sized on what remains.
    // The move is kept small deliberately: above the material threshold the
    // daily shape is refused outright, which the reconciliation suite covers.
    const withMove = [
      'TableName\tPlan\tBillableMB',
      `SigninLogs\tAnalytics\t${380 * 1000 * 31}`,
      `ContainerLogV2\tAnalytics\t${20 * 1000 * 31}`,
    ].join('\n')
    const r = analyseUsage(parseUsagePaste(withMove, 31), STATIC_PRICING_BUNDLE, flat(400))
    expect(r.analyticsGbPerDayAfterMoves).toBeCloseTo(380, 1)
    // The series is rescaled to the per-table paste and then to what remains,
    // so its mean is exactly the post-move volume — one base for every figure.
    expect(r.dailySizing!.meanGbPerDay).toBeCloseTo(380, 1)
  })
})

describe('reconciling two independent pastes', () => {
  // Both bugs below were found in review, and both are the "measured against
  // different bases" family this codebase has now shipped three times.

  const perTable = (gbPerDay: number) => [
    'TableName\tPlan\tBillableMB',
    `SigninLogs\tAnalytics\t${gbPerDay * 1000 * 31}`,
  ].join('\n')

  it('rescales the daily series to the per-table paste rather than mixing bases', () => {
    // Per-table says 440 GB/day; the daily paste (run days earlier) averages
    // 250. Previously the saving was computed from one and the tier cost from
    // the other, overstating by 76% and recommending a tier too low.
    const r = analyseUsage(parseUsagePaste(perTable(440), 31), STATIC_PRICING_BUNDLE, flat(250, 31))
    // The series used for sizing now has the per-table mean.
    expect(r.dailySizing!.meanGbPerDay).toBeCloseTo(440, 1)
    // Flat days mean the average is right, so the tier must match average sizing.
    expect(r.dailySizing!.disagrees).toBe(false)
    expect(r.recommendedTierLabel).toBe('400 GB/day')
  })

  it('flags two pastes that describe different periods', () => {
    const r = analyseUsage(parseUsagePaste(perTable(440), 31), STATIC_PRICING_BUNDLE, flat(250, 31))
    expect(r.dailyPasteDiverges).toBe(true)
  })

  it('does not flag divergence when the two pastes agree', () => {
    const r = analyseUsage(parseUsagePaste(perTable(300), 31), STATIC_PRICING_BUNDLE, flat(300, 31))
    expect(r.dailyPasteDiverges).toBe(false)
  })

  it('refuses the daily shape when a material share of volume moves tier', () => {
    // ContainerLogV2 is 90 of 200 GB/day and leaves for Basic. Neither query
    // says which days its volume fell on, so smearing it across every day
    // invents a distribution — which review showed picking a WORSE tier than
    // the average-based sizing it replaces.
    const paste = [
      'TableName\tPlan\tBillableMB',
      `SigninLogs\tAnalytics\t${110 * 1000 * 31}`,
      `ContainerLogV2\tAnalytics\t${90 * 1000 * 31}`,
    ].join('\n')
    const r = analyseUsage(parseUsagePaste(paste, 31), STATIC_PRICING_BUNDLE, flat(200, 31))
    expect(r.dailySizing).toBeNull()
    const opp = r.opportunities.find(o => o.kind === 'commitment-tier')
    expect(opp?.detail).toMatch(/cannot be used here/i)
    expect(opp?.detail).toMatch(/which days/i)
  })

  it('still uses the daily shape when the moves are immaterial', () => {
    const paste = [
      'TableName\tPlan\tBillableMB',
      `SigninLogs\tAnalytics\t${400 * 1000 * 31}`,
      `ContainerLogV2\tAnalytics\t${10 * 1000 * 31}`,
    ].join('\n')
    const r = analyseUsage(parseUsagePaste(paste, 31), STATIC_PRICING_BUNDLE, [
      ...flat(200, 25), ...flat(1500, 6),
    ])
    expect(r.dailySizing).not.toBeNull()
  })

  it('refuses to extrapolate a month from too few days', () => {
    const r = analyseUsage(parseUsagePaste(perTable(300), 31), STATIC_PRICING_BUNDLE, flat(300, 7))
    expect(r.dailySizing).toBeNull()
    expect(r.opportunities.find(o => o.kind === 'commitment-tier')?.detail)
      .toMatch(/only 7 days|too few/i)
  })

  it('never recommends a tier that costs more than average sizing on the same days', () => {
    // The property the whole feature rests on. Whatever it recommends, pricing
    // it against the days actually used must not lose to the average's choice.
    for (const days of [
      [...flat(95, 28), ...flat(3000, 3)],
      [...flat(400, 15), ...flat(120, 16)],
      flat(250, 31),
    ]) {
      const r = analyseUsage(parseUsagePaste(perTable(250), 31), STATIC_PRICING_BUNDLE, days)
      if (!r.dailySizing) continue
      expect(r.dailySizing.bestMonthlyUsd)
        .toBeLessThanOrEqual(r.dailySizing.meanBasedMonthlyUsd + 1e-6)
    }
  })
})
