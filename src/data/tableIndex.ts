import { SOURCE_TABLE_MAPPINGS } from './sentinelTables'
import { getDefaultTier, TIER_PLACEMENT_DEFAULTS, type TierRecommendation } from './tierPlacement'
import { LOG_SOURCES } from './pricing'

/**
 * Reverse index from Sentinel table name to the log source that produces it.
 *
 * The calculator's data model is organised by SOURCE (entra-id, mde, dns) but
 * measured ingestion arrives as TABLES (SigninLogs, DeviceEvents,
 * CommonSecurityLog). This bridges the two so a measured table can reach a
 * costed recommendation.
 *
 * The mapping is genuinely many-to-many. Three tables are claimed by more than
 * one source, and that is not a modelling error — CommonSecurityLog really does
 * carry CEF from firewalls, VPN concentrators and email gateways alike, and
 * AzureDiagnostics is a catch-all dozens of Azure services write into. The
 * table name alone cannot tell you what is inside.
 */

export interface TableMatch {
  table: string
  /** Every source that claims this table */
  sourceIds: string[]
  /**
   * The tier we recommend, when every claimant agrees. Null when claimants
   * disagree, which means the user has to say what the table actually contains.
   */
  recommendation: TierRecommendation | null
  /** True when more than one source claims the table but all agree */
  ambiguousButAgreed: boolean
  /** True when claimants disagree and we must not guess */
  needsUserInput: boolean
  /** Reason text from the placement rules, when there is a single agreed answer */
  reason: string | null
  /** True when Microsoft does not charge for this table */
  isFree: boolean
}

function buildIndex(): Map<string, TableMatch> {
  const claims = new Map<string, string[]>()

  for (const [sourceId, mapping] of Object.entries(SOURCE_TABLE_MAPPINGS)) {
    for (const t of mapping.tables) {
      // The mapping includes a "{TableName}_CL" placeholder for custom tables,
      // which is documentation rather than a real table name.
      if (t.name.includes('{')) continue
      const key = t.name.toLowerCase()
      claims.set(key, [...(claims.get(key) ?? []), sourceId])
    }
  }

  const freeSourceIds = new Set(LOG_SOURCES.filter(s => s.isFree).map(s => s.id))
  const reasonBySource = new Map(TIER_PLACEMENT_DEFAULTS.map(d => [d.sourceId, d.reason]))

  const index = new Map<string, TableMatch>()
  for (const [key, sourceIds] of claims) {
    const recommendations = [...new Set(sourceIds.map(getDefaultTier))]
    const agreed = recommendations.length === 1

    index.set(key, {
      table: key,
      sourceIds,
      recommendation: agreed ? recommendations[0] : null,
      ambiguousButAgreed: agreed && sourceIds.length > 1,
      needsUserInput: !agreed,
      reason: agreed ? (reasonBySource.get(sourceIds[0]) ?? null) : null,
      // Free only if every claimant is free; a mixed table is billable.
      isFree: sourceIds.every(id => freeSourceIds.has(id)),
    })
  }

  return index
}

const TABLE_INDEX = buildIndex()

/** Look up a measured table name. Case-insensitive; null when unmapped. */
export function matchTable(tableName: string): TableMatch | null {
  return TABLE_INDEX.get(tableName.trim().toLowerCase()) ?? null
}

export function indexedTableCount(): number {
  return TABLE_INDEX.size
}

/** Tables claimed by more than one source, for tests and diagnostics. */
export function ambiguousTables(): TableMatch[] {
  return [...TABLE_INDEX.values()].filter(m => m.sourceIds.length > 1)
}

/**
 * Tables Microsoft lists as free that a workspace should never be billed for.
 * Used to spot misconfiguration: billable volume here means something is wrong.
 *
 * Sourced from the Sentinel billing doc's free-data table rather than inferred
 * from the calculator's own source list, because it includes tables the
 * estimator does not model as sources at all.
 */
export const ALWAYS_FREE_TABLES = new Set([
  'azureactivity',
  'sentinelhealth',
  'officeactivity',
  'securityincident',
  'securityalert',
  'heartbeat',
  'usage',
  'operation',
].map(t => t.toLowerCase()))

export function isAlwaysFreeTable(tableName: string): boolean {
  return ALWAYS_FREE_TABLES.has(tableName.trim().toLowerCase())
}
