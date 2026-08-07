import type { TierRecommendation } from './tierPlacement'
// Value import of data, type-only import back the other way — no runtime cycle.
import { EXTENDED_CATALOGUE } from './tableCatalogueExtended'

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
  /**
   * Whether the table supports the Basic plan.
   *
   * Recorded because it is the *only* cheaper plan available to a table that
   * cannot use the Lake tier, and the gap is large — Basic is roughly a fifth
   * of the Analytics rate. Nothing reads this yet: `TierRecommendation` has no
   * 'basic' member, so the engine cannot express the advice. Captured now, with
   * the values verified, so adding that tier is a change to the engine rather
   * than a fresh research exercise.
   */
  basicCapable: boolean
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
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Where cloud compromise shows up first. Keep it queryable in real time.',
  },
  {
    name: 'AWSVPCFlow',
    description: 'Per-flow VPC network telemetry.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Huge volume, little detection value in isolation, but essential for scoping an incident.',
  },
  {
    name: 'AWSGuardDuty',
    description: 'Findings from AWS GuardDuty.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low volume, high signal — already triaged by AWS, correlate it immediately.',
  },
  {
    name: 'AWSCloudWatch',
    description: 'AWS performance and billing metrics.',
    category: 'operational', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Operational metrics, not security data. Consider whether it belongs in this workspace at all.',
  },
  {
    name: 'AWSWAF',
    description: 'AWS Web Application Firewall traffic records.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Request-rate volume; useful for reconstructing an attack rather than alerting live.',
  },
  {
    name: 'AWSRoute53Resolver',
    description: 'Route 53 DNS resolver query logs.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Classic high-volume DNS data — the evidence trail for beaconing, queried after the fact.',
  },
  {
    name: 'AWSNetworkFirewallFlow',
    description: 'AWS Network Firewall per-flow records.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Flow data with the same economics as VPC flow logs.',
  },
  {
    name: 'AWSS3ServerAccess',
    description: 'Per-request S3 bucket access logs.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Microsoft names cloud storage access logs as a canonical example of secondary data.',
  },
  {
    name: 'AWSSecurityHubFindings',
    description: 'Aggregated AWS Security Hub findings and control status.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low volume and pre-triaged — worth alerting on directly.',
  },
  {
    name: 'AWSALBAccessLogs',
    description: 'AWS Elastic Load Balancer access logs.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true,
    recommendedTier: 'data-lake',
    reason: 'Load balancer request logs — high volume, and read during an investigation rather than alerted on.',
  },
  {
    // Two Microsoft sources spell this table differently. The Sentinel
    // connectors reference lists AWSALBAccessLogsData for the codeless
    // connector; the Azure Monitor table reference documents AWSALBAccessLogs
    // and has no page for this spelling. Both are catalogued so a real
    // workspace matches whichever it actually writes, but this one carries no
    // Lake claim because there is no attributes page to verify against.
    name: 'AWSALBAccessLogsData',
    description: 'AWS Elastic Load Balancer access logs (codeless connector spelling).',
    category: 'mixed', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Load balancer request logs, high volume for what they tell you.',
    caveat: 'Microsoft publishes no table reference page under this name, so its plan support could not be verified and no move is priced. If your workspace shows AWSALBAccessLogs instead, that one does support the Lake tier.',
  },
]

const GCP: CatalogueEntry[] = [
  {
    name: 'GCPAuditLogs',
    description: 'GCP admin activity, data access and access transparency logs.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: "GCP's equivalent of CloudTrail — the control-plane record you detect against.",
  },
  {
    name: 'GCPVPCFlow',
    description: 'GCP VPC network flow telemetry.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Same economics as any flow log: enormous volume, investigative value only.',
  },
  {
    name: 'GoogleCloudSCC',
    description: 'Google Security Command Center findings.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Pre-triaged findings feed — low volume, high value.',
  },
  {
    name: 'GKEAudit',
    description: 'Google Kubernetes Engine cluster and workload audit.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Container control-plane activity is a real attack path.',
  },
  {
    name: 'GoogleWorkspaceReports',
    description: 'Google Workspace Admin SDK activity.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: "Google's answer to Office 365 audit — but unlike OfficeActivity, this one is billable.",
  },
  {
    name: 'GCPIAM',
    description: 'GCP identity and access management audit.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Privilege escalation evidence — keep it live.',
  },
  {
    name: 'GCPDNS',
    description: 'GCP Cloud DNS query logs.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'DNS query volume; investigate after the fact rather than alert on every lookup.',
  },
  {
    name: 'GCPMonitoring',
    description: 'GCP Cloud Monitoring metrics.',
    category: 'operational', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Operational metrics sitting in a security workspace.',
  },
  {
    name: 'GCPIDS',
    description: 'Google Cloud IDS intrusion detection alerts.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Alert feed — low volume, act on it.',
  },
]

