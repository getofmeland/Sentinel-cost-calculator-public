// Sentinel table reference data — maps log source IDs to the tables they populate
// and links to Microsoft Learn documentation.

export interface SentinelTable {
  /** Table name as it appears in KQL */
  name: string
  /** One-line description of what the table contains */
  description: string
  /** Full URL to the Microsoft Learn table reference */
  url: string
}

export interface SourceTableMapping {
  /** Matches the id field in LOG_SOURCES or a workload group key (ws-security / lx-syslog) */
  sourceId: string
  /** Connector name as shown in Sentinel Content Hub */
  connectorName: string
  tables: SentinelTable[]
  /** Basic KQL example the team can copy */
  kqlExample: string
  /** Optional contextual note about this source */
  note?: string
  /** Link to the connector's main docs page */
  docsUrl: string
}

// Helper: Azure Monitor table URL
const ama = (table: string) =>
  `https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/${table.toLowerCase()}`

// Helper: Defender XDR Advanced Hunting table URL
const xdr = (table: string) =>
  `https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-${table.toLowerCase()}-table`

const MAPPINGS: SourceTableMapping[] = [

  // ── Identity & Entra ──────────────────────────────────────────────────────

  {
    sourceId: 'entra-id',
    connectorName: 'Microsoft Entra ID',
    tables: [
      { name: 'SigninLogs', description: 'Interactive user sign-in events', url: ama('signinlogs') },
      { name: 'AADNonInteractiveUserSignInLogs', description: 'Non-interactive sign-ins (service accounts, background auth)', url: ama('aadnoninteractiveusersigninlogs') },
      { name: 'AADServicePrincipalSignInLogs', description: 'Service principal authentication', url: ama('aadserviceprincipalsigninlogs') },
      { name: 'AADManagedIdentitySignInLogs', description: 'Managed identity sign-ins', url: ama('aadmanagedidentitysigninlogs') },
      { name: 'AuditLogs', description: 'Directory changes, app registrations, role assignments', url: ama('auditlogs') },
    ],
    kqlExample: `SigninLogs
| where TimeGenerated > ago(24h)
| summarize count() by UserPrincipalName
| top 10 by count_`,
    note: 'Non-interactive sign-ins can generate 40%+ of Entra ID volume. Consider filtering via DCR if not needed for detection.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/microsoft-entra-id',
  },

  {
    sourceId: 'entra-id-protection',
    connectorName: 'Microsoft Entra ID Protection',
    tables: [
      { name: 'AADRiskyUsers', description: 'Users flagged as risky by Entra ID Protection', url: ama('aadriskyusers') },
      { name: 'AADUserRiskEvents', description: 'Individual risk detections linked to user accounts', url: ama('aaduserriskevents') },
      { name: 'AADRiskyServicePrincipals', description: 'Service principals flagged as risky', url: ama('aadriskyserviceprincipals') },
    ],
    kqlExample: `AADUserRiskEvents
| where TimeGenerated > ago(24h)
| summarize count() by RiskEventType
| order by count_ desc`,
    note: 'Volume is typically very low — driven by risk detections, not sign-in events. Useful for identity-based incident triage.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/azure-active-directory-identity-protection',
  },

  // ── Microsoft Defender ────────────────────────────────────────────────────

  {
    sourceId: 'mde',
    connectorName: 'Microsoft Defender XDR',
    tables: [
      { name: 'DeviceProcessEvents', description: 'Process creation and related events', url: xdr('deviceprocessevents') },
      { name: 'DeviceNetworkEvents', description: 'Network connection events', url: xdr('devicenetworkevents') },
      { name: 'DeviceFileEvents', description: 'File creation, modification, and deletion', url: xdr('devicefileevents') },
      { name: 'DeviceLogonEvents', description: 'Sign-in events on endpoints', url: xdr('devicelogonevents') },
      { name: 'DeviceEvents', description: 'Miscellaneous events including AV and exploit protection', url: xdr('deviceevents') },
      { name: 'DeviceInfo', description: 'Machine info including OS version and domain', url: xdr('deviceinfo') },
      { name: 'DeviceNetworkInfo', description: 'Network adapter and IP address information', url: xdr('devicenetworkinfo') },
      { name: 'AlertEvidence', description: 'Evidence artefacts associated with Defender alerts', url: xdr('alertevidence') },
    ],
    kqlExample: `DeviceProcessEvents
| where TimeGenerated > ago(1h)
| where FileName in~ ("powershell.exe", "cmd.exe")
| project TimeGenerated, DeviceName, FileName, ProcessCommandLine`,
    note: 'MDE is typically the highest-volume Defender source. DeviceProcessEvents and DeviceNetworkEvents drive most ingestion.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/microsoft-defender-xdr',
  },

  {
    sourceId: 'mdi',
    connectorName: 'Microsoft Defender XDR',
    tables: [
      { name: 'IdentityLogonEvents', description: 'Authentication events from Active Directory and Entra ID', url: xdr('identitylogonevents') },
      { name: 'IdentityQueryEvents', description: 'LDAP and DNS queries against Active Directory', url: xdr('identityqueryevents') },
      { name: 'IdentityDirectoryEvents', description: 'Active Directory object and attribute changes', url: xdr('identitydirectoryevents') },
    ],
    kqlExample: `IdentityLogonEvents
| where TimeGenerated > ago(24h)
| where Application == "Active Directory"
| summarize count() by ActionType`,
    note: 'Volume scales with DC count and authentication volume, not directly with user count.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/microsoft-defender-xdr',
  },

  {
    sourceId: 'mdo',
    connectorName: 'Microsoft Defender XDR',
    tables: [
      { name: 'EmailEvents', description: 'Email delivery and blocking events', url: xdr('emailevents') },
      { name: 'EmailUrlInfo', description: 'URL data extracted from email messages', url: xdr('emailurlinfo') },
      { name: 'EmailAttachmentInfo', description: 'Attachment metadata from email messages', url: xdr('emailattachmentinfo') },
      { name: 'EmailPostDeliveryEvents', description: 'Post-delivery actions including ZAP and user reports', url: xdr('emailpostdeliveryevents') },
      { name: 'UrlClickEvents', description: 'Safe Links user click events', url: xdr('urlclickevents') },
    ],
    kqlExample: `EmailEvents
| where TimeGenerated > ago(24h)
| summarize count() by DeliveryAction
| render piechart`,
    note: 'Volume is driven by email throughput and Safe Links / Safe Attachments scanning policy scope.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/microsoft-defender-xdr',
  },

  {
    sourceId: 'mdca',
    connectorName: 'Microsoft Defender XDR',
    tables: [
      { name: 'CloudAppEvents', description: 'User and admin activities in connected cloud apps', url: xdr('cloudappevents') },
      { name: 'McasShadowItReporting', description: 'Shadow IT discovery logs from network appliances', url: ama('mcasshadowitreporting') },
    ],
    kqlExample: `CloudAppEvents
| where TimeGenerated > ago(24h)
| summarize count() by Application
| top 10 by count_`,
    note: 'Shadow IT discovery logs (McasShadowItReporting) are eligible for the E5 data grant and typically free to ingest.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/microsoft-defender-xdr',
  },

  {
    sourceId: 'mdc',
    connectorName: 'Microsoft Defender for Cloud',
    tables: [
      { name: 'SecurityAlert', description: 'Security alerts from Defender for Cloud and other sources', url: ama('securityalert') },
      { name: 'SecurityRecommendation', description: 'Hardening recommendations for Azure resources', url: ama('securityrecommendation') },
      { name: 'SecurityTask', description: 'Tasks generated from Defender for Cloud recommendations', url: ama('securitytask') },
    ],
    kqlExample: `SecurityAlert
| where TimeGenerated > ago(24h)
| where ProductName == "Azure Security Center"
| summarize count() by AlertSeverity`,
    note: 'Typically low volume. Security alerts are high-value; the cost-per-detection ratio is usually excellent.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/microsoft-defender-for-cloud',
  },

  // ── Microsoft 365 ─────────────────────────────────────────────────────────

  {
    sourceId: 'o365-audit',
    connectorName: 'Office 365',
    tables: [
      { name: 'OfficeActivity', description: 'Exchange, SharePoint, Teams, and other M365 audit events', url: ama('officeactivity') },
    ],
    kqlExample: `OfficeActivity
| where TimeGenerated > ago(24h)
| summarize count() by OfficeWorkload
| render piechart`,
    note: 'Exchange management activity is free to ingest. Other categories (SharePoint, Teams, DLP) may be billable.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/office-365',
  },

  {
    sourceId: 'intune',
    connectorName: 'Microsoft Intune',
    tables: [
      { name: 'IntuneAuditLogs', description: 'Audit log of all Intune admin changes', url: ama('intuneauditlogs') },
      { name: 'IntuneOperationalLogs', description: 'Operational events including enrolment and compliance state changes', url: ama('intuneoperationallogs') },
      { name: 'IntuneDeviceComplianceOrg', description: 'Snapshot of device compliance state per policy', url: ama('intunedevicecomplianceorg') },
    ],
    kqlExample: `IntuneOperationalLogs
| where TimeGenerated > ago(24h)
| where OperationName == "Enrollment"
| summarize count() by ResultType`,
    note: 'Low volume. Enrolment failures and non-compliant device events are the most useful for MXDR detection.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/microsoft-intune',
  },

  // ── Azure Platform ────────────────────────────────────────────────────────

  {
    sourceId: 'azure-activity',
    connectorName: 'Azure Activity',
    tables: [
      { name: 'AzureActivity', description: 'Azure control-plane operations — resource create, modify, delete', url: ama('azureactivity') },
    ],
    kqlExample: `AzureActivity
| where TimeGenerated > ago(24h)
| summarize count() by OperationNameValue
| top 10 by count_`,
    note: 'Always free to ingest. Volume scales with Azure resource count and DevOps activity, not user count.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/azure-activity',
  },

  {
    sourceId: 'key-vault',
    connectorName: 'Azure Key Vault',
    tables: [
      { name: 'AzureDiagnostics', description: 'Key Vault access events in legacy diagnostics mode', url: ama('azurediagnostics') },
      { name: 'KeyVaultData', description: 'Key Vault operations in resource-specific diagnostics mode', url: ama('keyvaultdata') },
    ],
    kqlExample: `AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where TimeGenerated > ago(24h)
| summarize count() by OperationName
| top 10 by count_`,
    note: 'Use resource-specific diagnostics mode (KeyVaultData) where possible — it avoids the noisy AzureDiagnostics catch-all table.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/azure-key-vault',
  },

  // ── Network ───────────────────────────────────────────────────────────────

  {
    sourceId: 'azure-firewall',
    connectorName: 'Azure Firewall',
    tables: [
      { name: 'AZFWApplicationRule', description: 'Azure Firewall application (FQDN) rule decisions', url: ama('azfwapplicationrule') },
      { name: 'AZFWNetworkRule', description: 'Azure Firewall network rule allow/deny decisions', url: ama('azfwnetworkrule') },
      { name: 'AZFWThreatIntel', description: 'Azure Firewall threat intelligence alert hits', url: ama('azfwthreatintel') },
      { name: 'AZFWDnsProxy', description: 'DNS queries proxied through Azure Firewall', url: ama('azfwdnsproxy') },
    ],
    kqlExample: `AZFWNetworkRule
| where TimeGenerated > ago(1h)
| summarize count() by Action
| render piechart`,
    note: 'Highest volume source for most Azure environments. Strong candidate for Data Lake tier — consider summary DCR for Analytics.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/azure-firewall',
  },

  {
    sourceId: 'nsg-flow',
    connectorName: 'Azure Network Watcher — NSG Flow Logs',
    tables: [
      { name: 'AzureNetworkAnalytics_CL', description: 'NSG flow log analytics — accepted and denied flows with geo-enrichment', url: ama('azurenetworkanalytics_cl') },
    ],
    kqlExample: `AzureNetworkAnalytics_CL
| where TimeGenerated > ago(1h)
| where FlowType_s != "Unknown"
| summarize count() by FlowType_s, L7Protocol_s`,
    note: 'Extremely high volume — one of the largest ingestion sources in most Azure environments. Strongly recommended for Data Lake tier.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/network-watcher/network-watcher-nsg-flow-logging-overview',
  },

  {
    sourceId: 'waf',
    connectorName: 'Azure Application Gateway / Front Door WAF',
    tables: [
      { name: 'AGWAccessLogs', description: 'All HTTP/S requests processed by Application Gateway', url: ama('agwaccesslogs') },
      { name: 'AGWFirewallLogs', description: 'WAF rule evaluations — blocked and detected requests', url: ama('agwfirewalllogs') },
      { name: 'AzureDiagnostics', description: 'WAF logs in legacy diagnostics mode', url: ama('azurediagnostics') },
    ],
    kqlExample: `AGWFirewallLogs
| where TimeGenerated > ago(24h)
| where Action == "Blocked"
| summarize count() by RuleId
| top 10 by count_`,
    note: 'Use resource-specific diagnostics (AGWAccessLogs / AGWFirewallLogs) rather than AzureDiagnostics to reduce noise.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/azure-web-application-firewall-waf',
  },

  {
    sourceId: 'dns',
    connectorName: 'Windows DNS Events via AMA',
    tables: [
      { name: 'DnsEvents', description: 'DNS query and response events', url: ama('dnsevents') },
      { name: 'DnsInventory', description: 'DNS server configuration and zone inventory', url: ama('dnsinventory') },
    ],
    kqlExample: `DnsEvents
| where TimeGenerated > ago(24h)
| summarize count() by Name
| top 20 by count_`,
    note: 'High volume on busy name servers. Useful for C2 detection via summary rules — consider Data Lake tier with aggregation DCR.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/dns',
  },

  {
    sourceId: 'third-party-firewall',
    connectorName: 'Common Event Format (CEF) via AMA',
    tables: [
      { name: 'CommonSecurityLog', description: 'CEF-formatted events from third-party network appliances', url: ama('commonsecuritylog') },
      { name: 'Syslog', description: 'Raw syslog events from appliances not using CEF format', url: ama('syslog') },
    ],
    kqlExample: `CommonSecurityLog
| where TimeGenerated > ago(1h)
| summarize count() by DeviceVendor, DeviceProduct
| top 10 by count_`,
    note: 'CEF-formatted logs land in CommonSecurityLog. Volume depends on rule count, traffic volume, and logging verbosity.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/connect-common-event-format',
  },

  {
    sourceId: 'vpn-ztna',
    connectorName: 'Common Event Format (CEF) via AMA / Vendor-specific connector',
    tables: [
      { name: 'CommonSecurityLog', description: 'CEF-formatted authentication and session events', url: ama('commonsecuritylog') },
      { name: 'Syslog', description: 'Syslog-formatted VPN session events', url: ama('syslog') },
    ],
    kqlExample: `CommonSecurityLog
| where TimeGenerated > ago(24h)
| where DeviceVendor has_any ("Zscaler","Cisco","Fortinet","Palo Alto Networks")
| summarize count() by DeviceVendor, DeviceAction`,
    note: 'Check the Sentinel Content Hub for vendor-specific connectors (e.g. Zscaler, Cisco ASA) which enrich the CommonSecurityLog schema.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors-reference',
  },

  // ── Third-party & Custom ──────────────────────────────────────────────────

  {
    sourceId: 'email-gateway',
    connectorName: 'Common Event Format (CEF) via AMA / Vendor-specific connector',
    tables: [
      { name: 'CommonSecurityLog', description: 'CEF-formatted email gateway events (accept, reject, quarantine)', url: ama('commonsecuritylog') },
    ],
    kqlExample: `CommonSecurityLog
| where TimeGenerated > ago(24h)
| where DeviceVendor has_any ("Mimecast","Proofpoint","Barracuda")
| summarize count() by DeviceAction
| top 10 by count_`,
    note: 'Mimecast and Proofpoint have dedicated Sentinel connectors in Content Hub that map into CommonSecurityLog with richer field parsing.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors-reference',
  },

  {
    sourceId: 'custom-app',
    connectorName: 'Custom Logs via AMA / Logs Ingestion API',
    tables: [
      { name: '{TableName}_CL', description: 'Customer-defined custom table (schema defined via DCR or Logs Ingestion API)', url: 'https://learn.microsoft.com/en-us/azure/sentinel/connect-custom-logs-ama' },
    ],
    kqlExample: `// Replace with your custom table name:
// YourTableName_CL
// | where TimeGenerated > ago(24h)
// | take 10`,
    note: 'Custom tables use the _CL suffix. Define the schema via a Data Collection Rule (DCR) or the Logs Ingestion API endpoint.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/connect-custom-logs-ama',
  },

  // ── Server Workloads ─────────────────────────────────────────────────────
  // These entries are shared across all Windows (ws-*) and Linux (lx-*) workloads.

  {
    sourceId: 'ws-security',
    connectorName: 'Windows Security Events via AMA',
    tables: [
      { name: 'SecurityEvent', description: 'Windows Security event log entries', url: ama('securityevent') },
    ],
    kqlExample: `SecurityEvent
| where TimeGenerated > ago(24h)
| summarize count() by EventID
| top 10 by count_`,
    note: 'Collection level (Minimal / Common / All Events) has the biggest impact on volume. Common is recommended for MXDR.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/windows-security-events-via-ama',
  },

  {
    sourceId: 'lx-syslog',
    connectorName: 'Syslog via AMA',
    tables: [
      { name: 'Syslog', description: 'Linux syslog messages from all configured facilities', url: ama('syslog') },
    ],
    kqlExample: `Syslog
| where TimeGenerated > ago(24h)
| summarize count() by Facility, SeverityLevel
| top 10 by count_`,
    note: 'NOT eligible for the Defender for Servers P2 benefit. Filter noisy facilities (e.g. cron, systemd) via DCR to control volume.',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/sentinel/data-connectors/syslog',
  },
]

/** Look up the table mapping for a given source or workload ID */
export const SOURCE_TABLE_MAPPINGS: Record<string, SourceTableMapping> =
  Object.fromEntries(MAPPINGS.map(m => [m.sourceId, m]))

/** Resolve a server workload ID to its shared table mapping key */
export function resolveWorkloadMappingId(workloadId: string): string {
  if (workloadId.startsWith('ws-')) return 'ws-security'
  if (workloadId.startsWith('lx-')) return 'lx-syslog'
  return workloadId
}
