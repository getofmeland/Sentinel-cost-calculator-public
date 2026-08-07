import type { CatalogueEntry } from './tableCatalogue'

/**
 * Catalogue entries for the 69 documented tables a coverage audit found
 * resolving to nothing — the Defender XDR advanced-hunting set, Azure Firewall
 * and Storage resource logs, ASIM normalised tables, Power Platform audit, and
 * the remaining GCP connectors. Split from tableCatalogue.ts for size; both
 * files feed TABLE_CATALOGUE and are asserted by the same tests.
 *
 * Plan support (basicCapable / lakeCapable) is taken verbatim from the
 * verified extraction of Microsoft's table reference pages — do not edit those
 * flags by hand; tableCatalogue.test.ts asserts every entry against the
 * tablePlanSupport.ts snapshot.
 */

// ─── Entra ID / AD FS identity audit ─────────────────────────────────────────

const IDENTITY: CatalogueEntry[] = [
  {
    name: 'AADProvisioningLogs',
    description: 'Entra ID provisioning activity — users and groups synced to and from connected applications.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Identity audit at modest volume, and provisioning abuse is a persistence path. Keep it queryable.',
  },
  {
    name: 'AADServicePrincipalRiskEvents',
    description: 'Risk detections raised against Entra ID service principals.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low-volume, pre-triaged risk signal on non-human identities — alert on it directly.',
  },
  {
    name: 'ADFSSignInLogs',
    description: 'Sign-in events from on-premises AD FS servers, via Entra Connect Health.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Sign-in telemetry is core detection data — password spray against AD FS shows up here first.',
  },
]

// ─── ASIM normalised tables ──────────────────────────────────────────────────
//
// All ten recommend Analytics, but with less confidence than that word usually
// carries: these are normalised tables that many connectors write into, so the
// volume profile depends entirely on what the customer routes there. The table
// name alone cannot tell us whether the content is a trickle of curated events
// or a firehose of DNS queries, so each entry carries the caveat.

const ASIM: CatalogueEntry[] = [
  {
    name: 'ASimAuditEventLogs',
    description: 'Audit events normalised into the ASIM schema by whichever connectors are configured to write here.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Normalised security events feed detections directly, and audit feeds are usually modest in volume.',
    caveat: 'Content is whatever your connectors route here — if a high-volume feed lands in this table, judge the tier by that feed, not the table name.',
  },
  {
    name: 'ASimAuthenticationEventLogs',
    description: 'Authentication events normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Authentication events are core detection data — keep them where rules can query them live.',
    caveat: 'Content is whatever your connectors route here — if a high-volume feed lands in this table, judge the tier by that feed, not the table name.',
  },
  {
    name: 'ASimDhcpEventLogs',
    description: 'DHCP lease and assignment events normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'DHCP maps IPs to hosts — the join your investigations depend on, usually at modest volume.',
    caveat: 'Content is whatever your connectors route here — a busy estate’s DHCP feed can grow large enough to make this a Lake candidate.',
  },
  {
    name: 'ASimDnsActivityLogs',
    description: 'DNS query and response activity normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Normalised DNS feeds detections directly when the volume is curated.',
    caveat: 'DNS is the classic high-volume feed. If a full resolver stream is routed here, it has flow-log economics and the Lake tier is the better home — only you can see the volume.',
  },
  {
    name: 'ASimFileEventLogs',
    description: 'File activity events normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'File activity carries direct detection value when the feed is curated.',
    caveat: 'Content is whatever your connectors route here — if a high-volume feed lands in this table, judge the tier by that feed, not the table name.',
  },
  {
    name: 'ASimNetworkSessionLogs',
    description: 'Network session events normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Normalised network sessions feed detections when the feed is curated.',
    caveat: 'Network session data is the other classic high-volume feed. A full firewall or flow stream routed here has flow-log economics and belongs on the Lake tier — judge it by the volume you actually see.',
  },
  {
    name: 'ASimProcessEventLogs',
    description: 'Process creation and termination events normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Process events are detection-grade endpoint telemetry.',
    caveat: 'Content is whatever your connectors route here — if a high-volume feed lands in this table, judge the tier by that feed, not the table name.',
  },
  {
    name: 'ASimRegistryEventLogs',
    description: 'Windows registry events normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Registry events are where persistence shows up — detection-grade when curated.',
    caveat: 'Content is whatever your connectors route here — if a high-volume feed lands in this table, judge the tier by that feed, not the table name.',
  },
  {
    name: 'ASimUserManagementActivityLogs',
    description: 'User and group management activity normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Account lifecycle changes are low-volume, high-value audit data.',
    caveat: 'Content is whatever your connectors route here — if a high-volume feed lands in this table, judge the tier by that feed, not the table name.',
  },
  {
    name: 'ASimWebSessionLogs',
    description: 'Web session events normalised into the ASIM schema.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Web session data supports detection when the feed is curated.',
    caveat: 'Proxy and web gateway feeds routed here can reach request-log volume, at which point the Lake tier is the better home — judge it by what actually feeds this table.',
  },
]

