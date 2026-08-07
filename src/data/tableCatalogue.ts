import type { TierRecommendation } from './tierPlacement'

/**
 * Table-keyed reference for Analyse mode.
 *
 * `sentinelTables.ts` is organised by log source and covers what the estimator
 * models. A real workspace contains far more than that — multi-cloud
 * connectors, threat intelligence, and a great deal of operational data that
 * has nothing to do with security but is paying Sentinel rates to sit there.
 *
 * A tester ran the tool against a live tenant and AWSCloudTrail, AWSVPCFlow and
 * ThreatIntelIndicators all came back unrecognised, which is what prompted this.
 *
 * Attributes come from each table's reference page at
 * learn.microsoft.com/azure/azure-monitor/reference/tables/<lowercased-name>,
 * which publishes Categories, Solutions, Basic support and Auxiliary/Lake
 * support. Those are far better signals than guessing from the name.
 */

export type DataCategory =
  /** Detection or investigation value — belongs in a SIEM */
  | 'security'
  /** Infrastructure and application monitoring — pays Sentinel rates for no security benefit */
  | 'operational'
  /** Genuinely both, or a catch-all carrying a mix */
  | 'mixed'
  /** Sentinel's own metering and health */
  | 'platform'

export interface CatalogueEntry {
  /** Canonical casing, as Microsoft spells it */
  name: string
  description: string
  category: DataCategory
  /** False when Microsoft does not charge for ingestion */
  billable: boolean
  /**
   * Whether the table can be switched to the Auxiliary/Lake plan at all.
   *
   * This is a hard product constraint, not a preference: Microsoft publishes
   * "Auxiliary / Lake table support: No" for a number of tables, and no amount
   * of wanting a cheaper bill will move them. Recommending a move for one of
   * these would be impossible advice.
   */
  lakeCapable: boolean
  recommendedTier: TierRecommendation
  /** Something a consultant can repeat to a client without rephrasing */
  reason: string
  /** Surfaced as a caveat when it applies */
  caveat?: string
}

const AWS: CatalogueEntry[] = [
  {
    name: 'AWSCloudTrail',
    description: 'AWS management-plane audit trail — API calls, IAM changes, console sign-ins.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: 'Where cloud compromise shows up first. Keep it queryable in real time.',
  },
  {
    name: 'AWSVPCFlow',
    description: 'Per-flow VPC network telemetry.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Huge volume, little detection value in isolation, but essential for scoping an incident.',
  },
  {
    name: 'AWSGuardDuty',
    description: 'Findings from AWS GuardDuty.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: 'Low volume, high signal — already triaged by AWS, correlate it immediately.',
  },
  {
    name: 'AWSCloudWatch',
    description: 'AWS performance and billing metrics.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Operational metrics, not security data. Consider whether it belongs in this workspace at all.',
  },
  {
    name: 'AWSWAF',
    description: 'AWS Web Application Firewall traffic records.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Request-rate volume; useful for reconstructing an attack rather than alerting live.',
  },
  {
    name: 'AWSRoute53Resolver',
    description: 'Route 53 DNS resolver query logs.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Classic high-volume DNS data — the evidence trail for beaconing, queried after the fact.',
  },
  {
    name: 'AWSNetworkFirewallFlow',
    description: 'AWS Network Firewall per-flow records.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Flow data with the same economics as VPC flow logs.',
  },
  {
    name: 'AWSS3ServerAccess',
    description: 'Per-request S3 bucket access logs.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Microsoft names cloud storage access logs as a canonical example of secondary data.',
  },
  {
    name: 'AWSSecurityHubFindings',
    description: 'Aggregated AWS Security Hub findings and control status.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: 'Low volume and pre-triaged — worth alerting on directly.',
  },
  {
    name: 'AWSALBAccessLogsData',
    description: 'AWS Elastic Load Balancer access logs.',
    category: 'mixed', billable: true, lakeCapable: false, recommendedTier: 'analytics',
    reason: 'Load balancer request logs, high volume for what they tell you.',
    caveat: 'Microsoft supports neither the Lake plan nor DCR transformations for this table, so you pay Analytics rates regardless. Reduce it at source in AWS.',
  },
]

