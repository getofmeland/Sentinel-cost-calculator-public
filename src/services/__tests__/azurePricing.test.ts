// @vitest-environment node
/**
 * Parser tests for the Azure Retail Prices integration.
 *
 * These run against a recorded response from the live API (UK South,
 * 6 August 2026) rather than mock data invented to match the parser. That
 * matters: the previous Data Lake filter searched for "Data Lake" while the
 * API spells it "Data lake", so it matched nothing in every region — and no
 * test caught it, because there were no tests here and hand-written mocks
 * would have used whatever spelling the parser expected.
 *
 * To refresh the fixture:
 *   curl "https://prices.azure.com/api/retail/prices?\$filter=serviceName%20eq%20'Sentinel'%20and%20armRegionName%20eq%20'uksouth'"
 */

import { describe, it, expect, afterEach, vi } from 'vitest'

import { parsePayg, parseTiers, parseDataLake, parseDefenderIsoc, parseAnalyticsRetention, fetchSentinelPricing, clearRegionCache, FAILURE_CACHE_TTL_MS, type AzurePriceItem } from '../azurePricing'
import { STATIC_PRICING_BUNDLE, PAYG_RATE_USD_PER_GB, DATA_LAKE_RATE_USD_PER_GB, DEFENDER_ISOC_RATE_USD_PER_GB } from '../../data/pricing'
import fixture from './sentinel-uksouth.fixture.json'

const items = fixture.Items as AzurePriceItem[]

describe('parsePayg', () => {
  it('finds the pay-as-you-go meter in a real API response', () => {
    expect(parsePayg(items)).toBe(5.38)
  })

  it('agrees with the static constant, so live and offline modes match', () => {
    expect(parsePayg(items)).toBe(PAYG_RATE_USD_PER_GB)
  })

  it('returns null rather than a wrong number when the meter is absent', () => {
    expect(parsePayg([])).toBeNull()
  })
})

describe('parseDataLake', () => {
  it('sums the ingestion and data-processing meters, which both apply', () => {
    // Data lake ingestion 0.0625 + Data processing 0.125 = 0.1875.
    // Reading only the first understates lake ingestion roughly threefold.
    expect(parseDataLake(items).ingestion).toBeCloseTo(0.1875, 6)
  })

  it('agrees with the static constant', () => {
    expect(parseDataLake(items).ingestion).toBeCloseTo(DATA_LAKE_RATE_USD_PER_GB, 6)
  })

  it('picks the query meter, not whichever lake meter happens to come first', () => {
    // The old predicate matched every pre-filtered item, so .find() returned
    // an arbitrary one — often storage or query in place of ingestion.
    const rates = parseDataLake(items)
    expect(rates.query).toBe(0.00625)
    expect(rates.storage).toBe(0.024)
    expect(rates.query).toBe(STATIC_PRICING_BUNDLE.dataLakeQueryRateUsd)
    expect(rates.storage).toBe(STATIC_PRICING_BUNDLE.dataLakeRetentionRateUsd)
  })

  it('reports null ingestion when only one of the two meters is present', () => {
    const partial = items.filter(i => i.meterName !== 'Data processing Data Processed')
    expect(parseDataLake(partial).ingestion).toBeNull()
  })
})

