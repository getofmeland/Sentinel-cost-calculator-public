import type { CatalogueEntry } from './tableCatalogue'

/**
 * Tables the Defender for Servers Plan 2 grant covers, plus the VM Insights and
 * legacy solution families that arrive alongside them.
 *
 * A real tenant's report showed thirteen tables as "Unrecognised", and six of
 * them turned out to be on Microsoft's P2 eligible list. That was tolerable
 * while the tool ignored the grant. It is not now: the grant is modelled, it
 * was worth £401/month on that tenant, and a table the catalogue cannot name is
 * a table the reader cannot tell is already free.
 *
 * Every P2-eligible table is catalogued here whether or not that tenant had it,
 * so the grant and the catalogue cover the same set. Plan support is verified
 * against each table's reference page and pinned in tablePlanSupport.ts.
 *
 * On tier advice for this family: most publish Basic: No and Lake: No, so there
 * is nothing to recommend anyway. Where a cheaper plan does exist the entry
 * says so but does not push it, because Microsoft states the benefit applies to
 * "eligible security data ingested into that workspace" without saying whether
 * a plan change forfeits it. Recommending a move that might cost someone a
 * 500 MB-per-server allowance to save a few pounds is not a trade worth making
 * on an unverified reading.
 */

const P2_COVERED: CatalogueEntry[] = [
  {
    name: 'SecurityBaseline',
    description: 'Per-machine results of OS security baseline assessment.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Posture evidence, and covered by the Defender for Servers Plan 2 allowance.',
    caveat: 'Supports neither Basic nor the Lake tier. If Plan 2 is enabled on the workspace it is likely free already — 500 MB per server per day, pooled.',
  },
  {
    name: 'SecurityBaselineSummary',
    description: 'Rolled-up baseline compliance per machine.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Summary companion to SecurityBaseline; tiny by volume.',
    caveat: 'Supports neither Basic nor the Lake tier, and is covered by the Plan 2 allowance.',
  },
  {
    name: 'SecurityDetection',
    description: 'Detections raised by Defender for Cloud against machine telemetry.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Detection output — the thing your rules act on.',
    caveat: 'Supports neither Basic nor the Lake tier, and is covered by the Plan 2 allowance.',
  },
  {
    name: 'WindowsFirewall',
    description: 'Windows Firewall rule and connection events from the local host.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Host-level network enforcement, and covered by the Defender for Servers Plan 2 allowance.',
    caveat: 'The only table in this family that supports the Lake tier — but if Plan 2 covers it, it is already free, and Microsoft does not state whether a plan change forfeits the allowance. Check before moving it.',
  },
  {
    name: 'ProtectionStatus',
    description: 'Anti-malware protection state reported per machine.',
    category: 'security', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Tells you which machines are unprotected, which is the point of collecting it.',
    caveat: 'Supports neither Basic nor the Lake tier, and is covered by the Plan 2 allowance.',
  },
  {
    name: 'Update',
    description: 'Missing update assessment per machine, from Update Management.',
    category: 'mixed', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Patch state is both operational and a real vulnerability signal.',
    caveat: 'Covered by the Plan 2 allowance only when the Update Management solution is NOT running in the workspace, or solution targeting is enabled — Microsoft attaches that condition specifically to this table and UpdateSummary. Supports neither Basic nor the Lake tier.',
  },
  {
    name: 'UpdateSummary',
    description: 'Per-machine rollup of pending updates.',
    category: 'mixed', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Summary companion to Update; small.',
    caveat: 'Same conditional Plan 2 coverage as Update. Supports neither Basic nor the Lake tier.',
  },
  {
    name: 'MDCFileIntegrityMonitoringEvents',
    description: 'File integrity monitoring events from agentless FIM in Defender for Cloud.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true,
    recommendedTier: 'analytics',
    reason: 'Change detection on files that should not change — high signal, low volume.',
    caveat: 'Covered by the Plan 2 allowance. It does support Basic and the Lake tier, but moving it to save money while the allowance already covers it would be a poor trade.',
  },
  {
    name: 'DeviceCustomFileEvents',
    description: 'File events from custom Defender for Endpoint detection rules.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true,
    recommendedTier: 'analytics',
    reason: 'Output of rules you wrote deliberately — keep it where they can query it.',
    caveat: 'Eligible for BOTH the Defender for Servers Plan 2 allowance and the Microsoft 365 E5 data grant. It can only be credited once, whichever pool covers it.',
  },
  {
    name: 'DeviceCustomRegistryEvents',
    description: 'Registry events from custom Defender for Endpoint detection rules.',
    category: 'security', billable: true, lakeCapable: true, basicCapable: true,
    recommendedTier: 'analytics',
    reason: 'Output of rules you wrote deliberately — persistence detection usually.',
    caveat: 'Eligible for BOTH the Plan 2 allowance and the E5 data grant, and creditable only once.',
  },
]

/**
 * VM Insights, formerly Service Map.
 *
 * Pure infrastructure dependency mapping. It has genuine investigative value —
 * VMConnection is a record of which machine talked to which — but it is
 * collected for operations, and none of it supports a cheaper plan.
 */
const VM_INSIGHTS: CatalogueEntry[] = [
  {
    name: 'VMConnection',
    description: 'Inbound and outbound network connections observed per machine by VM Insights.',
    category: 'mixed', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Machine-to-machine connection history is genuinely useful when scoping lateral movement.',
    caveat: 'Supports neither Basic nor the Lake tier, so no tier change can reduce it. If nobody uses the VM Insights maps, the saving is turning the data collection rule off — not moving the table.',
  },
  {
    name: 'VMBoundPort',
    description: 'Ports each machine is listening on, sampled by VM Insights.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Inventory data rather than detection data.',
    caveat: 'Supports neither Basic nor the Lake tier. Reduce it by narrowing the VM Insights data collection rule.',
  },
  {
    name: 'VMProcess',
    description: 'Processes VM Insights observed binding ports or making connections.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Supports the dependency map; overlaps DeviceProcessEvents if you run Defender for Endpoint.',
    caveat: 'Supports neither Basic nor the Lake tier. Worth checking whether it duplicates MDE process telemetry you already pay for.',
  },
  {
    name: 'VMComputer',
    description: 'Machine inventory records maintained by VM Insights.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Small inventory table.',
    caveat: 'Supports neither Basic nor the Lake tier.',
  },
]

const DEVICE_MANAGEMENT: CatalogueEntry[] = [
  {
    name: 'IntuneDevices',
    description: 'Device inventory and compliance state exported from Intune.',
    category: 'mixed', billable: true, lakeCapable: true, basicCapable: true,
    recommendedTier: 'analytics',
    reason: 'Compliance state is posture context an analyst joins against during triage.',
    caveat: 'Refreshes as a full inventory rather than a change feed, so volume tracks device count and export frequency, not activity.',
  },
  {
    name: 'AppSystemEvents',
    description: 'Application Insights system-level telemetry.',
    category: 'operational', billable: true, lakeCapable: false, basicCapable: false,
    recommendedTier: 'analytics',
    reason: 'Developer telemetry attracting Sentinel rates because Application Insights points at this workspace.',
    caveat: 'Supports neither the Lake nor the Basic plan. The fix is pointing Application Insights at a workspace without Sentinel enabled.',
  },
]

export const P2_AND_INFRASTRUCTURE_CATALOGUE: CatalogueEntry[] = [
  ...P2_COVERED, ...VM_INSIGHTS, ...DEVICE_MANAGEMENT,
]
