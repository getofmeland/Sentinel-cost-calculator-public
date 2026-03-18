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
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

export function clearRegionCache(arm: string) {
  cache.delete(arm)
}

// ─── API helpers ──────────────────────────────────────────────────────────────

// In dev the Vite proxy at /azure-pricing bypasses CORS.
// In production the Azure Functions proxy at /api/azure-pricing handles it server-side.
const BASE_URL = import.meta.env.DEV
  ? '/azure-pricing'
  : '/api/azure-pricing'

async function fetchPage(filter: string, signal: AbortSignal): Promise<{ Items: AzurePriceItem[]; NextPageLink?: string }> {
  const url = `${BASE_URL}?$filter=${encodeURIComponent(filter)}&$top=100`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Azure pricing API ${res.status}`)
  return res.json()
}

interface AzurePriceItem {
  meterName: string
  retailPrice: number
  unitOfMeasure: string
  armRegionName: string
  skuName?: string
  productName?: string
}

async function fetchAll(filter: string, signal: AbortSignal): Promise<AzurePriceItem[]> {
  const items: AzurePriceItem[] = []
  let page = await fetchPage(filter, signal)
  items.push(...page.Items)
  while (page.NextPageLink) {
    const res = await fetch(page.NextPageLink, { signal })
    if (!res.ok) break
    page = await res.json()
    items.push(...page.Items)
  }
  return items
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function parsePayg(items: AzurePriceItem[]): number | null {
  // Azure API returns "Pay-as-you-go Analysis" (not just "Analysis")
  const item = items.find(i =>
    i.meterName === 'Pay-as-you-go Analysis' || i.meterName === 'Analysis'
  )
  return item ? item.retailPrice : null
}

function parseTiers(items: AzurePriceItem[], paygRate: number): CommitmentTier[] {
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

function parseDataLake(items: AzurePriceItem[]): { ingestion: number | null } {
  // Look for Data Lake Ingestion meter
  const ingestionItem = items.find(i =>
    i.meterName.toLowerCase().includes('ingestion') ||
    i.meterName.toLowerCase().includes('data lake')
  )
  return { ingestion: ingestionItem ? ingestionItem.retailPrice : null }
}

// ─── Main fetch function ───────────────────────────────────────────────────────

export interface FetchResult {
  bundle: PricingBundle
  isLive: boolean
  fetchedAt: number
}

export async function fetchSentinelPricing(region: string): Promise<FetchResult> {
  // Check cache
  const cached = cache.get(region)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { bundle: cached.data, isLive: cached.isLive, fetchedAt: cached.fetchedAt }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const [paygItems, tierItems, dlItems] = await Promise.all([
      fetchAll(
        `serviceName eq 'Sentinel' and meterName eq 'Pay-as-you-go Analysis' and priceType eq 'Consumption' and armRegionName eq '${region}'`,
        controller.signal,
      ),
      fetchAll(
        `serviceName eq 'Sentinel' and contains(meterName, 'Commitment Tier') and priceType eq 'Consumption' and armRegionName eq '${region}'`,
        controller.signal,
      ),
      fetchAll(
        `serviceName eq 'Sentinel' and contains(meterName, 'Data Lake') and priceType eq 'Consumption' and armRegionName eq '${region}'`,
        controller.signal,
      ),
    ])

    const paygRate = parsePayg(paygItems) ?? STATIC_PRICING_BUNDLE.paygRateUsd
    const commitmentTiers = parseTiers(tierItems, paygRate)
    const dl = parseDataLake(dlItems)

    if (paygItems.length === 0 && tierItems.length === 0) {
      // Region returned no data — fall back to static
      console.warn(`[azurePricing] No pricing data for region '${region}', using static defaults`)
      const entry: CacheEntry = { data: STATIC_PRICING_BUNDLE, fetchedAt: Date.now(), isLive: false }
      cache.set(region, entry)
      return { bundle: STATIC_PRICING_BUNDLE, isLive: false, fetchedAt: entry.fetchedAt }
    }

    // Retention rates (Analytics extended + DL retention) come from Azure Monitor pricing
    // (different service name). These rarely change — fall back to static values.
    console.info('[azurePricing] Retention rates (0.023, 0.02) are from Azure Monitor pricing; using static values.')

    const bundle: PricingBundle = {
      paygRateUsd: paygRate,
      commitmentTiers,
      dataLakeRateUsd: dl.ingestion ?? STATIC_PRICING_BUNDLE.dataLakeRateUsd,
      analyticsExtendedRetentionRateUsd: STATIC_PRICING_BUNDLE.analyticsExtendedRetentionRateUsd,
      dataLakeRetentionRateUsd: STATIC_PRICING_BUNDLE.dataLakeRetentionRateUsd,
      dataLakeQueryRateUsd: STATIC_PRICING_BUNDLE.dataLakeQueryRateUsd,
    }

    const entry: CacheEntry = { data: bundle, fetchedAt: Date.now(), isLive: true }
    cache.set(region, entry)
    return { bundle, isLive: true, fetchedAt: entry.fetchedAt }
  } catch (err) {
    console.warn(`[azurePricing] Failed to fetch pricing for '${region}':`, err)
    const entry: CacheEntry = { data: STATIC_PRICING_BUNDLE, fetchedAt: Date.now(), isLive: false }
    cache.set(region, entry)
    return { bundle: STATIC_PRICING_BUNDLE, isLive: false, fetchedAt: entry.fetchedAt }
  } finally {
    clearTimeout(timeout)
  }
}