const GCP: CatalogueEntry[] = [
  {
    name: 'GCPAuditLogs',
    description: 'GCP admin activity, data access and access transparency logs.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: "GCP's equivalent of CloudTrail — the control-plane record you detect against.",
  },
  {
    name: 'GCPVPCFlow',
    description: 'GCP VPC network flow telemetry.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Same economics as any flow log: enormous volume, investigative value only.',
  },
  {
    name: 'GoogleCloudSCC',
    description: 'Google Security Command Center findings.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: 'Pre-triaged findings feed — low volume, high value.',
  },
  {
    name: 'GKEAudit',
    description: 'Google Kubernetes Engine cluster and workload audit.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: 'Container control-plane activity is a real attack path.',
  },
  {
    name: 'GoogleWorkspaceReports',
    description: 'Google Workspace Admin SDK activity.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: "Google's answer to Office 365 audit — but unlike OfficeActivity, this one is billable.",
  },
  {
    name: 'GCPIAM',
    description: 'GCP identity and access management audit.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: 'Privilege escalation evidence — keep it live.',
  },
  {
    name: 'GCPDNS',
    description: 'GCP Cloud DNS query logs.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'DNS query volume; investigate after the fact rather than alert on every lookup.',
  },
  {
    name: 'GCPMonitoring',
    description: 'GCP Cloud Monitoring metrics.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Operational metrics sitting in a security workspace.',
  },
  {
    name: 'GCPIDS',
    description: 'Google Cloud IDS intrusion detection alerts.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'analytics',
    reason: 'Alert feed — low volume, act on it.',
  },
]

const THREAT_INTEL: CatalogueEntry[] = [
  {
    name: 'ThreatIntelIndicators',
    description: 'STIX threat intelligence indicators — IPs, domains, hashes, URLs.',
    category: 'security', billable: true, lakeCapable: false, recommendedTier: 'analytics',
    reason: 'Your detection rules join against this in real time. Microsoft classes TI feeds as primary security data.',
    caveat:
      'Microsoft does not offer the Lake plan for this table, so it cannot be tiered down. Control the cost '
      + 'instead by stripping the raw STIX blob (project-away Data) and filtering at ingestion. Note it '
      + 'republishes your entire indicator set every 7-10 days, so cost tracks total active indicators, not new ones.',
  },
  {
    name: 'ThreatIntelObjects',
    description: 'STIX objects other than indicators — threat actors, attack patterns, relationships.',
    category: 'security', billable: true, lakeCapable: false, recommendedTier: 'analytics',
    reason: 'Context your analysts and rules resolve against.',
    caveat: 'No Lake plan support — cannot be tiered down.',
  },
  {
    name: 'ThreatIntelligenceIndicator',
    description: 'The previous threat intelligence table, replaced by ThreatIntelIndicators.',
    category: 'security', billable: true, lakeCapable: false, recommendedTier: 'analytics',
    reason: 'Legacy table. Microsoft stopped ingesting into it during 2025.',
    caveat:
      'Volume here in 2026 suggests something is still writing to a retired table, or that analytics rules '
      + 'still reference it. Worth checking your TI migration completed.',
  },
]

/** Operational data that attracts Sentinel charges for no security benefit. */
const OPERATIONAL: CatalogueEntry[] = [
  {
    name: 'Perf', description: 'Windows and Linux performance counters.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Infrastructure monitoring paying SIEM rates. No detection rule will ever query it.',
  },
  {
    name: 'InsightsMetrics', description: 'VM and container health metrics from Insights.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Platform health data, not security telemetry.',
  },
  {
    name: 'AzureMetrics', description: 'Azure resource platform metrics routed into logs.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Belongs in Azure Monitor rather than a Sentinel-enabled workspace.',
  },
  {
    name: 'ContainerLogV2', description: 'Container stdout and stderr from Container Insights.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Application output from AKS — routinely the single largest table in a workspace.',
  },
  {
    name: 'ContainerLog', description: 'Legacy container log table from Container Insights.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Application output from AKS. ContainerLogV2 is the current table.',
  },
  {
    name: 'Event', description: 'Windows System and Application event logs.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Non-security Windows events riding along on the same agent as SecurityEvent.',
  },
  {
    name: 'W3CIISLog', description: 'IIS web server access logs.',
    category: 'mixed', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: "Microsoft's own worked example of a high-volume table suited to cheaper storage.",
  },
  {
    name: 'LAQueryLogs', description: 'Audit of queries run against the workspace.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Usually trivial, but can spike badly with polling workbooks or automation.',
  },
  ...['AppTraces', 'AppRequests', 'AppDependencies', 'AppExceptions', 'AppPageViews',
    'AppMetrics', 'AppPerformanceCounters', 'AppEvents', 'AppAvailabilityResults',
  ].map((name): CatalogueEntry => ({
    name,
    description: 'Application Insights telemetry.',
    category: 'operational', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'Developer APM data attracting Sentinel charges because App Insights points at this workspace.',
  })),
]

