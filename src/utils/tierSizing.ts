import { PricingBundle, STATIC_PRICING_BUNDLE, DAYS_PER_MONTH } from '../data/pricing'
import { costAtVolume, tierLabel } from './tiers'

/**
 * Sizing a commitment tier against a month of ACTUAL daily volume rather than
 * its average.
 *
 * WHY THE AVERAGE IS THE WRONG STATISTIC
 *
 * Commitment pricing is asymmetric, and only in one direction:
 *
 *   - Volume above your commitment bills at that tier's own discounted rate.
 *     Under-committing therefore costs almost nothing — you still get the
 *     discount on the overage.
 *   - A tier can only be LOWERED every 31 days. Over-committing is money spent
 *     on gigabytes you never sent, locked in for a month.
 *
 * At UK South rates the gap is roughly elevenfold: sitting one tier too high
 * costs about eleven times what sitting one tier too low does. Sizing to the
 * mean of a month that contained a migration, a retention backfill or a noisy
 * fortnight therefore over-commits systematically.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Nothing clever, and deliberately no percentile rule of thumb. Given the actual
 * daily figures it prices every tier against every observed day and picks the
 * cheapest total. `costAtVolume` already models overage correctly, so this is
 * exact arithmetic over real data rather than an estimate of a distribution.
 */

export interface DailySizingResult {
  /** Tier label minimising total cost across the observed days; null when PAYG wins */
  bestTierLabel: string | null
  bestMonthlyUsd: number
  /** What sizing on the mean alone would have chosen — the previous behaviour */
  meanBasedTierLabel: string | null
  meanBasedMonthlyUsd: number
  /** Positive when day-by-day sizing beats mean-based sizing */
  differenceMonthlyUsd: number
  /** True when the two approaches disagree, which is the interesting case */
  disagrees: boolean
  minGbPerDay: number
  medianGbPerDay: number
  maxGbPerDay: number
  meanGbPerDay: number
  dayCount: number
  /** Highest day ÷ median. Above ~1.5 the month is spiky enough to matter. */
  peakToMedianRatio: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** Total cost of a month of days under one tier, or under pay-as-you-go. */
function totalOverDays(
  days: number[],
  pricing: PricingBundle,
  tierIndex: number | null,
): number {
  if (tierIndex === null) {
    return days.reduce((a, gb) => a + gb * pricing.paygRateUsd, 0)
  }
  const tier = pricing.commitmentTiers[tierIndex]
  // A commitment is billed every day whether or not volume reaches it — that is
  // precisely what makes over-committing expensive, so it must not be skipped
  // on quiet days.
  return days.reduce((a, gb) => a + costAtVolume(tier, gb), 0)
}

export function sizeTierOnDailyVolume(
  analyticsGbByDay: number[],
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
): DailySizingResult | null {
  const days = analyticsGbByDay.filter(d => Number.isFinite(d) && d >= 0)
  if (days.length === 0) return null

  const sorted = [...days].sort((a, b) => a - b)
  const mean = days.reduce((a, b) => a + b, 0) / days.length
  const median = percentile(sorted, 0.5)

  // Scale each candidate's observed-period total to a month so the figures are
  // comparable with everything else the report shows.
  const toMonthly = (total: number) => (total / days.length) * DAYS_PER_MONTH

  const candidates: { label: string | null; monthly: number }[] = [
    { label: null, monthly: toMonthly(totalOverDays(days, pricing, null)) },
    ...pricing.commitmentTiers.map((t, i) => ({
      label: tierLabel(t),
      monthly: toMonthly(totalOverDays(days, pricing, i)),
    })),
  ]
  const best = candidates.reduce((a, b) => (b.monthly < a.monthly ? b : a))

  // What the mean alone would have picked: the cheapest tier evaluated at a
  // single flat volume, which is the behaviour this replaces.
  const meanCandidates: { label: string | null; monthly: number }[] = [
    { label: null, monthly: mean * pricing.paygRateUsd * DAYS_PER_MONTH },
    ...pricing.commitmentTiers.map(t => ({
      label: tierLabel(t),
      monthly: costAtVolume(t, mean) * DAYS_PER_MONTH,
    })),
  ]
  const meanBest = meanCandidates.reduce((a, b) => (b.monthly < a.monthly ? b : a))

  // Cost the mean-based CHOICE against the real days. Comparing the two
  // approaches' own headline figures would compare a fiction with a fact: the
  // mean-based number is what that tier would cost if every day were average,
  // which is not what the customer would actually be billed.
  const meanChoiceIndex = meanBest.label === null
    ? null
    : pricing.commitmentTiers.findIndex(t => tierLabel(t) === meanBest.label)
  const meanChoiceActual = toMonthly(
    totalOverDays(days, pricing, meanChoiceIndex === -1 ? null : meanChoiceIndex),
  )

  return {
    bestTierLabel: best.label,
    bestMonthlyUsd: best.monthly,
    meanBasedTierLabel: meanBest.label,
    meanBasedMonthlyUsd: meanChoiceActual,
    differenceMonthlyUsd: meanChoiceActual - best.monthly,
    disagrees: meanBest.label !== best.label,
    minGbPerDay: sorted[0],
    medianGbPerDay: median,
    maxGbPerDay: sorted[sorted.length - 1],
    meanGbPerDay: mean,
    dayCount: days.length,
    peakToMedianRatio: median > 0 ? sorted[sorted.length - 1] / median : 1,
  }
}
