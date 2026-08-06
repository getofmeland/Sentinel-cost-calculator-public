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
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

// A failed fetch is cached only briefly. Caching a transient network error for
// a full day would pin the user to static rates until they found the refresh
// button, with the UI giving no clue why.
const FAILURE_CACHE_TTL_MS = 60 * 1000 // 1 min

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
}

export async function fetchSentinelPricing(region: string): Promise<FetchResult> {
  const cached = cache.get(region)
  if (cached) {
    const ttl = cached.isFailure ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS
    if (Date.now() - cached.fetchedAt < ttl) {
      return { bundle: cached.data, isLive: cached.isLive, fetchedAt: cached.fetchedAt }
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
    const items = await fetchAll(
      `serviceName eq 'Sentinel' and priceType eq 'Consumption' and armRegionName eq '${region}'`,
      controller.signal,
    )

    const paygRate = parsePayg(items)
    const commitmentTiers = parseTiers(items, paygRate ?? STATIC_PRICING_BUNDLE.paygRateUsd)
    const dl = parseDataLake(items)

    if (paygRate === null && commitmentTiers === STATIC_PRICING_BUNDLE.commitmentTiers) {
      // Region returned nothing usable — fall back to static
      console.warn(`[azurePricing] No pricing data for region '${region}', using static defaults`)
      const entry: CacheEntry = { data: STATIC_PRICING_BUNDLE, fetchedAt: Date.now(), isLive: false }
      cache.set(region, entry)
      return { bundle: STATIC_PRICING_BUNDLE, isLive: false, fetchedAt: entry.fetchedAt }
    }

    // Analytics extended retention is billed under a different serviceName
    // ("Log Analytics"), so it is not in this response and stays static.
    const bundle: PricingBundle = {
      paygRateUsd: paygRate ?? STATIC_PRICING_BUNDLE.paygRateUsd,
      commitmentTiers,
      dataLakeRateUsd: dl.ingestion ?? STATIC_PRICING_BUNDLE.dataLakeRateUsd,
      analyticsExtendedRetentionRateUsd: STATIC_PRICING_BUNDLE.analyticsExtendedRetentionRateUsd,
      dataLakeRetentionRateUsd: dl.storage ?? STATIC_PRICING_BUNDLE.dataLakeRetentionRateUsd,
      dataLakeQueryRateUsd: dl.query ?? STATIC_PRICING_BUNDLE.dataLakeQueryRateUsd,
    }

    const entry: CacheEntry = { data: bundle, fetchedAt: Date.now(), isLive: true }
    cache.set(region, entry)
    return { bundle, isLive: true, fetchedAt: entry.fetchedAt }
  } catch (err) {
    console.warn(`[azurePricing] Failed to fetch pricing for '${region}':`, err)
    // Cached with a short TTL (see FAILURE_CACHE_TTL_MS) so a transient error
    // retries soon, rather than locking the region to static rates all day.
    const entry: CacheEntry = { data: STATIC_PRICING_BUNDLE, fetchedAt: Date.now(), isLive: false, isFailure: true }
    cache.set(region, entry)
    return { bundle: STATIC_PRICING_BUNDLE, isLive: false, fetchedAt: entry.fetchedAt }
  } finally {
    clearTimeout(timeout)
  }
}