// ─── Azure Firewall ──────────────────────────────────────────────────────────

const AZURE_FIREWALL: CatalogueEntry[] = [
  {
    name: 'AZFWDnsQuery',
    description: 'DNS proxy query logs from Azure Firewall.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'DNS query volume with investigative value — the beaconing evidence trail, queried after the fact.',
  },
  {
    name: 'AZFWFatFlow',
    description: 'Azure Firewall top-flow records — the highest-throughput connections through the firewall.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Flow telemetry, read when scoping an incident rather than alerted on live.',
  },
  {
    name: 'AZFWFlowTrace',
    description: 'Full flow trace records from Azure Firewall, including TCP flag detail.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'The most verbose flow logging the firewall offers — enormous volume, investigative value only.',
  },
  {
    name: 'AZFWIdpsSignature',
    description: 'Reference data for the IDPS signatures used by Azure Firewall.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Signature reference data — tiny, so no move is worth its overhead.',
  },
  {
    name: 'AZFWInternalFqdnResolutionFailure',
    description: 'Internal FQDN resolution failures recorded by Azure Firewall.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'DNS-failure diagnostics — read during an investigation or an outage, not alerted on.',
  },
  {
    name: 'AZFWNatRule',
    description: 'DNAT rule hit events from Azure Firewall.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Per-connection rule logging with flow-log economics — the record of what reached a published service.',
  },
]

// ─── Defender XDR advanced hunting ───────────────────────────────────────────
//
// Same logic as the existing DEFENDER_XDR block in tableCatalogue.ts: these
// tables are the pool the Microsoft 365 E5 grant (5 MB/user/day of Defender
// XDR data) is drawn from. Moving them to a cheaper tier starts charging for
// data that currently ingests free, so every reason carries the grant.

