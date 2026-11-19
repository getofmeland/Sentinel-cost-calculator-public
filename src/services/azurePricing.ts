import { CommitmentTier, PricingBundle, STATIC_PRICING_BUNDLE } from '../data/pricing'

export interface AzureRegion {
  arm: string
  label: string
}

export const AZURE_REGION_GROUPS: Array<{ group: string; regions: AzureRegion[] }> = [
  { group: 'UK', regions: [
    { arm: 'uksouth',  label: 'UK South' },
    { arm: 'ukwest',   label: 'UK West' },
  ]},
  { group: 'Europe', regions: [
    { arm: 'northeurope',        label: 'North Europe (Ireland)' },
    { arm: 'westeurope',         label: 'West Europe (Netherlands)' },
    { arm: 'francecentral',      label: 'France Central' },
    { arm: 'germanywestcentral', label: 'Germany West Central' },
    { arm: 'swedencentral',      label: 'Sweden Central' },
    { arm: 'switzerlandnorth',   label: 'Switzerland North' },
    { arm: 'norwayeast',         label: 'Norway East' },
  ]},
  { group: 'US', regions: [
    { arm: 'eastus',    label: 'East US' },
    { arm: 'eastus2',   label: 'East US 2' },
    { arm: 'westus2',   label: 'West US 2' },
    { arm: 'centralus', label: 'Central US' },
  ]},
  { group: 'Asia Pacific', regions: [
    { arm: 'southeastasia', label: 'Southeast Asia' },
    { arm: 'australiaeast', label: 'Australia East' },
  ]},
  { group: 'Other', regions: [
    { arm: 'uaenorth',         label: 'UAE North' },
    { arm: 'southafricanorth', label: 'South Africa North' },
  ]},
]

export const DEFAULT_REGION = 'uksouth'

/** Shown while a scheduled refetch of a missing regional meter is still outstanding. */
export const REGIONAL_RATE_RETRY_NOTE =
  'UK South list price. Checking this region\'s published rate again.'

/** Shown after that refetch still finds no meter in a successful price list. */
export const REGIONAL_RATE_UNPUBLISHED_NOTE =
  'This region has no published meter for this rate. Showing the UK South list price.'

/** A failed or unreadable lookup. This is not evidence the meter is unpublished. */
export const REGIONAL_RATE_UNCONFIRMED_NOTE =
  'UK South list price. This region\'s rate could not be confirmed.'

export type OptionalMeterLookup = 'live' | 'absent' | 'unavailable' | 'cached'

export interface RateMiss {
  count: number
  kind: 'absent' | 'unavailable'
}

/**
 * Decide the sentence beside a fallback rate.
 * Only a fresh, successful price list with no matching meter can become
 * "no published meter". A thrown request, or a value served from the short
 * cache, is "could not be confirmed" until a successful empty list says otherwise.
 */
export function nextRegionalRateNote(
  lookup: OptionalMeterLookup,
  previous: RateMiss | undefined,
): { note: string | null; miss: RateMiss | undefined; retry: boolean } {
  if (lookup === 'live') return { note: null, miss: undefined, retry: false }
  if (lookup === 'cached') {
    if (!previous) return { note: REGIONAL_RATE_UNCONFIRMED_NOTE, miss: undefined, retry: false }
    const retry = previous.count < 2
    const note = previous.kind === 'absent' && !retry
      ? REGIONAL_RATE_UNPUBLISHED_NOTE
      : previous.count >= 2
        ? REGIONAL_RATE_UNCONFIRMED_NOTE
        : REGIONAL_RATE_RETRY_NOTE
    return { note, miss: previous, retry }
  }
  const count = (previous?.count ?? 0) + 1
  const retry = count < 2
  if (lookup === 'unavailable') {
    return {
      note: retry ? REGIONAL_RATE_RETRY_NOTE : REGIONAL_RATE_UNCONFIRMED_NOTE,
      miss: { count, kind: 'unavailable' },
      retry,
    }
  }
  return {
    note: retry ? REGIONAL_RATE_RETRY_NOTE : REGIONAL_RATE_UNPUBLISHED_NOTE,
    miss: { count, kind: 'absent' },
    retry,
  }
}