const PLATFORM_AND_FREE: CatalogueEntry[] = [
  {
    name: 'Heartbeat', description: 'Agent liveness records.',
    category: 'platform', billable: false, lakeCapable: false, recommendedTier: 'free',
    reason: 'Free, and genuinely useful for spotting agents that have stopped reporting.',
  },
  {
    name: 'Usage', description: 'Hourly ingestion volume per table — the basis of this analysis.',
    category: 'platform', billable: false, lakeCapable: false, recommendedTier: 'free',
    reason: 'Free metering data.',
  },
  {
    name: 'Operation', description: 'Workspace operation records.',
    category: 'platform', billable: false, lakeCapable: false, recommendedTier: 'free',
    reason: 'Free.',
  },
  {
    name: 'SentinelHealth', description: 'Sentinel connector and rule health.',
    category: 'platform', billable: false, lakeCapable: false, recommendedTier: 'free',
    reason: 'Free — Microsoft states it is not billable.',
  },
  {
    name: 'SentinelAudit', description: 'Audit of changes to Sentinel configuration.',
    category: 'platform', billable: true, lakeCapable: false, recommendedTier: 'analytics',
    reason: 'Billable, unlike SentinelHealth — the two are easily confused.',
  },
  {
    name: 'AdditionalExtensions',
    description: 'Overflow fields from CEF events that do not fit the standard schema.',
    category: 'security', billable: true, lakeCapable: true, recommendedTier: 'data-lake',
    reason: 'A Microsoft-documented cost trap — content is variable and volume can exceed the CEF table itself.',
  },
  {
    name: 'IdentityInfo', description: 'User and group context synced by UEBA.',
    category: 'security', billable: true, lakeCapable: false, recommendedTier: 'analytics',
    reason: 'Billable at normal rates despite looking like reference data.',
    caveat: 'Re-ingests on group changes — renaming a 50-member group re-ingests 50 records, and nested groups cascade.',
  },
]

export const TABLE_CATALOGUE: CatalogueEntry[] = [
  ...AWS, ...GCP, ...THREAT_INTEL, ...OPERATIONAL, ...PLATFORM_AND_FREE,
]

const BY_NAME = new Map(TABLE_CATALOGUE.map(e => [e.name.toLowerCase(), e]))

export function lookupTable(name: string): CatalogueEntry | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null
}

// ─── Pattern recognition for the long tail ───────────────────────────────────

export interface TableGuess {
  label: string
  category: DataCategory
  note: string
}

/**
 * Best-effort identification when a table is not catalogued, so the report says
 * something useful instead of "Unrecognised".
 *
 * Deliberately conservative: it names the likely family and stops. It never
 * produces a tier recommendation, because a guess about what a table contains
 * is not a basis for telling someone to move their data.
 */
export function guessFromName(name: string): TableGuess | null {
  const n = name.trim()
  const lower = n.toLowerCase()

  if (/^aws/i.test(n)) {
    return { label: 'AWS connector', category: 'security',
      note: 'An AWS data connector table not yet in our reference.' }
  }
  if (/^(gcp|google|gke)/i.test(n)) {
    return { label: 'Google Cloud connector', category: 'security',
      note: 'A GCP or Google Workspace connector table not yet in our reference.' }
  }
  if (/^(device|email|identity|alert|cloudapp|urlclick|behavior|exposure)/i.test(n)) {
    return { label: 'Defender XDR', category: 'security',
      note: 'Defender XDR advanced hunting data. Billable, but eligible for the M365 E5 data grant.' }
  }
  if (/^(aad|entra)/i.test(n)) {
    return { label: 'Entra ID', category: 'security',
      note: 'Entra ID logs. Billable, but eligible for the M365 E5 data grant.' }
  }
  if (/^app[A-Z]/.test(n)) {
    return { label: 'Application Insights', category: 'operational',
      note: 'Application performance telemetry — operational data paying Sentinel rates.' }
  }
  if (/^threatintel/i.test(n)) {
    return { label: 'Threat intelligence', category: 'security',
      note: 'Threat intelligence. Note these tables cannot be moved to the Lake plan.' }
  }
  if (lower.endsWith('_cl')) {
    // Deliberately not "your custom table" — many Microsoft and vendor
    // connectors write to _CL because they run on Functions or the codeless
    // framework. The suffix describes the schema, not who created it.
    return { label: 'Custom-schema table', category: 'mixed',
      note: 'Ingested with a custom schema — could be your own logging or a vendor connector. '
        + 'Check which connector writes to it before deciding anything.' }
  }
  return null
}
