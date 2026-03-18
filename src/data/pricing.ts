// Microsoft Sentinel pricing data — UK South, as of March 2026
// Update this file when Microsoft publishes new rates.

export const EXCHANGE_RATE_USD_TO_GBP = 0.79

// ─── Pay-As-You-Go ───────────────────────────────────────────────────────────

/** Combined Log Analytics + Sentinel PAYG rate, USD per GB */
export const PAYG_RATE_USD_PER_GB = 5.20

// ─── Commitment Tiers ────────────────────────────────────────────────────────

export interface CommitmentTier {
  /** Committed GB per day */
  gbPerDay: number
  /** Daily cost in USD */
  dailyCostUsd: number
  /** Effective USD per GB at this tier */
  effectiveRateUsd: number
  /** Saving percentage vs PAYG (0–1) */
  savingsVsPayg: number
  /** True while the 50 GB preview promotion is active (until March 2027) */
  isPreviewPromo?: boolean
}

/** Average days per month used for monthly cost calculations */
export const DAYS_PER_MONTH = 30.44

export const COMMITMENT_TIERS: CommitmentTier[] = [
  { gbPerDay: 50,   dailyCostUsd: 50   * 3.80, effectiveRateUsd: 3.80, savingsVsPayg: 0.27, isPreviewPromo: true },
  { gbPerDay: 100,  dailyCostUsd: 100  * 3.35, effectiveRateUsd: 3.35, savingsVsPayg: 0.36 },
  { gbPerDay: 200,  dailyCostUsd: 200  * 3.15, effectiveRateUsd: 3.15, savingsVsPayg: 0.39 },
  { gbPerDay: 500,  dailyCostUsd: 500  * 2.92, effectiveRateUsd: 2.92, savingsVsPayg: 0.44 },
  { gbPerDay: 1000, dailyCostUsd: 1000 * 2.70, effectiveRateUsd: 2.70, savingsVsPayg: 0.48 },
  { gbPerDay: 2000, dailyCostUsd: 2000 * 2.54, effectiveRateUsd: 2.54, savingsVsPayg: 0.51 },
  { gbPerDay: 5000, dailyCostUsd: 5000 * 2.43, effectiveRateUsd: 2.43, savingsVsPayg: 0.53 },
]

// ─── Data Lake Pricing ───────────────────────────────────────────────────────

export const DATA_LAKE_RATE_USD_PER_GB = 0.15
export const DATA_LAKE_COMPRESSION_RATIO = 6           // 6:1 compression for retention billing
export const DATA_LAKE_QUERY_RATE_USD_PER_GB = 0.005   // per GB scanned (uncompressed)
export const ANALYTICS_ARCHIVE_RATE_USD_PER_GB_PER_MONTH = 0.023
export const DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH = 0.02

// ─── Retention Strategy ───────────────────────────────────────────────────────

export type RetentionStrategy = 'analytics-extended' | 'data-lake-mirror'

export const RETENTION_STRATEGIES = {
  analyticsExtended: {
    id: 'analytics-extended' as RetentionStrategy,
    label: 'Analytics Extended Retention',
    description: 'Full KQL performance. Higher cost.',
    ratePerGbMonth: 0.023,
    compressionRatio: 1,
    maxYears: 2,
    queryIncluded: true,
  },
  dataLakeMirror: {
    id: 'data-lake-mirror' as RetentionStrategy,
    label: 'Mirror to Data Lake',
    description: '6:1 compression. Slower queries. ~85% cheaper.',
    ratePerGbMonth: 0.02,
    compressionRatio: 6,
    maxYears: 12,
    queryIncluded: false,
    queryCostPerGb: 0.005,
  },
} as const

/** Mirror retention options — starts at 90 (Analytics free window); excludes 30d (native Data Lake only) */
export const DATA_LAKE_MIRROR_RETENTION_OPTIONS = [90, 180, 365, 730, 1095, 1825, 2555, 3650, 4380]

// ─── Log Sources ─────────────────────────────────────────────────────────────

export type LogSourceGroup =
  | 'identity'
  | 'microsoft-defender'
  | 'microsoft-365'
  | 'azure-platform'
  | 'network'
  | 'infrastructure'
  | 'third-party'

/**
 * Optional presets that override the default GB/day range for a source.
 * Shown as a selector in the source row (e.g. Windows audit policy, O365 workloads).
 */
export interface LogSourceVariant {
  id: string
  label: string
  /** Short description shown as a hint in the UI */
  description?: string
  /** Overrides gbPerDeviceRange on the parent source */
  gbPerDeviceRange?: [number, number]
  /** Overrides gbPer1000UsersRange on the parent source */
  gbPer1000UsersRange?: [number, number]
}

