import { ServerWorkload } from '../data/serverWorkloads'
import { TshirtSize, getSizeMultiplier, interpolateRange } from '../data/tshirtSizes'
import { LogTierKey, getTierDefinition } from '../data/logTiers'
import { PricingBundle, LogSourceGroup, RetentionStrategy } from '../data/pricing'
import { getDefaultTier } from '../data/tierPlacement'
import { SourceEstimateRow, retentionCostUsd } from './ingestion'
import { round2 } from './round'

export function computeServerWorkloadRows(
  workloads: ServerWorkload[],
  counts: Record<string, number>,
  levels: Record<string, string>,
  sizeOverrides: Record<string, TshirtSize>,
  globalSize: TshirtSize,
  logTiers: Record<string, LogTierKey>,
  retentionDays: Record<string, number>,
  pricing: PricingBundle,
  retentionStrategies: Record<string, RetentionStrategy> = {},
): SourceEstimateRow[] {
  const rows: SourceEstimateRow[] = []

  for (const workload of workloads) {
    const count = counts[workload.id] ?? 0
    if (count <= 0) continue

    // Collection level
    const levelId = levels[workload.id] ?? workload.defaultLevel
    const level = workload.collectionLevels.find(l => l.id === levelId) ?? workload.collectionLevels[0]

    // T-shirt size multiplier (per-workload override or global)
    const multiplier = getSizeMultiplier(sizeOverrides[workload.id] ?? globalSize)

    // GB/day
    const gbPerServerPerDay = interpolateRange(
      level.gbPerServerPerDay.min,
      level.gbPerServerPerDay.max,
      multiplier,
    )
    const gbPerDay = round2(gbPerServerPerDay * count)

    // Log tier. Falls back to the placement recommendation rather than always
    // Analytics, so ws-print and lx-general land on Data Lake as tierPlacement.ts
    // intends. Those recommendations previously could never take effect.
    const recommended = getDefaultTier(workload.id)
    const logTier: LogTierKey =
      (logTiers[workload.id] as LogTierKey | undefined) ??
      (recommended === 'data-lake' ? 'data-lake' : 'analytics')
    const tierDef = getTierDefinition(logTier)

    // Daily cost
    const logTierRate = logTier === 'data-lake' ? pricing.dataLakeRateUsd : pricing.paygRateUsd
    const dailyCostUsd = round2(gbPerDay * logTierRate)

    // Retention — shares summariseIngestion's implementation so the two cannot
    // drift apart, and so the free window comes from the tier definition.
    const selectedRetention = retentionDays[workload.id] ?? tierDef.freeRetentionDays
    const strategy: RetentionStrategy =
      logTier === 'data-lake'
        ? 'data-lake-mirror'
        : (retentionStrategies[workload.id] ?? 'data-lake-mirror')
    const retentionMonthlyCostUsd = retentionCostUsd(
      gbPerDay, selectedRetention, logTier, strategy, pricing,
    )

    rows.push({
      source: {
        id: workload.id,
        label: workload.name,
        group: 'infrastructure' as LogSourceGroup,
        scaleBy: 'devices',
        isFree: false,
        p2Eligible: workload.p2Eligible,
      },
      gbPerDay,
      logTier,
      retentionStrategy: strategy,
      dailyCostUsd,
      retentionDays: selectedRetention,
      retentionMonthlyCostUsd,
    })
  }

  return rows
}