const THREAT_INTEL: CatalogueEntry[] = [
  {
    name: 'ThreatIntelIndicators',
    description: 'STIX threat intelligence indicators — IPs, domains, hashes, URLs.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Your detection rules join against this in real time. Microsoft classes TI feeds as primary security data.',
    caveat:
      'Microsoft does not offer the Lake plan for this table, so it cannot be tiered down. Control the cost '
      + 'instead by stripping the raw STIX blob (project-away Data) and filtering at ingestion. Note it '
      + 'republishes your entire indicator set every 7-10 days, so cost tracks total active indicators, not new ones.',
  },
  {
    name: 'ThreatIntelObjects',
    description: 'STIX objects other than indicators — threat actors, attack patterns, relationships.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Context your analysts and rules resolve against.',
    caveat: 'No Lake plan support — cannot be tiered down.',
  },
  {
    name: 'ThreatIntelligenceIndicator',
    description: 'The previous threat intelligence table, replaced by ThreatIntelIndicators.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: false, recommendedTier: 'analytics',
    reason: 'Legacy table. Microsoft stopped ingesting into it during 2025.',
    caveat:
      'Volume here in 2026 suggests something is still writing to a retired table, or that analytics rules '
      + 'still reference it. Worth checking your TI migration completed.',
  },
]

/** Operational data that attracts Sentinel charges for no security benefit. */
/**
 * Operational data sitting in a Sentinel workspace.
 *
 * CORRECTION, and the reason this block reads the way it does. Every entry here
 * once recommended the Lake tier, on the reasoning that high-volume data with no
 * detection value belongs somewhere cheap. That advice was impossible to follow:
 * Microsoft publishes "Auxiliary / Lake table support: No" for all of them.
 * First-party operational tables are not Lake-capable, however large they get.
 *
 * The lever for operational data is not the tier. It is either getting the data
 * out of the Sentinel workspace, or not collecting it — a DCR transform at
 * ingestion, or a narrower counter set. Those are what the reasons now say.
 *
 * `basicCapable` marks the four that do support the Basic plan, which is the one
 * genuine tier saving available to them and which the engine cannot yet express.
 */
