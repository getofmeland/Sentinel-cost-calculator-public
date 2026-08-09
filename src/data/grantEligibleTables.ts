/**
 * Which TABLES each free-ingestion grant covers.
 *
 * The estimator already models both grants, but keys them on its own source ids
 * — `mde`, `entra-id`, and so on. Analyse mode works on measured table names and
 * had no equivalent, so it applied neither grant and charged full rate for data
 * Microsoft gives away. On a real 162-server tenant that overstated the bill by
 * about 40%, almost all of it Defender for Servers rather than E5.
 *
 * Both lists are transcribed from Microsoft, not inferred from table names.
 */

/**
 * Defender for Servers Plan 2: 500 MB per node per day.
 *
 * Verbatim: "When you enable Defender for Servers Plan 2 in Microsoft Defender
 * for Cloud, you receive 500 MB of free data ingestion per node daily… The total
 * daily data allowance granted equals the number of machines × 500 MB… calculated
 * across all machines in a subscription, not enforced per machine."
 * https://learn.microsoft.com/en-us/azure/defender-for-cloud/data-ingestion-benefit
 *
 * Two conditions worth surfacing rather than assuming:
 *   - Plan 2 must be enabled on the WORKSPACE, not merely on the subscription.
 *     Enabling it on the subscription alone grants nothing here.
 *   - Update and UpdateSummary qualify only when the Update Management solution
 *     is not running in the workspace, or solution targeting is enabled.
 *
 * WindowsEvent appears on Microsoft's list but is deliberately EXCLUDED here.
 * Its own footnote: "only security events from the Microsoft-SecurityEvent
 * stream that go to the SecurityEvent table qualify… Application, System, or
 * other event log channels aren't covered and are billed as regular ingestion."
 * Since the qualifying part lands in SecurityEvent, counting WindowsEvent too
 * would credit the same events twice.
 */
export const P2_GRANT_MB_PER_SERVER_PER_DAY = 500

export const P2_ELIGIBLE_TABLES: ReadonlySet<string> = new Set([
  'securityalert',
  'securitybaseline',
  'securitybaselinesummary',
  'securitydetection',
  'securityevent',
  'windowsfirewall',
  'protectionstatus',
  'update',
  'updatesummary',
  'mdcfileintegritymonitoringevents',
  'devicecustomfileevents',
  'devicecustomregistryevents',
].map(t => t.toLowerCase()))

/**
 * Microsoft 365 E5 / A5 / F5 / G5 (and the E5 Security add-ons): 5 MB per
 * LICENSED USER per day.
 *
 * https://azure.microsoft.com/en-us/pricing/offers/sentinel-microsoft-365-offer/
 *
 * The offer names four categories, and this list is those four expanded to the
 * tables each actually writes:
 *   1. Microsoft Entra ID sign-in and audit logs
 *   2. Microsoft Defender for Cloud Apps shadow IT discovery
 *   3. Microsoft Purview Information Protection
 *   4. Microsoft 365 advanced hunting data
 *
 * Note the denominator: LICENSED SEATS of a qualifying SKU, not headcount and
 * not total accounts. A tenant with 300 accounts, 70 staff and 100 E5 licences
 * earns 100 × 5 MB, and taking any of the other two numbers over-credits it —
 * understating the bill, which is the direction this project must never err in.
 */
export const E5_GRANT_MB_PER_LICENSED_USER_PER_DAY = 5

export const E5_ELIGIBLE_TABLES: ReadonlySet<string> = new Set([
  // 1. Entra ID sign-in and audit
  'signinlogs',
  'aadnoninteractiveusersigninlogs',
  'aadserviceprincipalsigninlogs',
  'aadmanagedidentitysigninlogs',
  'adfssigninlogs',
  'auditlogs',
  'aadprovisioninglogs',
  'aadriskyusers',
  'aaduserriskevents',
  'aadriskyserviceprincipals',
  'aadserviceprincipalriskevents',
  // 2. Defender for Cloud Apps shadow IT discovery
  'mcasshadowitreporting',
  // 3. Purview Information Protection
  'microsoftpurviewinformationprotection',
  // 4. Microsoft 365 advanced hunting — the Defender XDR stream
  'deviceevents',
  'devicefileevents',
  'devicefilecertificateinfo',
  'deviceimageloadevents',
  'deviceinfo',
  'devicelogonevents',
  'devicenetworkevents',
  'devicenetworkinfo',
  'deviceprocessevents',
  'deviceregistryevents',
  'devicecustomfileevents',
  'devicecustomregistryevents',
  'emailevents',
  'emailattachmentinfo',
  'emailurlinfo',
  'emailpostdeliveryevents',
  'urlclickevents',
  'identitylogonevents',
  'identityqueryevents',
  'identitydirectoryevents',
  'identityinfo',
  'cloudappevents',
  'alertevidence',
  'alertinfo',
  'behaviorinfo',
  'behaviorentities',
].map(t => t.toLowerCase()))

export function isP2Eligible(tableName: string): boolean {
  return P2_ELIGIBLE_TABLES.has(tableName.trim().toLowerCase())
}

export function isE5Eligible(tableName: string): boolean {
  return E5_ELIGIBLE_TABLES.has(tableName.trim().toLowerCase())
}
