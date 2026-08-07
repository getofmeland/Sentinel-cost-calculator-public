import { SOURCE_TABLE_MAPPINGS } from './sentinelTables'
import { getDefaultTier, TIER_PLACEMENT_DEFAULTS, type TierRecommendation } from './tierPlacement'
import { LOG_SOURCES } from './pricing'
import {
  lookupTable, guessFromName, TABLE_CATALOGUE,
  type DataCategory, type TableGuess,
} from './tableCatalogue'
import { lookupConnectors, type ConnectorAttribution } from './connectorIndex'

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
   * Whether the table can be switched to the Auxiliary/Lake plan at all.
   *
   * Microsoft publishes "Auxiliary / Lake table support: No" for a number of
   * tables — ThreatIntelIndicators among them — and no cost pressure changes
   * that. Recommending a move for one would be advice the customer physically
   * cannot follow. Defaults true for tables we only know through the source
   * mapping, which are the common security tables that do support it.
   */
  lakeCapable: boolean
  /** Security, operational, mixed or platform, when known */
  category: DataCategory | null
  /** Extra warning specific to this table */
  caveat: string | null
  /** Human description, when catalogued */
  description: string | null
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
  /**
   * Connectors documented as writing to this table, when known.
   *
   * Attribution only — it never contributes to the tier decision. A table can
   * arrive from several connectors, and which one you run changes nothing about
   * what the table costs or which plans it supports.
   */
  connectors: string[]
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
    const catalogued = lookupTable(key)

    index.set(key, {
      table: key,
      sourceIds,
      recommendation: agreed ? recommendations[0] : null,
      ambiguousButAgreed: agreed && sourceIds.length > 1,
      needsUserInput: !agreed,
      reason: agreed ? (reasonBySource.get(sourceIds[0]) ?? null) : null,
      // Free only if every claimant is free; a mixed table is billable.
      isFree: sourceIds.every(id => freeSourceIds.has(id)),
      lakeCapable: catalogued?.lakeCapable ?? true,
      category: catalogued?.category ?? null,
      caveat: catalogued?.caveat ?? null,
      description: catalogued?.description ?? null,
      connectors: lookupConnectors(key)?.connectors ?? [],
    })
  }

  // Catalogued tables the source mapping does not cover — multi-cloud, threat
  // intelligence, and the operational data that makes up much of a real
  // workspace. These are the ones a tester found reported as "Unrecognised".
  for (const entry of TABLE_CATALOGUE) {
    const key = entry.name.toLowerCase()
    if (index.has(key)) continue
    index.set(key, {
      table: key,
      sourceIds: [],
      recommendation: entry.recommendedTier,
      ambiguousButAgreed: false,
      needsUserInput: false,
      reason: entry.reason,
      isFree: !entry.billable,
      lakeCapable: entry.lakeCapable,
      category: entry.category,
      caveat: entry.caveat ?? null,
      description: entry.description,
      connectors: lookupConnectors(key)?.connectors ?? [],
    })
  }

  return index
}

const TABLE_INDEX = buildIndex()

/** Look up a measured table name. Case-insensitive; null when unmapped. */
export function matchTable(tableName: string): TableMatch | null {
  return TABLE_INDEX.get(tableName.trim().toLowerCase()) ?? null
}

/**
 * Best-effort identification for a table we do not know, from naming
 * convention alone. Names the likely family and stops — it never yields a tier
 * recommendation, because guessing what a table contains is no basis for
 * telling someone to move their data.
 */
export function guessTable(tableName: string): TableGuess | null {
  return guessFromName(tableName)
}

/**
 * Which connector writes a table, for tables the catalogue does not cover.
 *
 * This is the difference between "Unrecognised" and "Netskope Data Connector"
 * on a row the tool otherwise has nothing to say about. It is deliberately
 * weaker than a catalogue entry: it names the source and stops, because knowing
 * who sent the data tells you nothing about what it costs to keep.
 */
export function attributeTable(tableName: string): ConnectorAttribution | null {
  return lookupConnectors(tableName)
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