const OPERATIONAL: CatalogueEntry[] = [
  {
    name: 'Perf', description: 'Windows and Linux performance counters.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: true,
    recommendedTier: 'basic',
    reason: 'Infrastructure monitoring paying SIEM rates. No detection rule will ever query it, and Basic bills it at roughly a fifth of the Analytics rate.',
    caveat: 'VM Insights reads this table and does not work against the Basic plan — if that blade is in use, the move breaks it. Also worth cutting at source: fewer counters, longer sample intervals.',
  },
  {
    name: 'InsightsMetrics', description: 'VM and container health metrics from Insights.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Platform health data, not security telemetry.',
    caveat: 'Supports neither the Lake nor the Basic plan, so no tier change can reduce it. The only levers are collecting less or moving VM Insights to its own workspace.',
  },
  {
    name: 'AzureMetrics', description: 'Azure resource platform metrics routed into logs.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: true,
    recommendedTier: 'basic',
    reason: 'Belongs in Azure Monitor rather than a Sentinel-enabled workspace; while it is here, Basic is the only cheaper plan it supports.',
    caveat: 'Better than any tier change: metrics rarely need to be in Logs at all. Check whether a diagnostic setting is duplicating what Azure Monitor Metrics already holds for free.',
  },
  {
    name: 'ContainerLogV2', description: 'Container stdout and stderr from Container Insights.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: true,
    recommendedTier: 'basic',
    reason: 'Application output from AKS — routinely the single largest table in a workspace, and Basic is often the single biggest tier saving available.',
    caveat: 'Container Insights reads this table and does not work against the Basic plan — if that experience is in use, the move breaks it. Simple per-table alerts keep working; scheduled analytics rules do not.',
  },
  {
    name: 'ContainerLog', description: 'Legacy container log table from Container Insights.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Application output from AKS. ContainerLogV2 is the current table.',
    caveat: 'Supports neither Lake nor Basic. Migrating to ContainerLogV2 does unlock Basic, so the upgrade has a cost argument as well as a functional one.',
  },
  {
    name: 'Event', description: 'Windows System and Application event logs.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Non-security Windows events riding along on the same agent as SecurityEvent.',
    caveat: 'Supports neither Lake nor Basic. Narrow the data collection rule — this table is usually large because a DCR is collecting whole event logs rather than chosen event IDs.',
  },
  {
    name: 'W3CIISLog', description: 'IIS web server access logs.',
    category: 'mixed', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'High volume, and genuinely useful for investigating web attacks.',
    caveat: 'Supports neither Lake nor Basic, despite often being quoted as an example of data suited to cheap storage. Filter at ingestion — dropping static asset requests typically removes most of the volume.',
  },
  {
    name: 'LAQueryLogs', description: 'Audit of queries run against the workspace.',
    category: 'operational', billable: true, lakeCapable: true, basicCapable: true,
    recommendedTier: 'data-lake',
    reason: 'Usually trivial, but can spike badly with polling workbooks or automation.',
  },
  // Application Insights telemetry. AppTraces supports Basic; the rest support
  // no cheaper plan at all, which makes "point App Insights somewhere else" the
  // only real answer for them.
  ...([
    ['AppTraces', true], ['AppRequests', false], ['AppDependencies', false],
    ['AppExceptions', false], ['AppPageViews', false], ['AppMetrics', false],
    ['AppPerformanceCounters', false], ['AppEvents', false], ['AppAvailabilityResults', false],
  ] as const).map(([name, basic]): CatalogueEntry => ({
    name,
    description: 'Application Insights telemetry.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: basic,
    recommendedTier: basic ? 'basic' : 'analytics',
    reason: 'Developer APM data attracting Sentinel charges because App Insights points at this workspace.',
    caveat: basic
      ? 'The Application Insights portal experience does not work against the Basic plan — moving this table breaks it. The better fix is usually a separate Application Insights workspace, so developer telemetry stops attracting Sentinel rates entirely.'
      : 'Supports neither the Lake nor the Basic plan. The only fix is pointing Application Insights at a workspace without Sentinel enabled.',
  })),
]

/**
 * Defender XDR advanced hunting tables that `sentinelTables.ts` does not list.
 *
 * The source mapping covers the best-known handful — DeviceEvents,
 * DeviceProcessEvents, DeviceNetworkEvents — so a tester saw the odd result of
 * DeviceNetworkEvents resolving while DeviceImageLoadEvents beside it did not.
 *
 * Every one of these recommends Analytics, and the reason is *not* the usual
 * "keep detections queryable". These tables are the pool the Microsoft 365 E5
 * grant is drawn from: 5 MB/user/day of Defender XDR data ingests free. Moving
 * them to the Lake tier takes data that costs nothing and starts paying Lake
 * ingestion for it. A cost model that knows rates but not grants gets this
 * exactly backwards, so the reason text has to carry the grant.
 *
 * Lake support confirmed "Yes" on each table's reference page — they *can* be
 * moved. They should not be.
 */