export interface LogSource {
  id: string
  label: string
  /** Logical group for organised display in the source list */
  group: LogSourceGroup
  /**
   * Whether daily ingestion scales with user count or with a specific device/
   * infrastructure count. User-based sources use gbPer1000UsersRange;
   * device-based sources use gbPerDeviceRange + defaultDeviceCount.
   */
  scaleBy: 'users' | 'devices'
  /** GB/day per 1,000 users — used when scaleBy === 'users' */
  gbPer1000UsersRange?: [number, number]
  /** GB/day per device/server/instance — used when scaleBy === 'devices' */
  gbPerDeviceRange?: [number, number]
  /** Human-readable label shown on the count control, e.g. "Windows servers" */
  deviceLabel?: string
  /** Seed count shown in the control before the user changes it */
  defaultDeviceCount?: number
  /**
   * Optional presets that let the user select different volume profiles
   * (e.g. audit policy level, O365 workload scope).
   */
  variants?: LogSourceVariant[]
  /** Default variant id to use when none is explicitly selected */
  defaultVariantId?: string
  /**
   * When true, the source row shows a direct GB/day input instead of
   * device count × rate. Used for sources where volume is too variable
   * to estimate from a per-device rate (e.g. custom application logs).
   */
  manualGbPerDay?: boolean
  /** True if Microsoft does not charge Sentinel ingestion for this source */
  isFree: boolean
  /** Extra nuance shown in the UI */
  notes?: string
  /**
   * When true, this source's Analytics-tier ingestion counts toward the
   * Defender for Servers Plan 2 free allowance. Windows workloads only.
   */
  p2Eligible?: boolean
}

