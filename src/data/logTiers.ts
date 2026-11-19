import {
  PAYG_RATE_USD_PER_GB,
  DATA_LAKE_RATE_USD_PER_GB,
  ANALYTICS_INTERACTIVE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
  DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
} from './pricing'

// Defender ISOC is not a third log tier. It is an alternative bill for
// Analytics-plan ingestion — a flat per-GB rate with no commitment tiers —
// carried on the pricing bundle as defenderIsocRateUsd. Data Lake ingestion
// stays on its own meters either way.

export type LogTierKey = 'analytics' | 'data-lake'

export interface LogTierDefinition {
  key: LogTierKey
  label: string
  /** USD per GB ingested. Sourced from pricing.ts — never hardcode here. */
  rateUsdPerGb: number
  /** Interactive retention days included in the ingestion price at no extra charge */
  freeRetentionDays: number
  /** Selectable retention periods shown in the UI (days) */
  retentionOptions: number[]
  /**
   * Monthly cost in USD per GB of data held beyond freeRetentionDays.
   * Sourced from pricing.ts — never hardcode here.
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
    rateUsdPerGb: PAYG_RATE_USD_PER_GB,
    freeRetentionDays: 90,
    retentionOptions: [90, 180, 365, 730],
    extendedRetentionRateUsdPerGbPerMonth: ANALYTICS_INTERACTIVE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
    kqlCapability: 'Full KQL — all tables, alerts, workbooks',
    commitmentTiersApply: true,
  },
  {
    key: 'data-lake',
    label: 'Data Lake',
    rateUsdPerGb: DATA_LAKE_RATE_USD_PER_GB,
    // Lake-only tables have no included free retention after general
    // availability. The 30-day window was a public-preview term. Storage
    // charges start as soon as the data is in the lake. Analytics keeps its
    // own 90 days, and a mirror of Analytics data stays free while that
    // window lasts.
    // https://techcommunity.microsoft.com/blog/microsoftsentinelblog/microsoft-sentinel-data-lake-faq/4457728
    freeRetentionDays: 0,
    retentionOptions: [30, 90, 180, 365, 730, 1095, 1825, 2555, 3650, 4380],
    extendedRetentionRateUsdPerGbPerMonth: DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
    kqlCapability: 'Limited KQL — simple queries only',
    commitmentTiersApply: false,
  },
]

export const DEFAULT_LOG_TIER: LogTierKey = 'analytics'

export function getTierDefinition(key: LogTierKey): LogTierDefinition {
  return LOG_TIER_DEFINITIONS.find(d => d.key === key)!
}

/**
 * Retention period used when the user has not chosen one.
 *
 * That is the included window when the window is one of the selectable
 * options (Analytics: 90 days). Lake-only retention has no included window,
 * so the selector starts at the shortest option and the whole period is billed.
 */
export function defaultSelectedRetentionDays(key: LogTierKey): number {
  const def = getTierDefinition(key)
  if (def.retentionOptions.includes(def.freeRetentionDays)) return def.freeRetentionDays
  return def.retentionOptions[0]
}
