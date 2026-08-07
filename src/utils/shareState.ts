import { LOG_SOURCES, RetentionStrategy } from '../data/pricing'
import { SERVER_WORKLOADS } from '../data/serverWorkloads'
import { LogTierKey } from '../data/logTiers'
import { TshirtSize, TSHIRT_SIZES } from '../data/tshirtSizes'
import { CompliancePresetId, COMPLIANCE_PRESETS } from '../data/compliancePresets'
import { M365Licence, LICENCES } from '../data/licenceBenefits'
import { CurrencyCode } from './currency'
import { AZURE_REGION_GROUPS } from '../services/azurePricing'
import {
  DEFAULT_COMPUTE_CONFIG,
  GRAPH_SCHEDULE_RUNS_PER_MONTH,
  type ComputeConfig,
  type GraphSchedule,
} from './compute'
import { ADI_POOL_VCORES, type AdiPoolVCores } from '../data/pricing'

/**
 * Encodes an estimate into a URL so it survives a refresh and can be sent to a
 * colleague or client, and restores it on load.
 *
 * Two rules shape the design:
 *
 * 1. Only what differs from the defaults is written. Most users change a
 *    handful of sources, so a diff keeps typical links short enough to paste
 *    into an email without them wrapping.
 * 2. Nothing parsed from a URL is trusted. Every id is checked against the data
 *    files and every number is range-checked, because a link is user-editable
 *    input arriving straight into the pricing maths.
 */

/** Bumped when the encoding changes shape. Unknown versions are ignored rather than misread. */
export const SHARE_SCHEMA_VERSION = 1

export const MIN_USERS = 100
export const MAX_USERS = 50000

export interface ShareableState {
  userCount: number
  selectedIds: string[]
  globalSize: TshirtSize
  activePresetId: CompliancePresetId
  mifidExtended: boolean
  globalRetentionStrategy: RetentionStrategy
  licence: M365Licence
  defenderEnabled: boolean
  region: string
  displayCurrency: CurrencyCode
  serverCounts: Record<string, number>
  serverLevels: Record<string, string>
  deviceCounts: Record<string, number>
  logTiers: Record<string, LogTierKey>
  retentionDays: Record<string, number>
  selectedVariants: Record<string, string>
  manualGbValues: Record<string, number>
  sizeOverrides: Record<string, TshirtSize>
  retentionStrategies: Record<string, RetentionStrategy>
  compute: ComputeConfig
}

export const DEFAULT_SHARE_STATE: ShareableState = {
  userCount: 500,
  selectedIds: [],
  globalSize: 'M',
  activePresetId: 'custom',
  mifidExtended: false,
  globalRetentionStrategy: 'data-lake-mirror',
  licence: 'none',
  defenderEnabled: false,
  region: 'uksouth',
  displayCurrency: 'GBP',
  serverCounts: {},
  serverLevels: {},
  deviceCounts: {},
  logTiers: {},
  retentionDays: {},
  selectedVariants: {},
  manualGbValues: {},
  sizeOverrides: {},
  retentionStrategies: {},
  compute: DEFAULT_COMPUTE_CONFIG,
}

// ─── Known-value sets, used to reject anything a URL invents ──────────────────

const SOURCE_IDS = new Set(LOG_SOURCES.map(s => s.id))
const WORKLOAD_IDS = new Set(SERVER_WORKLOADS.map(w => w.id))
const ANY_ID = new Set([...SOURCE_IDS, ...WORKLOAD_IDS])
const SIZES = new Set(TSHIRT_SIZES.map(s => s.id))
const PRESET_IDS = new Set(COMPLIANCE_PRESETS.map(p => p.id))
const LICENCE_IDS = new Set(LICENCES.map(l => l.id))
const REGIONS = new Set(AZURE_REGION_GROUPS.flatMap(g => g.regions.map(r => r.arm)))
const TIERS = new Set<LogTierKey>(['analytics', 'data-lake'])
const STRATEGIES = new Set<RetentionStrategy>(['analytics-extended', 'data-lake-mirror'])
const CURRENCIES = new Set<CurrencyCode>(['GBP', 'USD', 'EUR'])

// ─── Encoding ────────────────────────────────────────────────────────────────

/** "a:1,b:2" — omitted entirely when empty */
function encodeMap(map: Record<string, string | number>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
}

function decodeMap(raw: string | null): Array<[string, string]> {
  if (!raw) return []
  return raw
    .split(',')
    .map(pair => {
      const idx = pair.indexOf(':')
      return idx === -1 ? null : ([pair.slice(0, idx), pair.slice(idx + 1)] as [string, string])
    })
    .filter((p): p is [string, string] => p !== null)
}

