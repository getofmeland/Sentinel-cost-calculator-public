import { LOG_SOURCES, LogSource, PAYG_RATE_USD_PER_GB, EXCHANGE_RATE_USD_TO_GBP, DATA_LAKE_COMPRESSION_RATIO, RetentionStrategy, PricingBundle, STATIC_PRICING_BUNDLE } from '../data/pricing'
import { LogTierKey, DEFAULT_LOG_TIER, getTierDefinition } from '../data/logTiers'
import { interpolateRange } from '../data/tshirtSizes'
import { round2 } from './round'

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

/**
 * Monthly cost of retaining a source's data beyond its tier's free window.
 *
 * Retention is a flow-to-stock conversion: ingesting `gbPerDay` and holding it
 * for `extraDays` leaves `gbPerDay × extraDays` GB at rest, which is what the
 * per-GB-per-month rate is charged against.
 *
 * The free window is read from the tier definition rather than assumed. It was
 * previously hardcoded as 90 on the Analytics paths while the Data Lake path
 * read the tier definition, so editing logTiers.ts silently changed one and not
 * the other.
 *
 * Shared by summariseIngestion and computeServerWorkloadRows, which had
 * divergent copies of this arithmetic.
 */
export function retentionCostUsd(
  gbPerDay: number,
  selectedRetentionDays: number,
  logTier: LogTierKey,
  strategy: RetentionStrategy,
  pricing: PricingBundle,
): number {
  const freeWindowDays = getTierDefinition(logTier).freeRetentionDays
  const extraDays = Math.max(0, selectedRetentionDays - freeWindowDays)
  if (extraDays === 0) return 0

  // Analytics extended retention keeps the data queryable in place, so it is
  // billed uncompressed at the interactive rate. Everything else — native Data
  // Lake and Analytics mirrored to the lake — is billed on compressed volume.
  if (logTier === 'analytics' && strategy === 'analytics-extended') {
    return round2(gbPerDay * extraDays * pricing.analyticsExtendedRetentionRateUsd)
  }
  return round2(
    (gbPerDay / DATA_LAKE_COMPRESSION_RATIO) * extraDays * pricing.dataLakeRetentionRateUsd,
  )
}

export function midpoint(range: [number, number]): number {
  return (range[0] + range[1]) / 2
}

/**
 * Coerce an untrusted numeric input to a non-negative, finite value.
 *
 * The React inputs already clamp keystrokes, but the calculation layer is
 * reachable from anywhere — shared URLs, presets, or a future embed. A negative
 * manual GB value used to subtract from the customer's total, and a NaN turned
 * every downstream figure into NaN, both silently.
 */
export function sanitiseQuantity(value: number | undefined, fallback = 0): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback
  return value
}

export function estimateSourceGbPerDay(
  source: LogSource,
  userCount: number,
  deviceCount?: number,
  selectedVariantId?: string,
  manualGbValue?: number,
  sizeMultiplier = 0.5,  // position within [min, max] range (0 = min, 1 = max)
): number {
  if (source.manualGbPerDay) return sanitiseQuantity(manualGbValue)

  const safeUserCount = sanitiseQuantity(userCount)

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
    const count = sanitiseQuantity(deviceCount, source.defaultDeviceCount ?? 0)
    return round2(interpolateRange(gbPerDeviceRange[0], gbPerDeviceRange[1], sizeMultiplier) * count)
  }
  if (gbPer1000UsersRange) {
    return round2(interpolateRange(gbPer1000UsersRange[0], gbPer1000UsersRange[1], sizeMultiplier) * (safeUserCount / 1000))
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
      const retentionMonthlyCostUsd = source.isFree
        ? 0
        : retentionCostUsd(gbPerDay, selectedRetention, logTier, effectiveStrategy, pricing)

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