describe('parseTiers', () => {
  const tiers = parseTiers(items, 5.38)

  it('finds every commitment tier the region publishes', () => {
    expect(tiers.map(t => t.gbPerDay)).toEqual([
      50, 100, 200, 300, 400, 500, 1000, 2000, 5000, 10000, 25000, 50000,
    ])
  })

  it('derives the same effective rates as the static table', () => {
    for (const parsed of tiers) {
      const staticTier = STATIC_PRICING_BUNDLE.commitmentTiers.find(
        t => t.gbPerDay === parsed.gbPerDay,
      )
      expect(staticTier, `tier ${parsed.gbPerDay} missing from static table`).toBeDefined()
      expect(parsed.effectiveRateUsd).toBeCloseTo(staticTier!.effectiveRateUsd, 6)
      expect(parsed.dailyCostUsd).toBeCloseTo(staticTier!.dailyCostUsd, 6)
    }
  })

  it('does not mistake the hourly Graph or Advanced Data Insights meters for tiers', () => {
    // Both are priced per compute-hour and must never be read as GB/day tiers.
    expect(tiers.every(t => t.gbPerDay > 0 && Number.isFinite(t.dailyCostUsd))).toBe(true)
    expect(tiers).toHaveLength(12)
  })

  it('falls back to the static ladder when the response contains no tiers', () => {
    expect(parseTiers([], 5.38)).toBe(STATIC_PRICING_BUNDLE.commitmentTiers)
  })
})

/**
 * Recorded 19 November 2026 from
 *   productName eq 'Microsoft Defender ISOC' and armRegionName eq 'uksouth'
 * The Sentinel pay-as-you-go meter is hyphenated ("Pay-as-you-go Analysis")
 * and is a different product. These rows are the ISOC product in full.
 */
const ISOC_UK_SOUTH: AzurePriceItem[] = [
  { meterName: 'Data lake storage Data Stored', retailPrice: 0.024, unitOfMeasure: '1 GB/Month', armRegionName: 'uksouth', productName: 'Microsoft Defender ISOC' },
  { meterName: 'Free Data Ingestion Analysis', retailPrice: 0, unitOfMeasure: '1 GB', armRegionName: 'uksouth', productName: 'Microsoft Defender ISOC' },
  { meterName: 'Pay As You Go Analysis', retailPrice: 2.88, unitOfMeasure: '1 GB', armRegionName: 'uksouth', productName: 'Microsoft Defender ISOC' },
  { meterName: 'Defender Extended Retention Analysis', retailPrice: 1.44, unitOfMeasure: '1 GB', armRegionName: 'uksouth', productName: 'Microsoft Defender ISOC' },
  { meterName: 'Analytics Logs Data Retention', retailPrice: 0.12, unitOfMeasure: '1 GB/Month', armRegionName: 'uksouth', productName: 'Microsoft Defender ISOC' },
  { meterName: 'Data processing Data Processed', retailPrice: 0.12, unitOfMeasure: '1 GB', armRegionName: 'uksouth', productName: 'Microsoft Defender ISOC' },
]

describe('parseDefenderIsoc', () => {
  it('reads the UK South pay-as-you-go meter and agrees with the static fallback', () => {
    expect(parseDefenderIsoc(ISOC_UK_SOUTH)).toBe(2.88)
    expect(parseDefenderIsoc(ISOC_UK_SOUTH)).toBe(DEFENDER_ISOC_RATE_USD_PER_GB)
  })

  it('reads the East US meter, which is the figure the announcement quotes', () => {
    const eastUs: AzurePriceItem[] = [{
      meterName: 'Pay As You Go Analysis',
      retailPrice: 2.4,
      unitOfMeasure: '1 GB',
      armRegionName: 'eastus',
      productName: 'Microsoft Defender ISOC',
    }]
    expect(parseDefenderIsoc(eastUs)).toBe(2.4)
  })

  it('does not treat the Sentinel pay-as-you-go meter as Defender ISOC', () => {
    expect(parseDefenderIsoc(items)).toBeNull()
  })

  it('returns null when the meter is absent', () => {
    expect(parseDefenderIsoc([])).toBeNull()
  })

  it('records that the ISOC product publishes no commitment-tier meters', () => {
    expect(ISOC_UK_SOUTH.some(i => /commitment tier/i.test(i.meterName))).toBe(false)
  })
})