const DEFENDER_XDR: CatalogueEntry[] = [
  {
    name: 'DeviceImageLoadEvents',
    description: 'DLL load events from Defender for Endpoint.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the E5 Defender grant — moving it to the Lake tier starts charging for data that ingests free.',
    caveat: 'Noisy relative to its detection value. If it is genuinely large, filter at the connector rather than changing tier.',
  },
  {
    name: 'DeviceRegistryEvents',
    description: 'Registry key creation and modification, with the initiating process.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Persistence lives here, and it is covered by the E5 Defender grant. Keep it on Analytics.',
  },
  {
    name: 'DeviceFileCertificateInfo',
    description: 'Signing certificate details for files seen on endpoints.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low volume, and covered by the E5 Defender grant. Nothing to save by moving it.',
  },
  {
    name: 'AlertInfo',
    description: 'Defender XDR alert metadata — severity, category and MITRE technique.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Alert metadata, tiny by volume and the entry point for most investigations.',
    caveat: 'Billable, even though SecurityAlert is free. The two carry near-identical alert data and are easily confused on a bill.',
  },
]

const PLATFORM_AND_FREE: CatalogueEntry[] = [
  {
    name: 'SecurityIncident',
    description: 'Incidents raised by Sentinel and Defender XDR.',
    category: 'platform', billable: false, lakeCapable: true, basicCapable: false, recommendedTier: 'free',
    reason: 'Free — Microsoft lists it explicitly among the free data types.',
  },
  {
    name: 'Watchlist',
    description: 'Reference data imported from CSV for joins and alert conditions.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: false, recommendedTier: 'analytics',
    reason: 'Reference data you join against, so it has to stay queryable.',
    caveat: 'Billable despite being data you uploaded yourself, and re-ingests on every update — a watchlist refreshed nightly is ingested nightly, in full.',
  },
  {
    name: 'Anomalies',
    description: 'Output of Sentinel anomaly analytics rules.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Sentinel’s own detection output — low volume, and the thing your rules are meant to act on.',
  },
  {
    name: 'Heartbeat', description: 'Agent liveness records.',
    category: 'platform', billable: false, lakeCapable: false, basicCapable: false, recommendedTier: 'free',
    reason: 'Free, and genuinely useful for spotting agents that have stopped reporting.',
  },
  {
    name: 'Usage', description: 'Hourly ingestion volume per table — the basis of this analysis.',
    category: 'platform', billable: false, lakeCapable: false, basicCapable: false, recommendedTier: 'free',
    reason: 'Free metering data.',
  },
  {
    name: 'Operation', description: 'Workspace operation records.',
    category: 'platform', billable: false, lakeCapable: false, basicCapable: false, recommendedTier: 'free',
    reason: 'Free.',
  },
  {
    name: 'SentinelHealth', description: 'Sentinel connector and rule health.',
    category: 'platform', billable: false, lakeCapable: true, basicCapable: false, recommendedTier: 'free',
    reason: 'Free — Microsoft states it is not billable.',
  },
  {
    name: 'SentinelAudit', description: 'Audit of changes to Sentinel configuration.',
    category: 'platform', billable: true, lakeCapable: true, basicCapable: false, recommendedTier: 'analytics',
    reason: 'Billable, unlike SentinelHealth — the two are easily confused.',
  },
  {
    name: 'AdditionalExtensions',
    description: 'Overflow fields from CEF events that do not fit the standard schema.',
    // No table reference page exists for this one, so Lake support is unknown.
    // CommonSecurityLog beside it is Lake-capable and it would be reasonable to
    // assume this is too — but assuming exactly that is what put sixteen
    // impossible recommendations into the previous release, so it stays unclaimed.
    category: 'security', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'A Microsoft-documented cost trap — content is variable and volume can exceed the CEF table itself.',
    caveat: 'Microsoft publishes no table reference page for this table, so its plan support could not be verified and no move is priced. The reliable saving is trimming the fields at ingestion, which also stops the overflow.',
  },
  {
    name: 'IdentityInfo', description: 'User and group context synced by UEBA.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: false, recommendedTier: 'analytics',
    reason: 'Billable at normal rates despite looking like reference data.',
    caveat: 'Re-ingests on group changes — renaming a 50-member group re-ingests 50 records, and nested groups cascade.',
  },
]

export const TABLE_CATALOGUE: CatalogueEntry[] = [
  ...AWS, ...GCP, ...THREAT_INTEL, ...DEFENDER_XDR, ...OPERATIONAL, ...PLATFORM_AND_FREE,
  ...EXTENDED_CATALOGUE,
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
