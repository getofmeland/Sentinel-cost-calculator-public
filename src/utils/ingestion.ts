import { LOG_SOURCES, LogSource, PAYG_RATE_USD_PER_GB, EXCHANGE_RATE_USD_TO_GBP, DATA_LAKE_COMPRESSION_RATIO, RetentionStrategy, PricingBundle, STATIC_PRICING_BUNDLE } from '../data/pricing'
import { LogTierKey, DEFAULT_LOG_TIER, getTierDefinition } from '../data/logTiers'
import { interpolateRange } from '../data/tshirtSizes'

export interface SourceEstimateRow {
  source: LogSource
  gbPerDay: number
  logTier: LogTierKey
  retentionStrategy: RetentionStrategy
  /** Daily ingestion cost in USD for this source at its chosen tier rate (0 for free sources) */
  dailyCostUsd: number
  /** Selected retention in days for this source */
  retentionDays: number
  /** Monthly cost in USD for retention beyond the free period (0 if within free window) */
  retentionMonthlyCostUsd: number
}

export interface IngestionSummary {
  rows: SourceEstimateRow[]
  totalGbPerDay: number
  /** Non-free GB/day across all tiers */
  billableGbPerDay: number
  freeGbPerDay: number
  /** Non-free GB/day on Analytics tier — eligible for commitment tier discounts */
  analyticsGbPerDay: number
  /** Non-free GB/day on Data Lake tier */
  dataLakeGbPerDay: number
  /** Analytics PAYG daily cost USD — commitment tier savings on top of this */
  analyticsDailyCostUsd: number
  dataLakeDailyCostUsd: number
  /** Sum of all tier daily costs USD */
  totalDailyCostUsd: number
  totalDailyCostGbp: number
  /** Total monthly retention cost across all sources (sum of all three strategies) */
  retentionMonthlyCostUsd: number
  retentionMonthlyCostGbp: number
  /** Analytics sources using analytics-extended strategy */
  analyticsExtendedRetentionMonthlyCostUsd: number
  /** Analytics sources using data-lake-mirror strategy */
  dataLakeMirrorRetentionMonthlyCostUsd: number
  /** Native Data Lake tier sources (always uses compression) */
  dataLakeNativeRetentionMonthlyCostUsd: number
  // Kept for backwards compat — these now alias the new 3-way split
  analyticsRetentionMonthlyCostUsd: number
  dataLakeRetentionMonthlyCostUsd: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function midpoint(range: [number, number]): number {
  return (range[0] + range[1]) / 2
}

export function estimateSourceGbPerDay(
  source: LogSource,
  userCount: number,
  deviceCount?: number,
  selectedVariantId?: string,
  manualGbValue?: number,
  sizeMultiplier = 0.5,  // position within [min, max] range (0 = min, 1 = max)
): number {
  if (source.manualGbPerDay) return manualGbValue ?? 0

  // Apply variant overrides when a variant is selected
  let gbPerDeviceRange = source.gbPerDeviceRange
  let gbPer1000UsersRange = source.gbPer1000UsersRange
  const variantId = selectedVariantId ?? source.defaultVariantId
  if (variantId && source.variants) {
    const variant = source.variants.find(v => v.id === variantId)
    if (variant) {
      if (variant.gbPerDeviceRange) gbPerDeviceRange = variant.gbPerDeviceRange
      if (variant.gbPer1000UsersRange) gbPer1000UsersRange = variant.gbPer1000UsersRange
    }
  }

  if (source.scaleBy === 'devices' && gbPerDeviceRange) {
    const count = deviceCount ?? source.defaultDeviceCount ?? 0
    return round2(interpolateRange(gbPerDeviceRange[0], gbPerDeviceRange[1], sizeMultiplier) * count)
  }
  if (gbPer1000UsersRange) {
    return round2(interpolateRange(gbPer1000UsersRange[0], gbPer1000UsersRange[1], sizeMultiplier) * (userCount / 1000))
  }
  return 0
}

export function summariseIngestion(
  selectedIds: Set<string>,
  userCount: number,
  deviceCounts: Record<string, number>,
  logTiers: Record<string, LogTierKey>,
  retentionDays: Record<string, number>,
  retentionStrategies: Record<string, RetentionStrategy> = {},
  selectedVariants: Record<string, string> = {},
  manualGbValues: Record<string, number> = {},
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
  fxRate: number = EXCHANGE_RATE_USD_TO_GBP,
  sourceSizeMultipliers: Record<string, number> = {},
  additionalRows: SourceEstimateRow[] = [],
): IngestionSummary {
  const rows: SourceEstimateRow[] = LOG_SOURCES
    .filter(source => selectedIds.has(source.id))
    .map(source => {
      const deviceCount = deviceCounts[source.id]
      const gbPerDay = estimateSourceGbPerDay(
        source, userCount, deviceCount,
        selectedVariants[source.id] ?? source.defaultVariantId,
        manualGbValues[source.id],
        sourceSizeMultipliers[source.id] ?? 0.5,
      )
      const logTier: LogTierKey = (logTiers[source.id] as LogTierKey | undefined) ?? DEFAULT_LOG_TIER
      const tierDef = getTierDefinition(logTier)
      const logTierRate = logTier === 'data-lake' ? pricing.dataLakeRateUsd : pricing.paygRateUsd
      const dailyCostUsd = source.isFree ? 0 : round2(gbPerDay * logTierRate)

      const effectiveStrategy: RetentionStrategy =
        logTier === 'data-lake'
          ? 'data-lake-mirror'   // sentinel value for native DL — aggregated separately
          : (retentionStrategies[source.id] ?? 'data-lake-mirror')

      const selectedRetention = retentionDays[source.id] ?? tierDef.freeRetentionDays
      let retentionMonthlyCostUsd = 0
      if (!source.isFree) {
        if (logTier === 'data-lake') {
          // BUG FIX: apply compression ratio (was previously missing)
          const extraDays = Math.max(0, selectedRetention - tierDef.freeRetentionDays) // free = 30
          retentionMonthlyCostUsd = round2((gbPerDay / DATA_LAKE_COMPRESSION_RATIO) * extraDays * pricing.dataLakeRetentionRateUsd)
        } else if (effectiveStrategy === 'analytics-extended') {
          const extraDays = Math.max(0, selectedRetention - 90)
          retentionMonthlyCostUsd = round2(gbPerDay * extraDays * pricing.analyticsExtendedRetentionRateUsd)
        } else {
          // data-lake-mirror: compressed, 90-day Analytics hot window is free
          const extraDays = Math.max(0, selectedRetention - 90)
          retentionMonthlyCostUsd = round2((gbPerDay / DATA_LAKE_COMPRESSION_RATIO) * extraDays * pricing.dataLakeRetentionRateUsd)
        }
      }

      return { source, gbPerDay, logTier, retentionStrategy: effectiveStrategy, dailyCostUsd, retentionDays: selectedRetention, retentionMonthlyCostUsd }
    })

  // Merge pre-computed server workload rows
  const allRows = [...rows, ...additionalRows]

  const totalGbPerDay = round2(allRows.reduce((s, r) => s + r.gbPerDay, 0))
  const freeGbPerDay = round2(
    allRows.filter(r => r.source.isFree).reduce((s, r) => s + r.gbPerDay, 0),
  )

  const nonFreeRows = allRows.filter(r => !r.source.isFree)
  const analyticsGbPerDay = round2(
    nonFreeRows.filter(r => r.logTier === 'analytics').reduce((s, r) => s + r.gbPerDay, 0),
  )
  const dataLakeGbPerDay = round2(
    nonFreeRows.filter(r => r.logTier === 'data-lake').reduce((s, r) => s + r.gbPerDay, 0),
  )
  const billableGbPerDay = round2(analyticsGbPerDay + dataLakeGbPerDay)

  const analyticsDailyCostUsd = round2(analyticsGbPerDay * pricing.paygRateUsd)
  const dataLakeDailyCostUsd = round2(
    nonFreeRows.filter(r => r.logTier === 'data-lake').reduce((s, r) => s + r.dailyCostUsd, 0),
  )
  const totalDailyCostUsd = round2(analyticsDailyCostUsd + dataLakeDailyCostUsd)
  const totalDailyCostGbp = round2(totalDailyCostUsd * fxRate)

  const analyticsExtendedRetentionMonthlyCostUsd = round2(
    allRows.filter(r => r.logTier === 'analytics' && r.retentionStrategy === 'analytics-extended')
        .reduce((s, r) => s + r.retentionMonthlyCostUsd, 0)
  )
  const dataLakeMirrorRetentionMonthlyCostUsd = round2(
    allRows.filter(r => r.logTier === 'analytics' && r.retentionStrategy === 'data-lake-mirror')
        .reduce((s, r) => s + r.retentionMonthlyCostUsd, 0)
  )
  const dataLakeNativeRetentionMonthlyCostUsd = round2(
    allRows.filter(r => r.logTier === 'data-lake')
        .reduce((s, r) => s + r.retentionMonthlyCostUsd, 0)
  )
  const retentionMonthlyCostUsd = round2(
    analyticsExtendedRetentionMonthlyCostUsd + dataLakeMirrorRetentionMonthlyCostUsd + dataLakeNativeRetentionMonthlyCostUsd
  )
  const retentionMonthlyCostGbp = round2(retentionMonthlyCostUsd * fxRate)

  // Backwards-compat aliases
  const analyticsRetentionMonthlyCostUsd = round2(analyticsExtendedRetentionMonthlyCostUsd + dataLakeMirrorRetentionMonthlyCostUsd)
  const dataLakeRetentionMonthlyCostUsd = dataLakeNativeRetentionMonthlyCostUsd

  return {
    rows: allRows,
    totalGbPerDay,
    billableGbPerDay,
    freeGbPerDay,
    analyticsGbPerDay,
    dataLakeGbPerDay,
    analyticsDailyCostUsd,
    dataLakeDailyCostUsd,
    totalDailyCostUsd,
    totalDailyCostGbp,
    retentionMonthlyCostUsd,
    retentionMonthlyCostGbp,
    analyticsExtendedRetentionMonthlyCostUsd,
    dataLakeMirrorRetentionMonthlyCostUsd,
    dataLakeNativeRetentionMonthlyCostUsd,
    analyticsRetentionMonthlyCostUsd,
    dataLakeRetentionMonthlyCostUsd,
  }
}

// Keep these exports for any files that may still import them directly
export { PAYG_RATE_USD_PER_GB, EXCHANGE_RATE_USD_TO_GBP }