export function getRegionLabel(arm: string): string {
  for (const { regions } of AZURE_REGION_GROUPS) {
    const found = regions.find(r => r.arm === arm)
    if (found) return found.label
  }
  return arm
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: PricingBundle
  fetchedAt: number
  isLive: boolean
  /** Set when the entry records a failed fetch, so it expires sooner */
  isFailure?: boolean
  /**
   * Sentinel meters were live, but an optional rate fell back to the UK South
   * figure. Kept only briefly so the missing query is retried, and surfaced in
   * the UI so a fallback is not presented as this region's live price.
   */
  shortTtl?: boolean
  defenderIsocRateIsFallback: boolean
  analyticsRetentionRateIsFallback: boolean
  defenderIsocLookup: Exclude<OptionalMeterLookup, 'cached'>
  analyticsRetentionLookup: Exclude<OptionalMeterLookup, 'cached'>
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

// A failed fetch is cached only briefly. Caching a transient network error for
// a full day would pin the user to static rates until they found the refresh
// button, with the UI giving no clue why.
export const FAILURE_CACHE_TTL_MS = 60 * 1000 // 1 min

export function clearRegionCache(arm: string) {
  cache.delete(arm)
}

// ─── API helpers ──────────────────────────────────────────────────────────────

// In dev the Vite proxy at /azure-pricing bypasses CORS.
// In production the Azure Functions proxy at /api/azure-pricing handles it server-side.
const BASE_URL = import.meta.env.DEV
  ? '/azure-pricing'
  : '/api/azure-pricing'

async function fetchPage(query: string, signal: AbortSignal): Promise<{ Items: AzurePriceItem[]; NextPageLink?: string }> {
  const res = await fetch(`${BASE_URL}?${query}`, { signal })
  if (!res.ok) throw new Error(`Azure pricing API ${res.status}`)
  return res.json()
}

export interface AzurePriceItem {
  meterName: string
  retailPrice: number
  unitOfMeasure: string
  armRegionName: string
  skuName?: string
  productName?: string
}

/** Cap on pages followed, so a malformed NextPageLink chain cannot loop forever */
const MAX_PAGES = 10

async function fetchAll(filter: string, signal: AbortSignal): Promise<AzurePriceItem[]> {
  const items: AzurePriceItem[] = []
  let query = `$filter=${encodeURIComponent(filter)}&$top=100`

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(query, signal)
    items.push(...result.Items)
    if (!result.NextPageLink) break

    // NextPageLink is an absolute prices.azure.com URL. Following it directly
    // would bypass the CORS proxy and fail in the browser, so carry only its
    // query string over to the proxied endpoint.
    query = new URL(result.NextPageLink).search.replace(/^\?/, '')
  }

  return items
}

/** A secondary price list is optional. Its failure must not drop the Sentinel rates. */
async function fetchOptional(
  filter: string,
  signal: AbortSignal,
): Promise<{ ok: true; items: AzurePriceItem[] } | { ok: false }> {
  try {
    return { ok: true, items: await fetchAll(filter, signal) }
  } catch (err) {
    console.warn('[azurePricing] Optional price query failed:', err)
    return { ok: false }
  }
}