export function encodeShareState(state: ShareableState): string {
  const p = new URLSearchParams()
  p.set('v', String(SHARE_SCHEMA_VERSION))

  const d = DEFAULT_SHARE_STATE
  if (state.userCount !== d.userCount) p.set('u', String(state.userCount))
  if (state.selectedIds.length) p.set('s', state.selectedIds.join(','))
  if (state.globalSize !== d.globalSize) p.set('sz', state.globalSize)
  if (state.activePresetId !== d.activePresetId) p.set('p', state.activePresetId)
  if (state.mifidExtended) p.set('mx', '1')
  if (state.globalRetentionStrategy !== d.globalRetentionStrategy) p.set('rs', state.globalRetentionStrategy)
  if (state.licence !== d.licence) p.set('l', state.licence)
  if (state.defenderEnabled) p.set('df', '1')
  if (state.region !== d.region) p.set('r', state.region)
  if (state.displayCurrency !== d.displayCurrency) p.set('c', state.displayCurrency)

  const maps: Array<[string, Record<string, string | number>]> = [
    ['sc', state.serverCounts],
    ['sl', state.serverLevels],
    ['dc', state.deviceCounts],
    ['lt', state.logTiers],
    ['rd', state.retentionDays],
    ['sv', state.selectedVariants],
    ['mg', state.manualGbValues],
    ['so', state.sizeOverrides],
    ['st', state.retentionStrategies],
  ]
  for (const [key, map] of maps) {
    const encoded = encodeMap(map)
    if (encoded) p.set(key, encoded)
  }

  // Compute config travels as one compact field, and only when a meter is on.
  // Order is positional, so the parser must stay in step with this list.
  const c = state.compute
  if (c.graphEnabled || c.adiEnabled) {
    p.set('cp', [
      c.graphEnabled ? 1 : 0,
      c.graphSchedule,
      c.graphBuildsPerMonth,
      c.graphBuildMinutes,
      c.graphQueriesPerMonth,
      c.graphQueryMinutes,
      c.graphBuildNotebookMinutes,
      c.adiEnabled ? 1 : 0,
      c.adiPoolVCores,
      c.adiInteractiveHoursPerMonth,
      c.adiInteractiveSessionsPerMonth,
      c.adiScheduledHoursPerMonth,
    ].join('~'))
  }

  return p.toString()
}

// ─── Decoding ────────────────────────────────────────────────────────────────

