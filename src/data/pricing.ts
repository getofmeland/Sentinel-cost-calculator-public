// Microsoft Sentinel pricing data — UK South, verified 6 August 2026.
//
// Every rate here was taken from the Azure Retail Prices API, not from a
// pricing page or from memory:
//
//   https://prices.azure.com/api/retail/prices
//     ?$filter=serviceName eq 'Sentinel' and armRegionName eq 'uksouth'
//
// Regional rates differ substantially — UK South runs roughly 1.25x the
// East US base — so re-verify against the API when changing region focus
// rather than scaling these values.
//
// This file is the only place a rate literal may appear. Everything else
// imports from here.

// Fallback exchange rates, used when the live FX fetch is unavailable.
// The user can override either from the UI.
export const EXCHANGE_RATE_USD_TO_GBP = 0.7425
export const EXCHANGE_RATE_USD_TO_EUR = 0.8657

// ─── Pay-As-You-Go ───────────────────────────────────────────────────────────

/**
 * Combined Log Analytics + Sentinel PAYG rate, USD per GB.
 * Meter: Sentinel / "Pay-as-you-go Analysis", UK South.
 *
 * Under Microsoft's simplified pricing (effective 2023-07-01) this single
 * meter covers both the Log Analytics and Sentinel charge, so the
 * calculator does not add them separately.
 */
export const PAYG_RATE_USD_PER_GB = 5.38

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

/**
 * Committed GB/day and the published daily cost in USD, exactly as the retail
 * API reports them (meter: "{n} GB Commitment Tier Capacity Reservation").
 *
 * Only these two numbers are authoritative. The effective per-GB rate and the
 * saving against PAYG are derived below — previously they were hardcoded
 * alongside, and drifted far enough that the file claimed a 53% saving when
 * Microsoft's published maximum is 52%.
 */
const COMMITMENT_TIER_DAILY_COST_USD: Array<[gbPerDay: number, dailyCostUsd: number]> = [
  [50, 201.5625],   // public preview promotion
  [100, 370],
  [200, 685],
  [300, 1000],
  [400, 1296.66],
  [500, 1581.25],
  [1000, 3100],
  [2000, 6000],
  [5000, 14437.5],
  [10000, 27800],
  [25000, 66812.5],
  [50000, 128250],
]

/** GB/day tiers sold as a time-limited preview promotion rather than standard rate card */
const PREVIEW_PROMO_TIERS = new Set([50])

export const COMMITMENT_TIERS: CommitmentTier[] = COMMITMENT_TIER_DAILY_COST_USD.map(
  ([gbPerDay, dailyCostUsd]) => {
    const effectiveRateUsd = dailyCostUsd / gbPerDay
    return {
      gbPerDay,
      dailyCostUsd,
      effectiveRateUsd,
      savingsVsPayg: 1 - effectiveRateUsd / PAYG_RATE_USD_PER_GB,
      isPreviewPromo: PREVIEW_PROMO_TIERS.has(gbPerDay) ? true : undefined,
    }
  },
)

// ─── Data Lake Pricing ───────────────────────────────────────────────────────

/**
 * Total USD per GB ingested into the Data Lake tier.
 * Microsoft bills this as two separate meters that both apply:
 *   Sentinel / "Data lake ingestion Data Processed"  $0.0625
 *   Sentinel / "Data processing Data Processed"      $0.125
 * Reading only the first understates lake ingestion threefold.
 */
export const DATA_LAKE_RATE_USD_PER_GB = 0.0625 + 0.125

export const DATA_LAKE_COMPRESSION_RATIO = 6              // 6:1 compression for retention billing

/** Meter: Sentinel / "Data lake query Data Analyzed" — per GB scanned (uncompressed) */
export const DATA_LAKE_QUERY_RATE_USD_PER_GB = 0.00625

/**
 * Extending Analytics *interactive* retention beyond the free 90 days.
 * Meter: Log Analytics / "Analytics Logs Data Retention".
 *
 * This is the rate the calculator's "Analytics Extended Retention" strategy
 * needs — that strategy keeps full KQL against the data, so it is interactive
 * retention, not archive. The two were previously conflated at the archive
 * rate, understating two-year retention costs by more than fivefold.
 */