const DEFENDER_XDR_DRAFT: CatalogueEntry[] = [
  {
    name: 'AgentsInfo',
    description: 'Inventory of AI agents in the organisation, from Defender XDR advanced hunting.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Small inventory table covered by the Microsoft 365 E5 Defender grant — moving it to a cheaper tier starts paying for data that ingests free.',
  },
  {
    name: 'BehaviorEntities',
    description: 'Entities involved in behaviours identified by Defender XDR.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to the Lake tier starts charging for data that currently ingests free.',
  },
  {
    name: 'BehaviorInfo',
    description: 'Behaviours identified by Defender XDR — suspicious activity patterns below alert severity.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Pre-correlated behavioural signal, and covered by the Microsoft 365 E5 Defender grant — nothing to save by moving it.',
  },
  {
    name: 'CampaignInfo',
    description: 'Email campaign information from Defender for Office 365.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low-volume campaign context, covered by the Microsoft 365 E5 Defender grant — a move would start charging for free data.',
  },
  {
    name: 'CloudAuditEvents',
    description: 'Cloud service audit events surfaced by Defender for Cloud in advanced hunting.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to the Lake tier starts charging for data that currently ingests free.',
  },
  {
    name: 'CloudDnsEvents',
    description: 'DNS events from cloud environments, surfaced by Defender for Cloud in advanced hunting.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to the Lake tier starts charging for data that currently ingests free.',
  },
  {
    name: 'CloudProcessEvents',
    description: 'Process events from cloud-hosted workloads, surfaced by Defender for Cloud in advanced hunting.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to the Lake tier starts charging for data that currently ingests free.',
  },
  {
    name: 'CloudStorageAggregatedEvents',
    description: 'Aggregated storage account activity from Defender for Storage.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Already aggregated, so volume is contained — and covered by the Microsoft 365 E5 Defender grant, so a move would start charging for free data.',
  },
  {
    name: 'DeviceTvmSecureConfigurationAssessment',
    description: 'Per-device secure configuration assessment results from Defender Vulnerability Management.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to a cheaper tier starts charging for data that ingests free.',
  },
  {
    name: 'DeviceTvmSoftwareInventory',
    description: 'Per-device software inventory from Defender Vulnerability Management.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Asset context analysts join against, and covered by the Microsoft 365 E5 Defender grant — a move would start charging for free data.',
  },
  {
    name: 'DeviceTvmSoftwareVulnerabilities',
    description: 'Software vulnerabilities found on devices, from Defender Vulnerability Management.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to a cheaper tier starts charging for data that ingests free.',
  },
  {
    name: 'DisruptionAndResponseEvents',
    description: 'Automatic attack disruption and response actions taken by Defender XDR.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'The record of what Defender did on your behalf — tiny, and covered by the Microsoft 365 E5 Defender grant.',
  },
  {
    name: 'FileMaliciousContentInfo',
    description: 'Details of malicious content Defender identified in files.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low-volume detection output, covered by the Microsoft 365 E5 Defender grant — nothing to save by moving it.',
  },
  {
    name: 'IdentityAccountInfo',
    description: 'Account information from Defender for Identity and Entra ID, in advanced hunting.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Identity context your investigations resolve against, covered by the Microsoft 365 E5 Defender grant.',
  },
  {
    name: 'IdentityEvents',
    description: 'Identity-related events from Defender XDR advanced hunting.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to the Lake tier starts charging for data that currently ingests free.',
  },
  {
    name: 'MessageEvents',
    description: 'Microsoft Teams message events from Defender for Office 365.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to the Lake tier starts charging for data that currently ingests free.',
  },
  {
    name: 'MessagePostDeliveryEvents',
    description: 'Post-delivery actions taken on Teams messages, such as zero-hour auto purge.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low-volume response record, covered by the Microsoft 365 E5 Defender grant — nothing to save by moving it.',
  },
  {
    name: 'MessageUrlInfo',
    description: 'URLs found in Teams messages processed by Defender for Office 365.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Covered by the Microsoft 365 E5 Defender grant — moving it to the Lake tier starts charging for data that currently ingests free.',
  },
  {
    name: 'OAuthAppInfo',
    description: 'OAuth applications registered in the tenant, from Defender for Cloud Apps app governance.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Consent-abuse investigations start here. Small, and covered by the Microsoft 365 E5 Defender grant.',
  },
]

// ─── Defender Vulnerability Management knowledge bases ───────────────────────

const DEFENDER_TVM_KB: CatalogueEntry[] = [
  {
    name: 'DeviceTvmSecureConfigurationAssessmentKB',
    description: 'Knowledge base of the secure configurations Defender Vulnerability Management assesses.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Reference data at near-zero volume — no move is worth its caveats.',
  },
  {
    name: 'DeviceTvmSoftwareVulnerabilitiesKB',
    description: 'Knowledge base of published CVEs referenced by Defender Vulnerability Management.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Reference data at near-zero volume — no move is worth its caveats.',
  },
]

