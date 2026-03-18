export type LogTierKey = 'analytics' | 'data-lake'

export interface LogTierDefinition {
  key: LogTierKey
  label: string
  /** USD per GB ingested. Analytics rate should match PAYG_RATE_USD_PER_GB in pricing.ts */
  rateUsdPerGb: number
  /** Interactive retention days included in the ingestion price at no extra charge */
  freeRetentionDays: number
  /** Selectable retention periods shown in the UI (days) */
  retentionOptions: number[]
  /**
   * Monthly cost in USD per GB of data held beyond freeRetentionDays.
   * Analytics extended interactive: $0.12/GB/month.
   * Data Lake long-term archive: $0.024/GB/month.
   * Formula: gbPerDay × extraDays × this rate = monthly USD cost.
   */
  extendedRetentionRateUsdPerGbPerMonth: number
  kqlCapability: string
  /** Only Analytics-tier logs are eligible for commitment tier discounts */
  commitmentTiersApply: boolean
}

export const LOG_TIER_DEFINITIONS: LogTierDefinition[] = [
  {
    key: 'analytics',
    label: 'Analytics',
    rateUsdPerGb: 5.20,          // keep in sync with PAYG_RATE_USD_PER_GB in pricing.ts
    freeRetentionDays: 90,
    retentionOptions: [90, 180, 365, 730],
    extendedRetentionRateUsdPerGbPerMonth: 0.023,
    kqlCapability: 'Full KQL — all tables, alerts, workbooks',
    commitmentTiersApply: true,
  },
  {
    key: 'data-lake',
    label: 'Data Lake',
    rateUsdPerGb: 0.15,
    freeRetentionDays: 30,
    retentionOptions: [30, 90, 180, 365, 730, 1095, 1825, 2555, 3650, 4380],
    extendedRetentionRateUsdPerGbPerMonth: 0.02,
    kqlCapability: 'Limited KQL — simple queries only',
    commitmentTiersApply: false,
  },
]

export const DEFAULT_LOG_TIER: LogTierKey = 'analytics'

export function getTierDefinition(key: LogTierKey): LogTierDefinition {
  return LOG_TIER_DEFINITIONS.find(d => d.key === key)!
}