export const ANALYTICS_INTERACTIVE_RETENTION_RATE_USD_PER_GB_PER_MONTH = 0.13

/**
 * Archive (non-interactive) retention. Meter: Azure Monitor / "Data Archive".
 * Kept distinct so the two can never silently collapse into one another again.
 * Not currently used by any retention strategy.
 */
export const ANALYTICS_ARCHIVE_RATE_USD_PER_GB_PER_MONTH = 0.025

/** Meter: Sentinel / "Data lake storage Data Stored" */
export const DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH = 0.024

// ─── Basic and Auxiliary Log Plans ───────────────────────────────────────────
//
// Two further table plans, billed per GB at flat rates. Analyse mode needs them
// because measured ingestion reports a Plan per table, and pricing a Basic table
// at the Analytics rate would overstate its cost roughly fivefold.
//
// Critically, these are NOT eligible for commitment tier discounts:
//   "Commitment tiers apply only to Analytics Logs ingestion. Ingestion of Basic
//    Logs and Auxiliary Logs is billed at flat per-GB rates and isn't covered by
//    commitment-tier discounts."
// So a commitment tier must only ever be sized against Analytics-plan volume.
// https://learn.microsoft.com/en-us/azure/azure-monitor/logs/cost-logs

/** Meter: Sentinel / "Basic Logs Analysis" */
export const BASIC_LOGS_RATE_USD_PER_GB = 1.13

/**
 * Meter: Sentinel / "Classic Auxiliary Logs Analysis".
 * Microsoft now labels this plan "Auxiliary / Lake" in the portal — lake-only
 * ingestion reports under it — while the API value remains "Auxiliary".
 */
export const AUXILIARY_LOGS_RATE_USD_PER_GB = 0.0625

// ─── Data Lake Compute ───────────────────────────────────────────────────────
//
// Two meters bill compute rather than data volume. Both report a unit of
// "1 Hour" in the retail API, but that hour is a *vCore*-hour, not a pool-hour:
// the billed quantity is vCores x wall-clock time. Microsoft's billing page
// settles this with worked examples —
//
//   cost = 49 x (Price per vCore hour) x (5/60)     a 5-minute graph build
//   cost =  6 x (Price per vCore hour) x (1/60)     a 1-minute graph query
//
// The distinction is worth 49x on a graph build, so it is spelled out here.
// https://learn.microsoft.com/en-us/azure/sentinel/billing

/** Meter: Sentinel / "Graph" — per vCore-hour. Custom graphs only (Preview). */
export const GRAPH_RATE_USD_PER_VCORE_HOUR = 3.75

/** Meter: Sentinel / "Advanced Data Insights" — per vCore-hour. Notebook/Spark compute. */
export const ADVANCED_DATA_INSIGHTS_RATE_USD_PER_VCORE_HOUR = 0.1875

/**
 * There is a single graph SKU. Builds run far wider than queries, which is why
 * rebuild frequency dominates graph cost: a build costs 49 x the hourly rate,
 * i.e. $183.75 per wall-clock hour at the UK South rate.
 */
export const GRAPH_BUILD_VCORES = 49
export const GRAPH_QUERY_VCORES = 6

/** Microsoft documents a one-minute floor for graph *queries* only — not builds. */
export const GRAPH_QUERY_MIN_MINUTES = 1

/**
 * Microsoft's illustrative build duration. This is the figure from their worked
 * example, NOT a measured typical value — they publish no sizing guidance, and
 * never document what makes a build take longer (data volume, entity count,
 * graph complexity are all unstated). Build duration is the dominant input to
 * graph cost, so the UI exposes it and labels its provenance honestly.
 */
export const GRAPH_ILLUSTRATIVE_BUILD_MINUTES = 5

