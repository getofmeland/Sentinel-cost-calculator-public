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

import { describe, it, expect } from 'vitest'

import { parsePayg, parseTiers, parseDataLake, type AzurePriceItem } from '../azurePricing'
import { STATIC_PRICING_BUNDLE, PAYG_RATE_USD_PER_GB, DATA_LAKE_RATE_USD_PER_GB } from '../../data/pricing'
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