// ─── Power Platform and Microsoft 365 activity ───────────────────────────────

const POWER_PLATFORM_M365: CatalogueEntry[] = [
  {
    name: 'CopilotActivity',
    description: 'Microsoft Copilot interaction audit events.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'The record of who asked Copilot what — modest volume, and the evidence you need when data exposure through AI is questioned.',
  },
  {
    name: 'DataverseActivity',
    description: 'Dataverse audit activity — create, read, update and delete operations against Dataverse and Dynamics 365 data.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'An audit trail over business data — modest volume, real insider-risk value.',
  },
  {
    name: 'PowerAutomateActivity',
    description: 'Power Automate flow lifecycle activity — creation, editing and deletion of flows.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Low-volume automation audit — flows are a quiet data-exfiltration path worth watching live.',
  },
  {
    name: 'PowerBIActivity',
    description: 'Power BI user activity audit — report access, exports and sharing.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Who exported which report is exactly what an insider-risk investigation asks — modest volume, keep it live.',
  },
  {
    name: 'PowerPlatformAdminActivity',
    description: 'Power Platform administrative actions — environment and connector policy changes.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Admin-plane audit — low volume, high value.',
  },
  {
    name: 'ProjectActivity',
    description: 'Microsoft Project user activity audit events.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Modest-volume activity audit — the same insider-risk argument as the rest of the Microsoft 365 activity family.',
  },
  {
    name: 'MicrosoftPurviewInformationProtection',
    description: 'Sensitivity label and protection events from Microsoft Purview Information Protection.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Label activity underpins data-loss investigations — modest volume, keep it queryable.',
  },
  {
    name: 'PurviewDataSensitivityLogs',
    description: 'Data sensitivity classification results from Microsoft Purview scans.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: false, recommendedTier: 'analytics',
    reason: 'Classification context you join against when judging what an incident exposed — modest volume.',
  },
  {
    name: 'Dynamics365Activity',
    description: 'Dynamics 365 Customer Engagement user and administrative activity audit.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: false, recommendedTier: 'analytics',
    reason: 'An audit trail over customer data with real insider-risk value.',
    caveat: 'Supports neither the Basic nor the Lake plan, so no tier change can reduce it. Manage volume at source, through the Dynamics 365 audit settings.',
  },
]

// ─── Entra Global Secure Access ──────────────────────────────────────────────

const GLOBAL_SECURE_ACCESS: CatalogueEntry[] = [
  {
    name: 'NetworkAccessTraffic',
    description: 'Per-connection network traffic logs from Microsoft Entra Global Secure Access.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Every user connection through Global Secure Access lands here — flow-log volume, with value when scoping an incident rather than alerting live.',
  },
]

// ─── Forwarded Windows events ────────────────────────────────────────────────

const WINDOWS_EVENTS: CatalogueEntry[] = [
  {
    name: 'WindowsEvent',
    description: 'Windows events forwarded via Windows Event Forwarding and collected by the Azure Monitor Agent.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: false, recommendedTier: 'analytics',
    reason: 'WEF collections are curated — these events were forwarded because someone chose them. Detection-grade security events belong on Analytics.',
  },
]

// ─── Google Cloud infrastructure and service logs ────────────────────────────