function clampInt(raw: string, min: number, max: number): number | null {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

function positiveFloat(raw: string, max: number): number | null {
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(max, n)
}

/**
 * Rebuild state from a query string, discarding anything unrecognised.
 *
 * Returns null when there is nothing to restore or the schema version is one
 * this build does not understand — better to show a fresh estimate than to
 * reconstruct a link wrongly and present the result as the sender's numbers.
 */
export function decodeShareState(search: string): ShareableState | null {
  const p = new URLSearchParams(search)
  const version = p.get('v')
  if (!version) return null
  if (Number.parseInt(version, 10) !== SHARE_SCHEMA_VERSION) {
    console.warn(`[shareState] Ignoring link with unsupported schema version ${version}`)
    return null
  }

  const state: ShareableState = {
    ...DEFAULT_SHARE_STATE,
    serverCounts: {}, serverLevels: {}, deviceCounts: {}, logTiers: {},
    retentionDays: {}, selectedVariants: {}, manualGbValues: {},
    sizeOverrides: {}, retentionStrategies: {},
  }

  const userCount = p.get('u')
  if (userCount) state.userCount = clampInt(userCount, MIN_USERS, MAX_USERS) ?? DEFAULT_SHARE_STATE.userCount

  const selected = p.get('s')
  if (selected) state.selectedIds = selected.split(',').filter(id => SOURCE_IDS.has(id))

  const size = p.get('sz')
  if (size && SIZES.has(size as TshirtSize)) state.globalSize = size as TshirtSize

  const preset = p.get('p')
  if (preset && PRESET_IDS.has(preset as CompliancePresetId)) state.activePresetId = preset as CompliancePresetId

  state.mifidExtended = p.get('mx') === '1'
  state.defenderEnabled = p.get('df') === '1'

  const strategy = p.get('rs')
  if (strategy && STRATEGIES.has(strategy as RetentionStrategy)) {
    state.globalRetentionStrategy = strategy as RetentionStrategy
  }

  const licence = p.get('l')
  if (licence && LICENCE_IDS.has(licence as M365Licence)) state.licence = licence as M365Licence

  const region = p.get('r')
  if (region && REGIONS.has(region)) state.region = region

  const currency = p.get('c')
  if (currency && CURRENCIES.has(currency as CurrencyCode)) state.displayCurrency = currency as CurrencyCode

  for (const [id, raw] of decodeMap(p.get('sc'))) {
    if (!WORKLOAD_IDS.has(id)) continue
    const n = clampInt(raw, 0, 100000)
    if (n !== null) state.serverCounts[id] = n
  }

  for (const [id, raw] of decodeMap(p.get('sl'))) {
    const workload = SERVER_WORKLOADS.find(w => w.id === id)
    if (workload?.collectionLevels.some(l => l.id === raw)) state.serverLevels[id] = raw
  }

  for (const [id, raw] of decodeMap(p.get('dc'))) {
    if (!SOURCE_IDS.has(id)) continue
    const n = clampInt(raw, 0, 100000)
    if (n !== null) state.deviceCounts[id] = n
  }

  for (const [id, raw] of decodeMap(p.get('lt'))) {
    if (ANY_ID.has(id) && TIERS.has(raw as LogTierKey)) state.logTiers[id] = raw as LogTierKey
  }

  for (const [id, raw] of decodeMap(p.get('rd'))) {
    if (!ANY_ID.has(id)) continue
    const n = clampInt(raw, 0, 4380)
    if (n !== null) state.retentionDays[id] = n
  }

  for (const [id, raw] of decodeMap(p.get('sv'))) {
    const source = LOG_SOURCES.find(s => s.id === id)
    if (source?.variants?.some(v => v.id === raw)) state.selectedVariants[id] = raw
  }

  for (const [id, raw] of decodeMap(p.get('mg'))) {
    if (!SOURCE_IDS.has(id)) continue
    // Bounded: a hand-edited link should not be able to drive the totals to
    // absurdity, and the calculation layer's guards are a backstop, not a cap.
    const n = positiveFloat(raw, 100000)
    if (n !== null) state.manualGbValues[id] = n
  }

  for (const [id, raw] of decodeMap(p.get('so'))) {
    if (ANY_ID.has(id) && SIZES.has(raw as TshirtSize)) state.sizeOverrides[id] = raw as TshirtSize
  }

  for (const [id, raw] of decodeMap(p.get('st'))) {
    if (ANY_ID.has(id) && STRATEGIES.has(raw as RetentionStrategy)) {
      state.retentionStrategies[id] = raw as RetentionStrategy
    }
  }

  const compute = p.get('cp')
  if (compute) state.compute = decodeCompute(compute)

  return state
}

const SCHEDULES = new Set<GraphSchedule>(
  Object.keys(GRAPH_SCHEDULE_RUNS_PER_MONTH) as GraphSchedule[],
)
const POOLS = new Set<number>(ADI_POOL_VCORES)

/**
 * Compute config from its positional encoding. Every field is bounded — an
 * hourly rebuild is already thousands a month, so a hand-edited link must not
 * be able to drive the figure to nonsense.
 */
function decodeCompute(raw: string): ComputeConfig {
  const parts = raw.split('~')
  const num = (i: number, max: number, fallback: number) => {
    const n = Number.parseFloat(parts[i])
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback
  }

  const d = DEFAULT_COMPUTE_CONFIG
  const schedule = parts[1] as GraphSchedule
  const pool = Number.parseInt(parts[8], 10)

  return {
    graphEnabled: parts[0] === '1',
    graphSchedule: SCHEDULES.has(schedule) ? schedule : d.graphSchedule,
    graphBuildsPerMonth: num(2, 100000, d.graphBuildsPerMonth),
    graphBuildMinutes: num(3, 1440, d.graphBuildMinutes),          // a day is generous
    graphQueriesPerMonth: num(4, 10000000, d.graphQueriesPerMonth),
    graphQueryMinutes: num(5, 7.5, d.graphQueryMinutes),           // documented query timeout
    graphBuildNotebookMinutes: num(6, 1440, d.graphBuildNotebookMinutes),
    adiEnabled: parts[7] === '1',
    adiPoolVCores: POOLS.has(pool) ? (pool as AdiPoolVCores) : d.adiPoolVCores,
    adiInteractiveHoursPerMonth: num(9, 100000, d.adiInteractiveHoursPerMonth),
    adiInteractiveSessionsPerMonth: num(10, 100000, d.adiInteractiveSessionsPerMonth),
    adiScheduledHoursPerMonth: num(11, 100000, d.adiScheduledHoursPerMonth),
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sentinel-cost-calculator:estimate'

export function saveToStorage(state: ShareableState): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeShareState(state))
  } catch {
    // Private browsing or a full quota. Losing autosave is not worth an error.
  }
}

export function loadFromStorage(): ShareableState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? decodeShareState(raw) : null
  } catch {
    return null
  }
}

/**
 * A shared link always wins over the recipient's own saved estimate — opening
 * someone else's link must show their numbers, not yours.
 */
export function loadInitialState(search: string): ShareableState | null {
  return decodeShareState(search) ?? loadFromStorage()
}