export const LOG_SOURCES: LogSource[] = [

  // ── Identity & Entra ──────────────────────────────────────────────────────
  {
    id: 'entra-id',
    label: 'Entra ID Sign-in & Audit',
    group: 'identity',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.5, 3.0],
    isFree: false,
    notes: 'Conditional access, MFA, and audit events; partially covered with E5 licensing',
  },
  {
    id: 'entra-id-protection',
    label: 'Entra ID Protection',
    group: 'identity',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.1, 0.5],
    isFree: false,
    notes: 'Risk detections and risky sign-in events; separate from standard Entra ID logs',
  },

  // ── Microsoft Defender ────────────────────────────────────────────────────
  {
    id: 'mde',
    label: 'Microsoft Defender for Endpoint',
    group: 'microsoft-defender',
    scaleBy: 'users',
    gbPer1000UsersRange: [2.0, 10.0],
    isFree: false,
    notes: 'Raw advanced hunting tables; incidents synced via XDR connector are free',
  },
  {
    id: 'mdi',
    label: 'Microsoft Defender for Identity',
    group: 'microsoft-defender',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.3, 2.0],
    isFree: false,
  },
  {
    id: 'mdo',
    label: 'Microsoft Defender for Office 365',
    group: 'microsoft-defender',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.3, 1.5],
    isFree: false,
  },
  {
    id: 'mdca',
    label: 'Microsoft Defender for Cloud Apps',
    group: 'microsoft-defender',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.3, 2.5],
    isFree: false,
    notes: 'Partially covered with E5 licensing',
  },
  {
    id: 'mdc',
    label: 'Microsoft Defender for Cloud',
    group: 'microsoft-defender',
    scaleBy: 'devices',
    gbPerDeviceRange: [0.2, 1.5],
    deviceLabel: 'Azure VMs / servers',
    defaultDeviceCount: 10,
    isFree: false,
    notes: 'Security alerts, recommendations, and adaptive network hardening events',
  },

  // ── Microsoft 365 ─────────────────────────────────────────────────────────
  {
    id: 'o365-audit',
    label: 'Office 365 / M365 Audit Logs',
    group: 'microsoft-365',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.1, 1.0],   // default shown when no variant selected
    isFree: false,
    notes: 'Volume varies greatly by workload scope; management activity may be free',
    variants: [
      {
        id: 'exchange',
        label: 'Exchange only',
        description: 'Email audit events only',
        gbPer1000UsersRange: [0.05, 0.3],
      },
      {
        id: 'exchange-sharepoint',
        label: 'Exchange + SharePoint',
        description: 'Incl. OneDrive events',
        gbPer1000UsersRange: [0.1, 0.6],
      },
      {
        id: 'all',
        label: 'All workloads',
        description: 'Incl. Teams + DLP',
        gbPer1000UsersRange: [0.1, 1.0],
      },
    ],
    defaultVariantId: 'exchange-sharepoint',
  },
  {
    id: 'intune',
    label: 'Microsoft Intune',
    group: 'microsoft-365',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.1, 0.5],
    isFree: false,
    notes: 'Device compliance, configuration, and management events',
  },

  // ── Azure Platform ────────────────────────────────────────────────────────
  {
    id: 'azure-activity',
    label: 'Azure Activity Logs',
    group: 'azure-platform',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.05, 0.5],
    isFree: true,
  },
  {
    id: 'key-vault',
    label: 'Azure Key Vault',
    group: 'azure-platform',
    scaleBy: 'devices',
    gbPerDeviceRange: [0.05, 0.3],
    deviceLabel: 'Key Vaults',
    defaultDeviceCount: 3,
    isFree: false,
    notes: 'Diagnostic logs for access to secrets, certificates, and keys',
  },

  // ── Network ───────────────────────────────────────────────────────────────
  {
    id: 'azure-firewall',
    label: 'Azure Firewall',
    group: 'network',
    scaleBy: 'devices',
    gbPerDeviceRange: [3.0, 40.0],
    deviceLabel: 'Azure Firewalls',
    defaultDeviceCount: 2,
    isFree: false,
  },
  {
    id: 'nsg-flow',
    label: 'NSG Flow Logs',
    group: 'network',
    scaleBy: 'devices',
    gbPerDeviceRange: [5.0, 50.0],
    deviceLabel: 'VNETs / NSGs',
    defaultDeviceCount: 2,
    isFree: false,
    notes: 'Extremely high volume — strongly recommended for Data Lake tier',
  },
  {
    id: 'waf',
    label: 'Web Application Firewall (WAF)',
    group: 'network',
    scaleBy: 'devices',
    gbPerDeviceRange: [0.5, 5.0],
    deviceLabel: 'WAF instances',
    defaultDeviceCount: 1,
    isFree: false,
    notes: 'Azure Application Gateway WAF or Front Door WAF',
  },
  {
    id: 'dns',
    label: 'DNS Logs',
    group: 'network',
    scaleBy: 'devices',
    gbPerDeviceRange: [0.5, 8.0],
    deviceLabel: 'DNS servers',
    defaultDeviceCount: 2,
    isFree: false,
    notes: 'Very high volume on busy servers — strongly recommended for Data Lake tier',
  },
  {
    id: 'third-party-firewall',
    label: 'Third-party Firewall (Palo Alto, Fortinet, etc.)',
    group: 'network',
    scaleBy: 'devices',
    gbPerDeviceRange: [1.0, 20.0],
    deviceLabel: 'Firewall devices',
    defaultDeviceCount: 3,
    isFree: false,
  },
  {
    id: 'vpn-ztna',
    label: 'VPN / Zero Trust (Zscaler, Cisco, Fortinet)',
    group: 'network',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.3, 1.5],
    isFree: false,
    notes: 'Authentication and session events via CEF/Syslog connector',
  },

  // ── Third-party & Custom ──────────────────────────────────────────────────
  {
    id: 'email-gateway',
    label: 'Email Gateway (Mimecast, Proofpoint, etc.)',
    group: 'third-party',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.5, 2.0],
    isFree: false,
    notes: 'CEF format via Syslog connector; common in UK mid-market alongside or instead of MDO',
  },
  {
    id: 'custom-app',
    label: 'Custom Application Logs',
    group: 'third-party',
    scaleBy: 'users',           // not used — manualGbPerDay overrides
    manualGbPerDay: true,
    isFree: false,
    notes: 'Enter your expected daily volume directly — varies too widely to estimate per-instance',
  },
]

// ─── Billing Rules ───────────────────────────────────────────────────────────

export const BILLING_RULES = {
  overageAtTierRate: true,
  downgradeWaitDays: 31,
  defaultRetentionDays: 90,
  promoTierExpiryDate: '2027-03-31',
  minimumTierWithoutPromoGbPerDay: 100,
}

// ─── Pricing Bundle ──────────────────────────────────────────────────────────

/**
 * A region-specific snapshot of all pricing values that vary by Azure region.
 * Passed down through context so all calculations use consistent prices.
 */
export interface PricingBundle {
  paygRateUsd: number
  commitmentTiers: CommitmentTier[]
  dataLakeRateUsd: number
  analyticsExtendedRetentionRateUsd: number
  dataLakeRetentionRateUsd: number
  dataLakeQueryRateUsd: number
}

export const STATIC_PRICING_BUNDLE: PricingBundle = {
  paygRateUsd: PAYG_RATE_USD_PER_GB,
  commitmentTiers: COMMITMENT_TIERS,
  dataLakeRateUsd: DATA_LAKE_RATE_USD_PER_GB,
  analyticsExtendedRetentionRateUsd: ANALYTICS_ARCHIVE_RATE_USD_PER_GB_PER_MONTH,
  dataLakeRetentionRateUsd: DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
  dataLakeQueryRateUsd: DATA_LAKE_QUERY_RATE_USD_PER_GB,
}