const GCP_DRAFT: CatalogueEntry[] = [
  {
    name: 'GCPApigee',
    description: 'Apigee API gateway request logs from Google Cloud.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Per-request API traffic — high volume, read when reconstructing abuse of an API rather than alerted on live.',
  },
  {
    name: 'GCPCDN',
    description: 'Cloud CDN request logs from Google Cloud.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'CDN request logging is as high-volume as it gets — investigative value only.',
  },
  {
    name: 'GCPCloudRun',
    description: 'Cloud Run service logs from Google Cloud.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Serverless request and container output — request-rate volume, read during an investigation rather than alerted on.',
  },
  {
    name: 'GCPCloudSQL',
    description: 'Cloud SQL database logs from Google Cloud.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Database activity logging — bulky, and read when investigating data access after the fact.',
  },
  {
    name: 'GCPComputeEngine',
    description: 'Compute Engine instance and platform logs from Google Cloud.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'VM platform logging at operational volume. The control-plane audit you detect against is GCPAuditLogs, not this.',
  },
  {
    name: 'GCPNAT',
    description: 'Cloud NAT connection logs from Google Cloud.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Per-connection NAT telemetry — the same economics as any flow log.',
  },
  {
    name: 'GCPNATAudit',
    description: 'Cloud NAT configuration audit logs from Google Cloud.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Control-plane changes to your egress path — low volume, keep it live.',
  },
  {
    name: 'GCPResourceManager',
    description: 'Resource Manager audit logs from Google Cloud — project and IAM policy changes.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Control-plane audit — where privilege escalation in GCP shows up.',
  },
]

// ─── Azure Storage access logs ───────────────────────────────────────────────

const STORAGE: CatalogueEntry[] = [
  {
    name: 'StorageBlobLogs',
    description: 'Per-request access logs for Azure Blob Storage.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Microsoft names storage access logs as canonical secondary data — huge volume, and the record you need when asking what an attacker touched.',
  },
  {
    name: 'StorageFileLogs',
    description: 'Per-request access logs for Azure Files.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Per-request storage access logging — classic secondary data, read after the fact.',
  },
  {
    name: 'StorageQueueLogs',
    description: 'Per-request access logs for Azure Queue Storage.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Per-request storage access logging — classic secondary data, read after the fact.',
  },
  {
    name: 'StorageTableLogs',
    description: 'Per-request access logs for Azure Table Storage.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'data-lake',
    reason: 'Per-request storage access logging — classic secondary data, read after the fact.',
  },
]

// ─── Third-party security products ───────────────────────────────────────────

const THIRD_PARTY: CatalogueEntry[] = [
  {
    name: 'ABAPAuditLog',
    description: 'SAP security audit log events from the ABAP application layer, via the Sentinel solution for SAP.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'The detection surface for your ERP — low volume relative to the fraud and access risks it covers.',
  },
  {
    name: 'CrowdStrikeAlerts',
    description: 'Alerts from the CrowdStrike Falcon platform.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Pre-triaged alert feed — low volume, high signal, correlate it immediately.',
  },
  {
    name: 'QualysKnowledgeBase',
    description: 'The Qualys vulnerability knowledge base — reference records describing detections, not findings from your estate.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Reference data joined against during triage — small, so nothing to save by moving it.',
  },
  {
    name: 'Rapid7InsightVMCloudAssets',
    description: 'Asset inventory from Rapid7 InsightVM.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Asset context you join against during investigations — inventory-sized, keep it queryable.',
  },
  {
    name: 'Rapid7InsightVMCloudVulnerabilities',
    description: 'Vulnerability findings from Rapid7 InsightVM.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'A findings feed sized by your estate rather than by events — analysts resolve against it live.',
  },
  {
    name: 'SalesforceAuditTrail',
    description: 'Salesforce setup audit trail — administrative and configuration changes.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true, recommendedTier: 'analytics',
    reason: 'Admin change audit for a system holding your customer data — low volume, real insider-risk value.',
  },
]

export const EXTENDED_CATALOGUE: CatalogueEntry[] = [
  ...IDENTITY,
  ...ASIM,
  ...AZURE_FIREWALL,
  ...DEFENDER_XDR_DRAFT,
  ...DEFENDER_TVM_KB,
  ...POWER_PLATFORM_M365,
  ...GLOBAL_SECURE_ACCESS,
  ...WINDOWS_EVENTS,
  ...GCP_DRAFT,
  ...STORAGE,
  ...THIRD_PARTY,
]
