import { ServerWorkload } from '../data/serverWorkloads'
import { TshirtSize, getSizeMultiplier, interpolateRange } from '../data/tshirtSizes'
import { LogTierKey, getTierDefinition } from '../data/logTiers'
import { PricingBundle, LogSourceGroup, DATA_LAKE_COMPRESSION_RATIO } from '../data/pricing'
import { SourceEstimateRow } from './ingestion'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeServerWorkloadRows(
  workloads: ServerWorkload[],
  counts: Record<string, number>,
  levels: Record<string, string>,
  sizeOverrides: Record<string, TshirtSize>,
  globalSize: TshirtSize,
  logTiers: Record<string, LogTierKey>,
  retentionDays: Record<string, number>,
  pricing: PricingBundle,
  fxRate: number,
): SourceEstimateRow[] {
  void fxRate  // reserved for future per-region display

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

    // Log tier
    const logTier: LogTierKey = (logTiers[workload.id] as LogTierKey | undefined) ?? 'analytics'
    const tierDef = getTierDefinition(logTier)

    // Daily cost
    const logTierRate = logTier === 'data-lake' ? pricing.dataLakeRateUsd : pricing.paygRateUsd
    const dailyCostUsd = round2(gbPerDay * logTierRate)

    // Retention
    const selectedRetention = retentionDays[workload.id] ?? tierDef.freeRetentionDays
    let retentionMonthlyCostUsd = 0
    if (logTier === 'data-lake') {
      const extraDays = Math.max(0, selectedRetention - tierDef.freeRetentionDays)
      retentionMonthlyCostUsd = round2((gbPerDay / DATA_LAKE_COMPRESSION_RATIO) * extraDays * pricing.dataLakeRetentionRateUsd)
    } else {
      // analytics-tier with data-lake-mirror strategy (default)
      const extraDays = Math.max(0, selectedRetention - 90)
      retentionMonthlyCostUsd = round2((gbPerDay / DATA_LAKE_COMPRESSION_RATIO) * extraDays * pricing.dataLakeRetentionRateUsd)
    }

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
      retentionStrategy: 'data-lake-mirror',
      dailyCostUsd,
      retentionDays: selectedRetention,
      retentionMonthlyCostUsd,
    })
  }

  return rows
}