function classifyOptional(
  result: { ok: true; items: AzurePriceItem[] } | { ok: false },
  parse: (items: AzurePriceItem[]) => number | null,
): { rate: number | null; lookup: Exclude<OptionalMeterLookup, 'cached'> } {
  if (!result.ok) return { rate: null, lookup: 'unavailable' }
  const rate = parse(result.items)
  return { rate, lookup: rate === null ? 'absent' : 'live' }
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

/**
 * Meter names as the retail API actually spells them. Note the lowercase "lake"
 * — an earlier `contains(meterName, 'Data Lake')` filter matched nothing at all
 * because the API's contains() is case-sensitive, so Data Lake pricing silently
 * fell back to static values while the UI displayed a "Live" badge.
 */
const METERS = {
  payg: 'Pay-as-you-go Analysis',
  paygLegacy: 'Analysis',
  lakeIngestion: 'Data lake ingestion Data Processed',
  lakeProcessing: 'Data processing Data Processed',
  lakeQuery: 'Data lake query Data Analyzed',
  lakeStorage: 'Data lake storage Data Stored',
  graph: 'Graph',
  advancedDataInsights: 'Advanced Data Insights',
  basicLogs: 'Basic Logs Analysis',
  auxiliaryLogs: 'Classic Auxiliary Logs Analysis',
  // Spelled differently from the Sentinel meter "Pay-as-you-go Analysis".
  // The hyphenation is the only thing that stops one parser reading the other.
  isocPayg: 'Pay As You Go Analysis',
  analyticsRetention: 'Analytics Logs Data Retention',
} as const

function priceOf(items: AzurePriceItem[], meterName: string): number | null {
  const item = items.find(i => i.meterName === meterName)
  return item ? item.retailPrice : null
}

/** Exported for testing against a recorded API response. */
export function parsePayg(items: AzurePriceItem[]): number | null {
  return priceOf(items, METERS.payg) ?? priceOf(items, METERS.paygLegacy)
}

/** Exported for testing against a recorded API response. */
export function parseTiers(items: AzurePriceItem[], paygRate: number): CommitmentTier[] {
  // Matches "100 GB Commitment Tier" (old) and "100 GB Commitment Tier Capacity Reservation" (current)
  const TIER_RE = /^(\d+)\s*GB\s+Commitment\s+Tier/i
  const parsed: CommitmentTier[] = []

  for (const item of items) {
    const match = TIER_RE.exec(item.meterName)
    if (!match) continue
    const gbPerDay = parseInt(match[1], 10)
    if (isNaN(gbPerDay)) continue
    const dailyCostUsd = item.retailPrice
    const effectiveRateUsd = gbPerDay > 0 ? dailyCostUsd / gbPerDay : paygRate
    const savingsVsPayg = paygRate > 0 ? 1 - effectiveRateUsd / paygRate : 0
    parsed.push({
      gbPerDay,
      dailyCostUsd,
      effectiveRateUsd,
      savingsVsPayg,
      isPreviewPromo: gbPerDay === 50 ? true : undefined,
    })
  }

  if (parsed.length === 0) return STATIC_PRICING_BUNDLE.commitmentTiers
  return parsed.sort((a, b) => a.gbPerDay - b.gbPerDay)
}

export interface DataLakeRates {
  /** Ingestion + data processing, which both apply to lake ingestion */
  ingestion: number | null
  query: number | null
  storage: number | null
}

/**
 * Defender ISOC analytics ingestion. The meter name is exact: the Sentinel
 * pay-as-you-go meter is hyphenated and must not match.
 * Exported for testing against a recorded API response.
 */
export function parseDefenderIsoc(items: AzurePriceItem[]): number | null {
  const matches = items.filter(i => i.meterName === METERS.isocPayg)
  if (matches.length === 0) return null
  const explicit = matches.find(i => i.productName === 'Microsoft Defender ISOC')
  return (explicit ?? matches[0]).retailPrice
}

/**
 * Interactive Analytics retention, billed by Log Analytics rather than Sentinel.
 * The Defender ISOC product publishes a meter with the same name at a different
 * price; that one is not this charge.
 * Exported for testing against a recorded API response.
 */
export function parseAnalyticsRetention(items: AzurePriceItem[]): number | null {
  const item = items.find(
    i => i.meterName === METERS.analyticsRetention && i.productName !== 'Microsoft Defender ISOC',
  )
  return item ? item.retailPrice : null
}

/** Exported for testing against a recorded API response. */
export function parseDataLake(items: AzurePriceItem[]): DataLakeRates {
  // Microsoft bills lake ingestion as two meters that both apply. Reading only
  // the first understates it roughly threefold.
  const lakeIngestion = priceOf(items, METERS.lakeIngestion)
  const processing = priceOf(items, METERS.lakeProcessing)

  return {
    ingestion:
      lakeIngestion !== null && processing !== null ? lakeIngestion + processing : null,
    query: priceOf(items, METERS.lakeQuery),
    storage: priceOf(items, METERS.lakeStorage),
  }
}

// ─── Main fetch function ───────────────────────────────────────────────────────

export interface FetchResult {
  bundle: PricingBundle
  isLive: boolean
  fetchedAt: number
  /** True when defenderIsocRateUsd is the UK South constant, not this region's meter */
  defenderIsocRateIsFallback: boolean
  /** True when analytics extended retention is the UK South constant */
  analyticsRetentionRateIsFallback: boolean
  /**
   * cached means this call did not ask the retail API again. absent is a
   * successful list with no meter. unavailable is a failed request.
   */
  defenderIsocLookup: OptionalMeterLookup
  analyticsRetentionLookup: OptionalMeterLookup
}

export async function fetchSentinelPricing(region: string): Promise<FetchResult> {
  const cached = cache.get(region)
  if (cached) {
    const ttl = cached.isFailure || cached.shortTtl ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS
    if (Date.now() - cached.fetchedAt < ttl) {
      return {
        bundle: cached.data,
        isLive: cached.isLive,
        fetchedAt: cached.fetchedAt,
        defenderIsocRateIsFallback: cached.defenderIsocRateIsFallback,
        analyticsRetentionRateIsFallback: cached.analyticsRetentionRateIsFallback,
        defenderIsocLookup: 'cached',
        analyticsRetentionLookup: 'cached',
      }
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    // One query for every Sentinel consumption meter in the region — around two
    // dozen rows, comfortably inside a single page. Previously this was three
    // separate `contains()` filters, one of which matched nothing because the
    // API's contains() is case-sensitive. Fetching the lot and matching meter
    // names locally removes that whole class of failure, and picks up the
    // "Data processing" meter, which no "Data lake" filter would ever return.
    //
    // Two further lists sit outside serviceName 'Sentinel':
    //   - Defender ISOC ingestion is productName 'Microsoft Defender ISOC'
    //     (serviceName 'Microsoft Defender')
    //   - Analytics interactive retention is serviceName 'Log Analytics'
    // Either failing leaves that one rate on the static UK South fallback.
    const [items, isocItems, retentionItems] = await Promise.all([
      fetchAll(
        `serviceName eq 'Sentinel' and priceType eq 'Consumption' and armRegionName eq '${region}'`,
        controller.signal,
      ),
      fetchOptional(
        `productName eq 'Microsoft Defender ISOC' and priceType eq 'Consumption' and armRegionName eq '${region}'`,
        controller.signal,
      ),
      fetchOptional(
        `serviceName eq 'Log Analytics' and priceType eq 'Consumption' and meterName eq 'Analytics Logs Data Retention' and armRegionName eq '${region}'`,
        controller.signal,
      ),
    ])

    const paygRate = parsePayg(items)
    const commitmentTiers = parseTiers(items, paygRate ?? STATIC_PRICING_BUNDLE.paygRateUsd)
    const dl = parseDataLake(items)

    if (paygRate === null && commitmentTiers === STATIC_PRICING_BUNDLE.commitmentTiers) {
      // Region returned nothing usable — fall back to static
      console.warn(`[azurePricing] No pricing data for region '${region}', using static defaults`)
      const entry: CacheEntry = {
        data: STATIC_PRICING_BUNDLE,
        fetchedAt: Date.now(),
        isLive: false,
        defenderIsocRateIsFallback: true,
        analyticsRetentionRateIsFallback: true,
        defenderIsocLookup: 'unavailable',
        analyticsRetentionLookup: 'unavailable',
      }
      cache.set(region, entry)
      return {
        bundle: STATIC_PRICING_BUNDLE,
        isLive: false,
        fetchedAt: entry.fetchedAt,
        defenderIsocRateIsFallback: true,
        analyticsRetentionRateIsFallback: true,
        defenderIsocLookup: 'unavailable',
        analyticsRetentionLookup: 'unavailable',
      }
    }

    const isoc = classifyOptional(isocItems, parseDefenderIsoc)
    const retention = classifyOptional(retentionItems, parseAnalyticsRetention)
    const isocRate = isoc.rate
    const retentionRate = retention.rate
    const defenderIsocRateIsFallback = isoc.lookup !== 'live'
    const analyticsRetentionRateIsFallback = retention.lookup !== 'live'

    const bundle: PricingBundle = {
      paygRateUsd: paygRate ?? STATIC_PRICING_BUNDLE.paygRateUsd,
      commitmentTiers,
      dataLakeRateUsd: dl.ingestion ?? STATIC_PRICING_BUNDLE.dataLakeRateUsd,
      analyticsExtendedRetentionRateUsd:
        retentionRate ?? STATIC_PRICING_BUNDLE.analyticsExtendedRetentionRateUsd,
      dataLakeRetentionRateUsd: dl.storage ?? STATIC_PRICING_BUNDLE.dataLakeRetentionRateUsd,
      dataLakeQueryRateUsd: dl.query ?? STATIC_PRICING_BUNDLE.dataLakeQueryRateUsd,
      // Compute meters. These have always been in the response — the single
      // region-wide query added in the meter-matching fix returns them — they
      // were simply never read.
      graphRateUsdPerVCoreHour:
        priceOf(items, METERS.graph) ?? STATIC_PRICING_BUNDLE.graphRateUsdPerVCoreHour,
      advancedDataInsightsRateUsdPerVCoreHour:
        priceOf(items, METERS.advancedDataInsights)
        ?? STATIC_PRICING_BUNDLE.advancedDataInsightsRateUsdPerVCoreHour,
      basicLogsRateUsd:
        priceOf(items, METERS.basicLogs) ?? STATIC_PRICING_BUNDLE.basicLogsRateUsd,
      auxiliaryLogsRateUsd:
        priceOf(items, METERS.auxiliaryLogs) ?? STATIC_PRICING_BUNDLE.auxiliaryLogsRateUsd,
      defenderIsocRateUsd: isocRate ?? STATIC_PRICING_BUNDLE.defenderIsocRateUsd,
    }

    // A missing optional meter must not be cached as this region's live price
    // for a day. Sentinel rates stay live; the fallback rates are retried on
    // the short failure TTL and labelled in the UI.
    const partialFallback = defenderIsocRateIsFallback || analyticsRetentionRateIsFallback
    const entry: CacheEntry = {
      data: bundle,
      fetchedAt: Date.now(),
      isLive: true,
      shortTtl: partialFallback,
      defenderIsocRateIsFallback,
      analyticsRetentionRateIsFallback,
      defenderIsocLookup: isoc.lookup,
      analyticsRetentionLookup: retention.lookup,
    }
    cache.set(region, entry)
    return {
      bundle,
      isLive: true,
      fetchedAt: entry.fetchedAt,
      defenderIsocRateIsFallback,
      analyticsRetentionRateIsFallback,
      defenderIsocLookup: isoc.lookup,
      analyticsRetentionLookup: retention.lookup,
    }
  } catch (err) {
    console.warn(`[azurePricing] Failed to fetch pricing for '${region}':`, err)
    // Cached with a short TTL (see FAILURE_CACHE_TTL_MS) so a transient error
    // retries soon, rather than locking the region to static rates all day.
    const entry: CacheEntry = {
      data: STATIC_PRICING_BUNDLE,
      fetchedAt: Date.now(),
      isLive: false,
      isFailure: true,
      defenderIsocRateIsFallback: true,
      analyticsRetentionRateIsFallback: true,
      defenderIsocLookup: 'unavailable',
      analyticsRetentionLookup: 'unavailable',
    }
    cache.set(region, entry)
    return {
      bundle: STATIC_PRICING_BUNDLE,
      isLive: false,
      fetchedAt: entry.fetchedAt,
      defenderIsocRateIsFallback: true,
      analyticsRetentionRateIsFallback: true,
      defenderIsocLookup: 'unavailable',
      analyticsRetentionLookup: 'unavailable',
    }
  } finally {
    clearTimeout(timeout)
  }
}
