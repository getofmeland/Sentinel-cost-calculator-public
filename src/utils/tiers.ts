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
  return { paidGbPerDay: paid, includedGbPerDay: included }
}

/**
 * Calendar date in Europe/London as YYYY-MM-DD.
 * 31 December is GMT (UTC+0), not British Summer Time. The London zone still
 * matters for dates that fall in BST, when an evening UTC timestamp is already
 * the next civil day in the UK.
 */
export function ukCalendarDate(asOf: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(asOf)
}

/** True on the signup deadline and earlier, in UK civil time. New estimates use this. */
export function promoTierSignupOpen(asOf: Date = new Date()): boolean {
  return ukCalendarDate(asOf) <= BILLING_RULES.promoTierSignupDeadline
}

/** True while a customer who signed up in time still holds the 50 GB price, in UK civil time. */
export function promoTierLockOpen(asOf: Date = new Date()): boolean {
  return ukCalendarDate(asOf) <= BILLING_RULES.promoTierExpiryDate
}

/**
 * Gigabytes that would be billed at the ISOC rate if every non-included source
 * were on Analytics. Included Defender and Entra data is $0 on Analytics, including
 * when it currently sits in the Data Lake, so it is not part of this baseline.
 */
export function isocAnalyticsBaselineGb(
  rows: ReadonlyArray<{ source: { id: string; isFree?: boolean }; gbPerDay: number; logTier: string }>,
  paidAnalyticsGbPerDay: number,
): number {
  const lakeGb = rows.reduce((sum, row) => {
    if (row.logTier !== 'data-lake' || row.source.isFree) return sum
    if (ISOC_INCLUDED_ANALYTICS_SOURCE_IDS.has(row.source.id)) return sum
    return sum + row.gbPerDay
  }, 0)
  return paidAnalyticsGbPerDay + lakeGb
}

/** Positive when ISOC costs less than the recommended classic Analytics month. */
export function isocSavingVersusClassicMonthly(classicAnalyticsMonthlyUsd: number, isocMonthlyUsd: number): number {
  return classicAnalyticsMonthlyUsd - isocMonthlyUsd
}

export function computeTierOptions(
  billableGbPerDay: number,
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
  fxRate: number = EXCHANGE_RATE_USD_TO_GBP,
  /**
   * New estimates pass promoTierSignupOpen(). Analyse mode passes
   * promoTierLockOpen(), which stays true until 31 March 2027. The 50 GB tier
   * stays on the ladder either way; this only controls the recommendation.
   */
  recommendPromoTier: boolean = true,
): TierOption[] {
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

  const tierOptions: TierOption[] = pricing.commitmentTiers.map(tier => {
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
  const candidates = recommendPromoTier
    ? allOptions
    : allOptions.filter(option => !option.tier?.isPreviewPromo)

  // Find minimum cost — tie-break: prefer lower commitment (i.e. first in array)
  const minCost = Math.min(...candidates.map(o => o.dailyCostUsd))
  const recommended = candidates.find(o => o.dailyCostUsd === minCost)
  if (recommended) {
    recommended.isRecommended = true
  }

  return allOptions
}
