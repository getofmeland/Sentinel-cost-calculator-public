import {
  CommitmentTier,
  PAYG_RATE_USD_PER_GB,
  EXCHANGE_RATE_USD_TO_GBP,
  DAYS_PER_MONTH,
  PricingBundle,
  STATIC_PRICING_BUNDLE,
  BILLING_RULES,
  ISOC_INCLUDED_ANALYTICS_SOURCE_IDS,
} from '../data/pricing'

export interface TierOption {
  label: string
  isPayg: boolean
  tier?: CommitmentTier
  dailyCostUsd: number
  dailyCostGbp: number
  monthlyCostUsd: number
  monthlyCostGbp: number
  /** null for PAYG row; negative means more expensive than PAYG */
  savingsVsPaygPct: number | null
  isRecommended: boolean
  /** Volume at which this tier undercuts PAYG; null for PAYG */
  breakevenGbPerDay: number | null
}

/** The single spelling of a tier's name, so labels cannot drift between callers. */
export function tierLabel(tier: CommitmentTier): string {
  return `${tier.gbPerDay} GB/day`
}

export function costAtVolume(tier: CommitmentTier, gbPerDay: number): number {
  if (gbPerDay <= tier.gbPerDay) {
    return tier.dailyCostUsd
  }
  return tier.dailyCostUsd + (gbPerDay - tier.gbPerDay) * tier.effectiveRateUsd
}

export function breakevenForTier(tier: CommitmentTier, paygRate: number = PAYG_RATE_USD_PER_GB): number {
  return tier.dailyCostUsd / paygRate
}

/**
 * Monthly cost of Analytics volume on the flat Defender ISOC meter.
 * Commitment tiers do not apply, and the figure is the gross volume: the
 * Sentinel licence grants are credits on Sentinel meters, not on this one.
 */
export function defenderIsocMonthlyUsd(analyticsGbPerDay: number, rateUsdPerGb: number): number {
  return analyticsGbPerDay * rateUsdPerGb * DAYS_PER_MONTH
}

export interface IsocAnalyticsSplit {
  /** Additional data billed on the ISOC pay-as-you-go meter */
  paidGbPerDay: number
  /** Native Defender and Entra data the billing page includes in the benefit */
  includedGbPerDay: number
}

/**
 * Split Analytics volume into ISOC-included benefit data and data that stays
 * on the paid meter. Free sources are in neither: they are not billed anyway.
 */
export function splitIsocAnalyticsGb(
  rows: ReadonlyArray<{ source: { id: string; isFree?: boolean }; gbPerDay: number; logTier: string }>,
): IsocAnalyticsSplit {
  let paid = 0
  let included = 0
  for (const row of rows) {
    if (row.logTier !== 'analytics' || row.source.isFree) continue
    if (ISOC_INCLUDED_ANALYTICS_SOURCE_IDS.has(row.source.id)) included += row.gbPerDay
    else paid += row.gbPerDay
  }
  return {
    paidGbPerDay: Math.round(paid * 100) / 100,
    includedGbPerDay: Math.round(included * 100) / 100,
  }
}

/** True on the signup deadline and earlier. New customers cannot take the 50 GB promo after that day. */
export function promoTierSignupOpen(asOf: Date = new Date()): boolean {
  return asOf.toISOString().slice(0, 10) <= BILLING_RULES.promoTierSignupDeadline
}

export function computeTierOptions(
  billableGbPerDay: number,
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
  fxRate: number = EXCHANGE_RATE_USD_TO_GBP,
  asOf: Date = new Date(),
): TierOption[] {
  const tiers = promoTierSignupOpen(asOf)
    ? pricing.commitmentTiers
    : pricing.commitmentTiers.filter(tier => !tier.isPreviewPromo)
  const paygDailyCostUsd = billableGbPerDay * pricing.paygRateUsd

  const paygOption: TierOption = {
    label: 'Pay-as-you-go',
    isPayg: true,
    tier: undefined,
    dailyCostUsd: paygDailyCostUsd,
    dailyCostGbp: paygDailyCostUsd * fxRate,
    monthlyCostUsd: paygDailyCostUsd * DAYS_PER_MONTH,
    monthlyCostGbp: paygDailyCostUsd * DAYS_PER_MONTH * fxRate,
    savingsVsPaygPct: null,
    isRecommended: false,
    breakevenGbPerDay: null,
  }

  const tierOptions: TierOption[] = tiers.map(tier => {
    const dailyCostUsd = costAtVolume(tier, billableGbPerDay)
    const savingsVsPaygPct =
      paygDailyCostUsd > 0 ? (paygDailyCostUsd - dailyCostUsd) / paygDailyCostUsd : null

    return {
      label: tierLabel(tier),
      isPayg: false,
      tier,
      dailyCostUsd,
      dailyCostGbp: dailyCostUsd * fxRate,
      monthlyCostUsd: dailyCostUsd * DAYS_PER_MONTH,
      monthlyCostGbp: dailyCostUsd * DAYS_PER_MONTH * fxRate,
      savingsVsPaygPct,
      isRecommended: false,
      breakevenGbPerDay: breakevenForTier(tier, pricing.paygRateUsd),
    }
  })

  const allOptions = [paygOption, ...tierOptions]

  // Find minimum cost — tie-break: prefer lower commitment (i.e. first in array)
  const minCost = Math.min(...allOptions.map(o => o.dailyCostUsd))
  const recommended = allOptions.find(o => o.dailyCostUsd === minCost)
  if (recommended) {
    recommended.isRecommended = true
  }

  return allOptions
}