describe('parseAnalyticsRetention', () => {
  // Recorded 19 November 2026. serviceName 'Log Analytics', meter
  // 'Analytics Logs Data Retention'. UK South matches the static fallback;
  // East US and Australia East do not, which is why the rate is fetched live.
  const logAnalytics: AzurePriceItem[] = [
    { meterName: 'Analytics Logs Data Retention', retailPrice: 0.13, unitOfMeasure: '1 GB/Month', armRegionName: 'uksouth', productName: 'Log Analytics' },
    { meterName: 'Analytics Logs Data Retention', retailPrice: 0.1, unitOfMeasure: '1 GB/Month', armRegionName: 'eastus', productName: 'Log Analytics' },
    { meterName: 'Analytics Logs Data Retention', retailPrice: 0.15, unitOfMeasure: '1 GB/Month', armRegionName: 'australiaeast', productName: 'Log Analytics' },
  ]

  it('keeps the UK South rate that the static fallback already uses', () => {
    expect(parseAnalyticsRetention([logAnalytics[0]])).toBe(0.13)
    expect(parseAnalyticsRetention([logAnalytics[0]])).toBe(STATIC_PRICING_BUNDLE.analyticsExtendedRetentionRateUsd)
  })

  it('returns the regional rate rather than the UK South constant', () => {
    expect(parseAnalyticsRetention([logAnalytics[1]])).toBe(0.1)
    expect(parseAnalyticsRetention([logAnalytics[2]])).toBe(0.15)
  })

  it('ignores the Defender ISOC meter of the same name', () => {
    const mixed = [ISOC_UK_SOUTH.find(i => i.meterName === 'Analytics Logs Data Retention')!, logAnalytics[0]]
    expect(parseAnalyticsRetention(mixed)).toBe(0.13)
  })
})

function priceResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  }
}

describe('fetchSentinelPricing optional meters', () => {
  const region = 'isoc-fallback-test'
  const sentinel = {
    Items: [{
      meterName: 'Pay-as-you-go Analysis',
      retailPrice: 4.3,
      unitOfMeasure: '1 GB',
      armRegionName: region,
      productName: 'Sentinel',
    }],
  }
  const retention = {
    Items: [{
      meterName: 'Analytics Logs Data Retention',
      retailPrice: 0.1,
      unitOfMeasure: '1 GB/Month',
      armRegionName: region,
      productName: 'Log Analytics',
    }],
  }

  afterEach(() => {
    clearRegionCache(region)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps a missing ISOC meter on the UK South fallback and retries after the short TTL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input))
      if (url.includes('Microsoft Defender ISOC')) return priceResponse({ Items: [] })
      if (url.includes('Log Analytics')) return priceResponse(retention)
      return priceResponse(sentinel)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.parse('2026-11-19T00:00:00Z')
    vi.setSystemTime(start)

    const first = await fetchSentinelPricing(region)
    expect(first.isLive).toBe(true)
    expect(first.defenderIsocRateIsFallback).toBe(true)
    expect(first.analyticsRetentionRateIsFallback).toBe(false)
    expect(first.bundle.defenderIsocRateUsd).toBe(DEFENDER_ISOC_RATE_USD_PER_GB)
    expect(first.bundle.analyticsExtendedRetentionRateUsd).toBe(0.1)
    const calls = fetchMock.mock.calls.length

    vi.setSystemTime(start + 30_000)
    await fetchSentinelPricing(region)
    expect(fetchMock.mock.calls.length).toBe(calls)

    vi.setSystemTime(start + FAILURE_CACHE_TTL_MS + 1_000)
    await fetchSentinelPricing(region)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls)
  })

  it('treats a failed optional query the same way as a response with no meter', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input))
      if (url.includes('Microsoft Defender ISOC')) throw new Error('network')
      if (url.includes('Log Analytics')) return priceResponse(retention)
      return priceResponse(sentinel)
    }))
    const result = await fetchSentinelPricing(region)
    expect(result.defenderIsocRateIsFallback).toBe(true)
    expect(result.bundle.paygRateUsd).toBe(4.3)
    expect(result.isLive).toBe(true)
  })
})