/** Notebook pools available for data lake sessions and jobs, in vCores. */
export const ADI_POOL_VCORES = [12, 32, 80] as const
export type AdiPoolVCores = typeof ADI_POOL_VCORES[number]

/**
 * Spark session start-up is billable dead time — Microsoft's service limits put
 * it at 5-6 minutes before any user code runs. On the 80-vCore pool that is
 * roughly $1.50 per session before anything useful happens.
 */
export const ADI_SESSION_STARTUP_MINUTES = 6

// ─── Retention Strategy ───────────────────────────────────────────────────────

export type RetentionStrategy = 'analytics-extended' | 'data-lake-mirror'

export const RETENTION_STRATEGIES = {
  analyticsExtended: {
    id: 'analytics-extended' as RetentionStrategy,
    label: 'Analytics Extended Retention',
    description: 'Full KQL performance. Higher cost.',
    ratePerGbMonth: ANALYTICS_INTERACTIVE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
    compressionRatio: 1,
    maxYears: 2,
    queryIncluded: true,
  },
  dataLakeMirror: {
    id: 'data-lake-mirror' as RetentionStrategy,
    label: 'Mirror to Data Lake',
    // 6:1 compression means $0.024/GB/month bills as $0.004 per raw GB,
    // against $0.13 for interactive retention — roughly 97% cheaper.
    description: '6:1 compression. Slower queries. ~97% cheaper.',
    ratePerGbMonth: DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
    compressionRatio: DATA_LAKE_COMPRESSION_RATIO,
    maxYears: 12,
    queryIncluded: false,
    queryCostPerGb: DATA_LAKE_QUERY_RATE_USD_PER_GB,
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
   * Devices per user, when the population genuinely tracks headcount.
   *
   * The default seeding grows device counts by the square root of user count,
   * which suits firewalls, DNS servers and domain controllers — you do not buy
   * twenty times the firewalls for twenty times the staff. Workstations are the
   * exception: they scale roughly one to one, and √-scaling a laptop estate
   * from 500 to 10,000 users seeds 2,236 machines instead of 10,000.
   */
  devicesPerUser?: number
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
    // Risk detections are exception events, not a per-user stream: a healthy
    // 1,000-user tenant produces tens to low hundreds per day at 1-2 KB each,
    // well under 1 MB/day. The previous [0.1, 0.5] range was 25-50x too high.
    //
    // FREE, corrected after audit. The ID Protection connector writes exactly
    // one table — SecurityAlert — and Microsoft's free-data list carries the
    // row "Microsoft Entra ID Protection | SecurityAlert (IPC)". The billable
    // risk tables this source used to charge for (AADUserRiskEvents,
    // AADRiskyUsers, AADRiskyServicePrincipals, AADServicePrincipalRiskEvents)
    // are written by the Microsoft ENTRA ID connector, verified against
    // connectorIndex.ts — so charging for them here also double-counted them
    // against entra-id.
    gbPer1000UsersRange: [0.002, 0.02],
    isFree: true,
    notes: 'Free — the connector writes only SecurityAlert, which is on Microsoft\'s free-data list. The billable risk tables belong to the Entra ID connector',
  },

  // ── Microsoft Defender ────────────────────────────────────────────────────
  {
    id: 'mde',
    label: 'Microsoft Defender for Endpoint',
    group: 'microsoft-defender',
    // SCALES BY DEVICES, not users — corrected against a real measurement.
    //
    // The old model was 2-10 GB per 1,000 users, which silently assumed about
    // one onboarded endpoint per user and modelled MDE-on-servers nowhere at
    // all. A 70-user tenant with 231 onboarded devices measured 2.04 GB/day of
    // Device* tables; the per-user model predicted 0.31. It understated by 6.5x,
    // because the denominator was wrong, not the rate.
    //
    // Microsoft still publishes no per-device figure — two audits confirmed the
    // absence, and its own guidance is to measure your own tenant. This range is
    // anchored on two points and is an assumption, not a citation:
    //   - a practitioner measurement of ~6.9 MB/user/day across ALL M365
    //     advanced hunting sources, with MDE "by far the largest share"
    //   - the 231-device tenant above, whose blended figure is 8.8 MB/device/day
    //     across 69 workstations and 162 servers
    // Solving those together puts workstations near 4.5 and servers near 10.7,
    // which is why the two populations are separate sources rather than one
    // blended rate. A single number would embed a device-mix assumption exactly
    // as the old one embedded a devices-per-user assumption.
    scaleBy: 'devices',
    gbPerDeviceRange: [0.002, 0.008],
    deviceLabel: 'Onboarded workstations',
    defaultDeviceCount: 500,
    devicesPerUser: 1,
    isFree: false,
    notes: 'Raw Device* advanced hunting tables; incidents synced via the XDR connector are free. Streaming is opt-in per table, so a partial selection sits below this. Servers are counted separately',
  },
  {
    id: 'mde-servers',
    label: 'Defender for Endpoint — Servers',
    group: 'microsoft-defender',
    // Servers generate more Device* telemetry than workstations: more
    // processes, more network connections, and they are on continuously. The
    // rate here is solved from the same measurement rather than guessed, but it
    // rests on one tenant and should be treated as a starting point.
    //
    // This is NOT the same data as the Windows server workloads further down.
    // Those model SecurityEvent collected by the agent; this models the Device*
    // tables streamed from Defender. A server onboarded to both produces both,
    // which is why the counts are asked for separately.
    scaleBy: 'devices',
    gbPerDeviceRange: [0.005, 0.020],
    deviceLabel: 'MDE-onboarded servers',
    defaultDeviceCount: 25,
    isFree: false,
    notes: 'Device* telemetry from servers onboarded to Defender for Endpoint — separate from the Windows Security Events those servers also produce',
  },
  {
    id: 'mdi',
    label: 'Microsoft Defender for Identity',
    group: 'microsoft-defender',
    scaleBy: 'users',
    // ASSUMPTION — no Microsoft figure exists. The MDI connector writes only
    // SecurityAlert, which is free; the billable Identity* tables arrive via
    // the Defender XDR connector as an opt-in. Volume tracks DOMAIN CONTROLLERS
    // and directory change rate, not headcount: IdentityQueryEvents is LDAP and
    // SAMR traffic against DCs, and only IdentityLogonEvents follows users.
    gbPer1000UsersRange: [0.3, 2.0],
    isFree: false,
    notes: 'Billable only via Defender XDR advanced hunting streaming — the connector itself writes only free SecurityAlert. Scales with domain controllers rather than user count',
  },
  {
    id: 'mdo',
    label: 'Microsoft Defender for Office 365',
    group: 'microsoft-defender',
    scaleBy: 'users',
    // ASSUMPTION — no Microsoft figure exists. The MDO connector writes only
    // SecurityAlert, which is free; the billable EmailEvents/EmailUrlInfo
    // tables arrive via the Defender XDR connector as an opt-in. Volume also
    // tracks MAIL FLOW, not headcount — EmailEvents is one row per message per
    // recipient, so two same-sized tenants can differ by an order of magnitude.
    gbPer1000UsersRange: [0.3, 1.5],
    isFree: false,
    notes: 'Billable only via Defender XDR advanced hunting streaming — the connector itself writes only free SecurityAlert. Scales with mail flow rather than user count',
  },
  {
    id: 'mdca',
    label: 'Microsoft Defender for Cloud Apps',
    group: 'microsoft-defender',
    scaleBy: 'users',
    // ASSUMPTION — no Microsoft figure exists, and this conflates two unrelated
    // streams. McasShadowItReporting is native to the MDCA connector and scales
    // with discovered apps and uploaded firewall feeds, not users; CloudAppEvents
    // arrives via Defender XDR as an opt-in and duplicates Office 365 activity
    // already modelled free under o365-audit.
    gbPer1000UsersRange: [0.3, 2.5],
    isFree: false,
    notes: 'Partially covered with E5 licensing. Shadow IT reporting scales with discovered apps; CloudAppEvents is billable only via Defender XDR streaming and overlaps free OfficeActivity',
  },
  {
    id: 'mdc',
    label: 'Microsoft Defender for Cloud',
    group: 'microsoft-defender',
    scaleBy: 'devices',
    // Defender for Cloud alerts are per-subscription and event-driven, not
    // per-machine telemetry. The previous [0.2, 1.5] per-VM range produced
    // 8.5 GB/day of Analytics volume at the default 10 VMs — around £1,000/month
    // of cost that does not exist.
    gbPerDeviceRange: [0.005, 0.02],
    deviceLabel: 'Azure VMs / servers',
    defaultDeviceCount: 10,
    // SecurityAlert from Defender for Cloud is on Microsoft's free data list.
    // ALWAYS_FREE_SOURCES in licenceBenefits.ts already said so; pricing.ts
    // disagreed with it and charged for the data.
    isFree: true,
    // SecurityAlert is on the Defender for Servers P2 eligible-table list.
    p2Eligible: true,
    notes: 'Security alerts are free to ingest; only continuous-export recommendation streams are billable',
  },

  // ── Microsoft 365 ─────────────────────────────────────────────────────────
  {
    id: 'o365-audit',
    label: 'Office 365 / M365 Audit Logs',
    group: 'microsoft-365',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.1, 1.0],   // default shown when no variant selected
    // Microsoft's free data list covers Office 365 audit logs in full —
    // SharePoint activity, Exchange admin activity and Teams. The OfficeActivity
    // table is the only table this source maps to, so all variants are free.
    // ALWAYS_FREE_SOURCES already listed this; pricing.ts charged for it anyway.
    isFree: true,
    notes: 'Free to ingest — SharePoint, Exchange admin and Teams audit records are all on Microsoft\'s free data list',
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
    label: 'VNet Flow Logs (Traffic Analytics)',
    group: 'network',
    scaleBy: 'devices',
    // Raw flow logs are written to Azure Storage, not Log Analytics. What
    // reaches the workspace is the Traffic Analytics output, which aggregates
    // flows sharing a source IP, destination IP, port and protocol — Microsoft's
    // own worked example collapses 100 raw records into one. The previous
    // [5, 50] band was a raw-flow figure applied to the reduced stream.
    gbPerDeviceRange: [0.5, 6.0],
    deviceLabel: 'VNets',
    defaultDeviceCount: 2,
    isFree: false,
    notes: 'Aggregated Traffic Analytics output, not raw flows. NSG flow logs retire 30 September 2027 — VNet flow logs are the replacement',
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
  /** Per vCore-hour, not per pool-hour — see GRAPH_RATE_USD_PER_VCORE_HOUR */
  graphRateUsdPerVCoreHour: number
  /** Per vCore-hour, not per pool-hour */
  advancedDataInsightsRateUsdPerVCoreHour: number
  /** Flat per-GB; NOT covered by commitment tiers */
  basicLogsRateUsd: number
  /** Flat per-GB; NOT covered by commitment tiers */
  auxiliaryLogsRateUsd: number
}

export const STATIC_PRICING_BUNDLE: PricingBundle = {
  paygRateUsd: PAYG_RATE_USD_PER_GB,
  commitmentTiers: COMMITMENT_TIERS,
  dataLakeRateUsd: DATA_LAKE_RATE_USD_PER_GB,
  analyticsExtendedRetentionRateUsd: ANALYTICS_INTERACTIVE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
  dataLakeRetentionRateUsd: DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
  dataLakeQueryRateUsd: DATA_LAKE_QUERY_RATE_USD_PER_GB,
  graphRateUsdPerVCoreHour: GRAPH_RATE_USD_PER_VCORE_HOUR,
  advancedDataInsightsRateUsdPerVCoreHour: ADVANCED_DATA_INSIGHTS_RATE_USD_PER_VCORE_HOUR,
  basicLogsRateUsd: BASIC_LOGS_RATE_USD_PER_GB,
  auxiliaryLogsRateUsd: AUXILIARY_LOGS_RATE_USD_PER_GB,
}
