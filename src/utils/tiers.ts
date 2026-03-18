import {
  CommitmentTier,
  PAYG_RATE_USD_PER_GB,
  EXCHANGE_RATE_USD_TO_GBP,
  DAYS_PER_MONTH,
  PricingBundle,
  STATIC_PRICING_BUNDLE,
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

export function costAtVolume(tier: CommitmentTier, gbPerDay: number): number {
  if (gbPerDay <= tier.gbPerDay) {
    return tier.dailyCostUsd
  }
  return tier.dailyCostUsd + (gbPerDay - tier.gbPerDay) * tier.effectiveRateUsd
}

export function breakevenForTier(tier: CommitmentTier, paygRate: number = PAYG_RATE_USD_PER_GB): number {
  return tier.dailyCostUsd / paygRate
}

export function computeTierOptions(
  billableGbPerDay: number,
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
  fxRate: number = EXCHANGE_RATE_USD_TO_GBP,
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
      label: `${tier.gbPerDay} GB/day`,
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
