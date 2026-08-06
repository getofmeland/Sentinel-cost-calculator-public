// @vitest-environment node
/**
 * Unit tests for Sentinel cost calculator utility functions.
 *
 * Scope:
 *   - fmtGbp        (src/utils/currency.ts)
 *   - breakevenForTier / computeTierOptions  (src/utils/tiers.ts)
 *   - computeLicenceBenefits                 (src/utils/licenceBenefits.ts)
 *   - summariseIngestion                     (src/utils/ingestion.ts)
 *
 * NOTE: azurePricing.ts and PricingContext.tsx are intentionally NOT imported
 * because they reference import.meta.env, which is unavailable in Vitest's
 * jsdom environment.
 */

import { describe, it, expect } from 'vitest'

import { fmtGbp } from '../currency'
import { breakevenForTier, computeTierOptions } from '../tiers'
import { computeLicenceBenefits } from '../licenceBenefits'
import { summariseIngestion, estimateSourceGbPerDay } from '../ingestion'
import { interpolateRange, getSizeMultiplier } from '../../data/tshirtSizes'
import { SERVER_WORKLOADS } from '../../data/serverWorkloads'
import { computeServerWorkloadRows } from '../serverWorkloads'
import { LOG_TIER_DEFINITIONS } from '../../data/logTiers'
import {
  STATIC_PRICING_BUNDLE,
  DAYS_PER_MONTH,
  COMMITMENT_TIERS,
  LOG_SOURCES,
  type PricingBundle,
  type CommitmentTier,
} from '../../data/pricing'
import type { SourceEstimateRow } from '../ingestion'
import type { LogSource } from '../../data/pricing'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** round2 mirrors the private helper used in the production utilities. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// 1. fmtGbp
// ---------------------------------------------------------------------------

describe('fmtGbp', () => {
  it('converts 100 USD to GBP at the default 0.79 rate', () => {
    // Formula: 100 * 0.79 = 79.00 → "£79.00"
    expect(fmtGbp(100)).toBe('£79.00')
  })

  it('accepts a custom fxRate: 100 USD at 0.85 → "£85.00"', () => {
    // Formula: 100 * 0.85 = 85.00 → "£85.00"
    expect(fmtGbp(100, 2, 0.85)).toBe('£85.00')
  })

  it('returns "£0.00" for zero USD input', () => {
    // Edge case: must not produce NaN or empty string
    expect(fmtGbp(0)).toBe('£0.00')
  })
})

// ---------------------------------------------------------------------------
// 2. breakevenForTier
// ---------------------------------------------------------------------------

describe('breakevenForTier', () => {
  // 100 GB/day tier: dailyCostUsd = 100 * 3.35 = 335
  const tier100: CommitmentTier = COMMITMENT_TIERS.find(t => t.gbPerDay === 100)!

  it('calculates breakeven for the 100 GB/day tier at default PAYG rate ($5.20/GB)', () => {
    // Formula: 335 / 5.20 ≈ 64.42 GB/day
    // The function returns an unrounded float, so we use toBeCloseTo.
    const breakeven = breakevenForTier(tier100)
    expect(breakeven).toBeCloseTo(335 / 5.20, 5)
    // Sanity check: well below 100 GB — tier becomes worthwhile at ~64 GB/day
    expect(breakeven).toBeGreaterThan(64)
    expect(breakeven).toBeLessThan(65)
  })

  it('uses a custom paygRate when provided', () => {
    // Formula: 335 / 4.00 = 83.75
    const breakeven = breakevenForTier(tier100, 4.00)
    expect(breakeven).toBeCloseTo(83.75, 5)
  })

  it('scales correctly when paygRate equals the tier effective rate (breakeven = tier gbPerDay)', () => {
    // At effectiveRateUsd = 3.35, breakeven = 335 / 3.35 = exactly 100 GB/day
    const breakeven = breakevenForTier(tier100, tier100.effectiveRateUsd)
    expect(breakeven).toBeCloseTo(tier100.gbPerDay, 5)
  })
})

// ---------------------------------------------------------------------------
// 3. computeTierOptions
// ---------------------------------------------------------------------------

describe('computeTierOptions', () => {
  describe('at 0 GB/day', () => {
    const options = computeTierOptions(0)

    it('returns an array including PAYG and all commitment tiers', () => {
      // 1 PAYG + 7 commitment tiers = 8 total
      expect(options).toHaveLength(1 + STATIC_PRICING_BUNDLE.commitmentTiers.length)
    })

    it('recommends PAYG (cheapest at zero volume)', () => {
      const recommended = options.filter(o => o.isRecommended)
      expect(recommended).toHaveLength(1)
      expect(recommended[0].isPayg).toBe(true)
    })

    it('sets savingsVsPaygPct to null for all tiers (PAYG cost is zero)', () => {
      // paygDailyCostUsd === 0, so every tier entry gets null rather than a
      // computed percentage (division by zero guard).
      const tierRows = options.filter(o => !o.isPayg)
      tierRows.forEach(o => {
        expect(o.savingsVsPaygPct).toBeNull()
      })
    })
  })

  describe('at 200 GB/day with STATIC_PRICING_BUNDLE', () => {
    // PAYG: 200 * 5.20 = 1040 USD/day
    // 100 GB tier: 335 + (200 - 100) * 3.35 = 335 + 335 = 670 USD/day → savings = (1040-670)/1040 ≈ 35.6%
    // 200 GB tier: 200 * 3.15 = 630 USD/day → savings = (1040-630)/1040 ≈ 39.4%
    const options = computeTierOptions(200, STATIC_PRICING_BUNDLE)

    it('has exactly one recommended option', () => {
      const recommended = options.filter(o => o.isRecommended)
      expect(recommended).toHaveLength(1)
    })

    it('does not recommend PAYG (commitment tiers are cheaper at 200 GB/day)', () => {
      const paygOption = options.find(o => o.isPayg)!
      expect(paygOption.isRecommended).toBe(false)
    })

    it('has at least one commitment tier with positive savingsVsPaygPct', () => {
      const positiveOptions = options.filter(
        o => !o.isPayg && o.savingsVsPaygPct !== null && o.savingsVsPaygPct > 0,
      )
      expect(positiveOptions.length).toBeGreaterThan(0)
    })

    it('100 GB/day tier reports the correct savings percentage (~35.6%)', () => {
      const tier100Option = options.find(o => o.tier?.gbPerDay === 100)!
      // (1040 - 670) / 1040 = 0.35576...
      expect(tier100Option.savingsVsPaygPct).toBeCloseTo((1040 - 670) / 1040, 4)
    })

    it('200 GB/day tier has the lowest daily cost and is recommended', () => {
      const recommended = options.find(o => o.isRecommended)!
      expect(recommended.tier?.gbPerDay).toBe(200)
      // 200 * 3.15 = 630
      expect(recommended.dailyCostUsd).toBeCloseTo(630, 2)
    })
  })

  describe('fxRate scaling', () => {
    it('doubling fxRate doubles all monthlyCostGbp values', () => {
      const baseRate = 0.79
      const doubledRate = baseRate * 2

      const optionsBase = computeTierOptions(200, STATIC_PRICING_BUNDLE, baseRate)
      const optionsDouble = computeTierOptions(200, STATIC_PRICING_BUNDLE, doubledRate)

      optionsBase.forEach((base, idx) => {
        const doubled = optionsDouble[idx]
        // monthlyCostGbp = dailyCostUsd * DAYS_PER_MONTH * fxRate
        expect(doubled.monthlyCostGbp).toBeCloseTo(base.monthlyCostGbp * 2, 5)
      })
    })
  })
})

// ---------------------------------------------------------------------------
// 4. computeLicenceBenefits
// ---------------------------------------------------------------------------

describe('computeLicenceBenefits', () => {
  // ── Shared test sources ────────────────────────────────────────────────

  const entraSource: LogSource = {
    id: 'entra-id',
    label: 'Entra ID Sign-in & Audit',
    group: 'identity',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.5, 3.0],
    isFree: false,
  }

  const mdcaSource: LogSource = {
    id: 'mdca',
    label: 'Microsoft Defender for Cloud Apps',
    group: 'microsoft-defender',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.5, 2.0],
    isFree: false,
  }

  const mdeSource: LogSource = {
    id: 'mde',
    label: 'Microsoft Defender for Endpoint',
    group: 'microsoft-defender',
    scaleBy: 'users',
    gbPer1000UsersRange: [2.0, 10.0],
    isFree: false,
  }

  const windowsSource: LogSource = {
    id: 'ws-dc',
    label: 'Domain Controller',
    group: 'infrastructure',
    scaleBy: 'devices',
    gbPerDeviceRange: [0.5, 1.5],
    isFree: false,
    p2Eligible: true,
  }

  const linuxSource: LogSource = {
    id: 'lx-web',
    label: 'Linux Web Server',
    group: 'infrastructure',
    scaleBy: 'devices',
    gbPerDeviceRange: [0.2, 1.5],
    isFree: false,
    p2Eligible: false,
  }

  const azureActivitySource: LogSource = {
    id: 'azure-activity',
    label: 'Azure Activity Logs',
    group: 'azure-platform',
    scaleBy: 'users',
    gbPer1000UsersRange: [0.1, 0.5],
    isFree: true,
  }

  function makeRow(source: LogSource, gbPerDay: number, logTier: 'analytics' | 'data-lake' = 'analytics'): SourceEstimateRow {
    return {
      source,
      gbPerDay,
      logTier,
      retentionStrategy: 'data-lake-mirror',
      dailyCostUsd: source.isFree ? 0 : round2(gbPerDay * 5.20),
      retentionDays: 90,
      retentionMonthlyCostUsd: 0,
    }
  }

  // ── E5 grant: only active for e5/e5-security ────────────────────────────

  it('E5 grant is zero for licence "none"', () => {
    const rows = [makeRow(entraSource, 1)]
    const result = computeLicenceBenefits(rows, 1, 'none', 500, false, 0)
    expect(result.e5GrantGbPerDay).toBe(0)
    expect(result.e5SavedMonthlyUsd).toBe(0)
    expect(result.e5IsActive).toBe(false)
  })

  it('E5 grant is zero for licence "e3"', () => {
    const rows = [makeRow(entraSource, 1)]
    const result = computeLicenceBenefits(rows, 1, 'e3', 500, false, 0)
    expect(result.e5GrantGbPerDay).toBe(0)
    expect(result.e5IsActive).toBe(false)
  })

  it('E5 grant is active for licence "e5"', () => {
    const rows = [makeRow(entraSource, 1)]
    const result = computeLicenceBenefits(rows, 1, 'e5', 500, false, 0)
    expect(result.e5IsActive).toBe(true)
  })

  it('E5 grant is active for licence "e5-security"', () => {
    const rows = [makeRow(entraSource, 1)]
    const result = computeLicenceBenefits(rows, 1, 'e5-security', 500, false, 0)
    expect(result.e5IsActive).toBe(true)
  })

  // ── E5 grant: only eligible for entra-id + mdca analytics rows ──────────

  it('MDE is NOT eligible for E5 grant (not in eligible set)', () => {
    // mde at 10 GB/day — not an E5 grant source
    const rows = [makeRow(mdeSource, 10)]
    const result = computeLicenceBenefits(rows, 10, 'e5', 500, false, 0)
    expect(result.e5EligibleAnalyticsGbPerDay).toBe(0)
    expect(result.e5GrantGbPerDay).toBe(0)
  })

  it('Entra ID and MDCA analytics rows are eligible for E5 grant', () => {
    // entra-id: 0.5 GB/day, mdca: 0.5 GB/day → eligible = 1 GB/day
    const rows = [makeRow(entraSource, 0.5), makeRow(mdcaSource, 0.5)]
    const result = computeLicenceBenefits(rows, 1, 'e5', 500, false, 0)
    expect(result.e5EligibleAnalyticsGbPerDay).toBeCloseTo(1.0, 2)
  })

  it('Data-lake tier rows are NOT eligible for E5 grant', () => {
    // entra-id in data-lake tier — should not count toward eligible
    const rows = [makeRow(entraSource, 1, 'data-lake')]
    const result = computeLicenceBenefits(rows, 0, 'e5', 500, false, 0)
    expect(result.e5EligibleAnalyticsGbPerDay).toBe(0)
    expect(result.e5GrantGbPerDay).toBe(0)
  })

  it('Free sources are not eligible for E5 grant', () => {
    const rows = [makeRow(azureActivitySource, 1)]
    const result = computeLicenceBenefits(rows, 0, 'e5', 500, false, 0)
    expect(result.e5EligibleAnalyticsGbPerDay).toBe(0)
  })

  // ── E5 grant: capped at min(allowance, eligible) ─────────────────────────

  it('E5 grant is capped at eligible GB/day when allowance exceeds eligible', () => {
    // 500 users × 5 MB = 2.5 GB/day allowance; eligible = 1 GB/day → grant = 1
    const rows = [makeRow(entraSource, 0.5), makeRow(mdcaSource, 0.5)]
    const result = computeLicenceBenefits(rows, 1, 'e5', 500, false, 0)
    expect(result.e5AllowanceGbPerDay).toBeCloseTo(2.5, 2)
    expect(result.e5GrantGbPerDay).toBeCloseTo(1.0, 2)
  })

  it('E5 grant is capped at allowance when eligible exceeds allowance', () => {
    // 10 users × 5 MB = 0.05 GB/day allowance; eligible = 2 GB/day → grant = 0.05
    const rows = [makeRow(entraSource, 1), makeRow(mdcaSource, 1)]
    const result = computeLicenceBenefits(rows, 2, 'e5', 10, false, 0)
    expect(result.e5AllowanceGbPerDay).toBeCloseTo(0.05, 3)
    expect(result.e5GrantGbPerDay).toBeCloseTo(0.05, 3)
  })

  it('E5 grant is zero when no eligible sources are selected', () => {
    // Only mde selected — not eligible
    const rows = [makeRow(mdeSource, 5)]
    const result = computeLicenceBenefits(rows, 5, 'e5', 500, false, 0)
    expect(result.e5GrantGbPerDay).toBe(0)
    expect(result.e5SavedMonthlyUsd).toBe(0)
  })

  // ── Defender for Servers: zero when disabled ─────────────────────────────

  it('Defender for Servers grant is zero when defenderEnabled=false', () => {
    const rows = [makeRow(windowsSource, 5)]
    const result = computeLicenceBenefits(rows, 5, 'none', 500, false, 10)
    expect(result.defenderServersGrantGbPerDay).toBe(0)
    expect(result.defenderServersSavedMonthlyUsd).toBe(0)
    expect(result.defenderServersIsActive).toBe(false)
  })

  // ── Defender for Servers: grant capped at min(allowance, eligible) ───────

  it('Defender grant is capped at eligible GB/day when allowance exceeds eligible', () => {
    // 100 servers × 0.5 = 50 GB/day allowance; only windows (p2Eligible:true) eligible = 3 GB/day → grant = 3
    // Linux (p2Eligible:false) is excluded from the eligible calculation
    const rows = [makeRow(windowsSource, 3), makeRow(linuxSource, 2)]
    const result = computeLicenceBenefits(rows, 5, 'none', 500, true, 100)
    expect(result.defenderServersAllowanceGbPerDay).toBeCloseTo(50, 2)
    expect(result.defenderServersGrantGbPerDay).toBeCloseTo(3, 2)
  })

  it('Linux sources with p2Eligible=false are NOT eligible for Defender grant', () => {
    const rows = [makeRow(linuxSource, 5)]
    const result = computeLicenceBenefits(rows, 5, 'none', 500, true, 100)
    expect(result.defenderServersEligibleGbPerDay).toBe(0)
    expect(result.defenderServersGrantGbPerDay).toBe(0)
  })

  it('Defender grant is capped at allowance when eligible exceeds allowance', () => {
    // 2 servers × 0.5 = 1 GB/day allowance; windows eligible = 3 GB/day → grant = 1 (allowance cap)
    const rows = [makeRow(windowsSource, 3), makeRow(linuxSource, 2)]
    const result = computeLicenceBenefits(rows, 5, 'none', 500, true, 2)
    expect(result.defenderServersAllowanceGbPerDay).toBeCloseTo(1, 2)
    expect(result.defenderServersGrantGbPerDay).toBeCloseTo(1, 2)
  })

  // ── billableAnalyticsGbPerDay is floored at 0 ────────────────────────────

  it('billableAnalyticsGbPerDay is floored at 0 when grants exceed analyticsGbPerDay', () => {
    // analyticsGbPerDay = 0.1, but 500 users × 5 MB = 2.5 GB/day allowance
    const rows = [makeRow(entraSource, 0.1)]
    const result = computeLicenceBenefits(rows, 0.1, 'e5', 500, false, 0)
    expect(result.billableAnalyticsGbPerDay).toBe(0)
  })

  it('billableAnalyticsGbPerDay equals analyticsGbPerDay when no benefits are active', () => {
    const rows = [makeRow(mdeSource, 10)]
    const result = computeLicenceBenefits(rows, 10, 'none', 500, false, 0)
    expect(result.billableAnalyticsGbPerDay).toBeCloseTo(10, 2)
  })

  // ── totalSavedMonthlyUsd ──────────────────────────────────────────────────

  it('totalSavedMonthlyUsd = (e5Grant + defenderGrant) × DAYS_PER_MONTH × paygRate', () => {
    // entra-id: 1 GB/day eligible; 500 users × 5 MB = 2.5 GB/day allowance → e5Grant = 1
    // windows-security: 5 GB/day; 2 servers × 0.5 = 1 GB/day allowance → defenderGrant = 1
    // total grant = 2 GB/day
    // totalSavedMonthlyUsd = round2(2 * 30.44 * 5.20) = round2(316.576) = 316.58
    const rows = [makeRow(entraSource, 1), makeRow(windowsSource, 5)]
    const result = computeLicenceBenefits(rows, 6, 'e5', 500, true, 2)
    const expectedSaved = round2(result.totalGrantGbPerDay * DAYS_PER_MONTH * STATIC_PRICING_BUNDLE.paygRateUsd)
    expect(result.totalSavedMonthlyUsd).toBeCloseTo(expectedSaved, 2)
  })
})

// ---------------------------------------------------------------------------
// 5. T-shirt size interpolation
// ---------------------------------------------------------------------------

describe('t-shirt size interpolation', () => {
  it('S at 0.30: interpolateRange(2, 10, 0.30) = 4.4', () => {
    expect(interpolateRange(2, 10, 0.30)).toBeCloseTo(4.4, 5)
  })

  it('M at 0.50: interpolateRange(2, 10, 0.50) = 6.0 (matches old midpoint)', () => {
    expect(interpolateRange(2, 10, 0.50)).toBeCloseTo(6.0, 5)
  })

  it('L at 0.75: interpolateRange(2, 10, 0.75) = 8.0', () => {
    expect(interpolateRange(2, 10, 0.75)).toBeCloseTo(8.0, 5)
  })

  it('XL at 0.95: interpolateRange(2, 10, 0.95) = 9.6', () => {
    expect(interpolateRange(2, 10, 0.95)).toBeCloseTo(9.6, 5)
  })

  it('getSizeMultiplier returns correct values for each size', () => {
    expect(getSizeMultiplier('S')).toBe(0.30)
    expect(getSizeMultiplier('M')).toBe(0.50)
    expect(getSizeMultiplier('L')).toBe(0.75)
    expect(getSizeMultiplier('XL')).toBe(0.95)
  })

  it('M interpolation matches midpoint formula for symmetric ranges', () => {
    // At multiplier=0.5, interpolateRange(min, max, 0.5) = (min + max) / 2
    const min = 1.5, max = 2.5
    expect(interpolateRange(min, max, 0.5)).toBeCloseTo((min + max) / 2, 10)
  })
})

// ---------------------------------------------------------------------------
// 6. computeServerWorkloadRows
// ---------------------------------------------------------------------------

describe('computeServerWorkloadRows', () => {
  const dcWorkload = SERVER_WORKLOADS.find(w => w.id === 'ws-dc')!
  const lxWebWorkload = SERVER_WORKLOADS.find(w => w.id === 'lx-web')!

  it('DC at 5 servers, Common level, M size → ~10 GB/day', () => {
    // Common level: [1.5, 2.5], M multiplier = 0.5 → interpolate = 2.0 GB/server/day
    // 5 servers × 2.0 = 10.0 GB/day
    const rows = computeServerWorkloadRows(
      [dcWorkload],
      { 'ws-dc': 5 },
      { 'ws-dc': 'common' },
      {},
      'M',
      {},
      {},
      STATIC_PRICING_BUNDLE,
      0.79,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].gbPerDay).toBeCloseTo(10.0, 2)
    expect(rows[0].source.id).toBe('ws-dc')
  })

  it('Zero servers → no rows produced', () => {
    const rows = computeServerWorkloadRows(
      [dcWorkload],
      { 'ws-dc': 0 },
      {},
      {},
      'M',
      {},
      {},
      STATIC_PRICING_BUNDLE,
      0.79,
    )
    expect(rows).toHaveLength(0)
  })

  it('L size applies higher multiplier than M for same workload', () => {
    const makeRows = (size: 'M' | 'L') => computeServerWorkloadRows(
      [dcWorkload],
      { 'ws-dc': 5 },
      { 'ws-dc': 'common' },
      {},
      size,
      {},
      {},
      STATIC_PRICING_BUNDLE,
      0.79,
    )
    const mRows = makeRows('M')
    const lRows = makeRows('L')
    expect(lRows[0].gbPerDay).toBeGreaterThan(mRows[0].gbPerDay)
  })

  it('Windows workloads have p2Eligible: true', () => {
    const rows = computeServerWorkloadRows(
      [dcWorkload],
      { 'ws-dc': 1 },
      {},
      {},
      'M',
      {},
      {},
      STATIC_PRICING_BUNDLE,
      0.79,
    )
    expect(rows[0].source.p2Eligible).toBe(true)
  })

  it('Linux workloads have p2Eligible: false', () => {
    const rows = computeServerWorkloadRows(
      [lxWebWorkload],
      { 'lx-web': 1 },
      {},
      {},
      'M',
      {},
      {},
      STATIC_PRICING_BUNDLE,
      0.79,
    )
    expect(rows[0].source.p2Eligible).toBe(false)
  })

  it('All Events collection level → higher GB/day than Common', () => {
    const makeRows = (level: string) => computeServerWorkloadRows(
      [dcWorkload],
      { 'ws-dc': 5 },
      { 'ws-dc': level },
      {},
      'M',
      {},
      {},
      STATIC_PRICING_BUNDLE,
      0.79,
    )
    const commonRows = makeRows('common')
    const allRows = makeRows('all')
    expect(allRows[0].gbPerDay).toBeGreaterThan(commonRows[0].gbPerDay)
  })

  it('Default log tier is analytics', () => {
    const rows = computeServerWorkloadRows(
      [dcWorkload],
      { 'ws-dc': 3 },
      {},
      {},
      'M',
      {},
      {},
      STATIC_PRICING_BUNDLE,
      0.79,
    )
    expect(rows[0].logTier).toBe('analytics')
  })
})

// ---------------------------------------------------------------------------
// 7. summariseIngestion
// ---------------------------------------------------------------------------

describe('summariseIngestion', () => {
  const defaultUserCount = 1000
  const emptyDeviceCounts: Record<string, number> = {}
  const emptyLogTiers: Record<string, string> = {}
  const emptyRetentionDays: Record<string, number> = {}

  describe('empty selectedIds', () => {
    it('returns zero for all totals', () => {
      const summary = summariseIngestion(
        new Set<string>(),
        defaultUserCount,
        emptyDeviceCounts,
        emptyLogTiers,
        emptyRetentionDays,
      )
      expect(summary.totalGbPerDay).toBe(0)
      expect(summary.billableGbPerDay).toBe(0)
      expect(summary.freeGbPerDay).toBe(0)
      expect(summary.totalDailyCostUsd).toBe(0)
      expect(summary.totalDailyCostGbp).toBe(0)
      expect(summary.rows).toHaveLength(0)
    })
  })

  describe('selecting a free source (azure-activity)', () => {
    // azure-activity: gbPer1000UsersRange=[0.1, 0.5], midpoint=0.3
    // At 1000 users: gbPerDay = round2(0.3 * (1000/1000)) = 0.3
    const summary = summariseIngestion(
      new Set(['azure-activity']),
      defaultUserCount,
      emptyDeviceCounts,
      emptyLogTiers,
      emptyRetentionDays,
    )

    it('freeGbPerDay > 0', () => {
      expect(summary.freeGbPerDay).toBeGreaterThan(0)
    })

    it('freeGbPerDay equals 0.28 GB/day (interpolateRange(0.05, 0.5, 0.5) at 1 000 users)', () => {
      // azure-activity range changed to [0.05, 0.5]; M multiplier = 0.5
      // interpolateRange(0.05, 0.5, 0.5) = 0.275, round2 = 0.28
      expect(summary.freeGbPerDay).toBeCloseTo(0.28, 2)
    })

    it('totalDailyCostUsd === 0 (free source has no ingestion charge)', () => {
      expect(summary.totalDailyCostUsd).toBe(0)
    })

    it('billableGbPerDay === 0', () => {
      expect(summary.billableGbPerDay).toBe(0)
    })
  })

  describe('selecting a paid Analytics source (entra-id)', () => {
    // entra-id: gbPer1000UsersRange=[0.5, 3.0], midpoint=1.75
    // At 1000 users: gbPerDay = round2(1.75 * (1000/1000)) = 1.75
    // analyticsDailyCostUsd = round2(1.75 * 5.20) = round2(9.10) = 9.10
    const summary = summariseIngestion(
      new Set(['entra-id']),
      defaultUserCount,
      emptyDeviceCounts,
      emptyLogTiers,
      emptyRetentionDays,
    )

    it('analyticsDailyCostUsd > 0', () => {
      expect(summary.analyticsDailyCostUsd).toBeGreaterThan(0)
    })

    it('analyticsDailyCostUsd equals round2(1.75 * 5.20) = 9.10', () => {
      expect(summary.analyticsDailyCostUsd).toBeCloseTo(9.10, 2)
    })

    it('freeGbPerDay === 0', () => {
      expect(summary.freeGbPerDay).toBe(0)
    })

    it('analyticsGbPerDay equals 1.75', () => {
      expect(summary.analyticsGbPerDay).toBeCloseTo(1.75, 5)
    })
  })

  describe('doubled paygRateUsd doubles analyticsDailyCostUsd', () => {
    it('custom pricing bundle with 2× paygRate produces 2× analyticsDailyCostUsd', () => {
      // Default: 1.75 GB/day * 5.20 = 9.10 USD
      // Doubled: 1.75 GB/day * 10.40 = 18.20 USD
      const doubledPricing: PricingBundle = {
        ...STATIC_PRICING_BUNDLE,
        paygRateUsd: STATIC_PRICING_BUNDLE.paygRateUsd * 2,
      }

      const summaryDefault = summariseIngestion(
        new Set(['entra-id']),
        defaultUserCount,
        emptyDeviceCounts,
        emptyLogTiers,
        emptyRetentionDays,
        {},
        {},
        {},
        STATIC_PRICING_BUNDLE,
      )

      const summaryDoubled = summariseIngestion(
        new Set(['entra-id']),
        defaultUserCount,
        emptyDeviceCounts,
        emptyLogTiers,
        emptyRetentionDays,
        {},
        {},
        {},
        doubledPricing,
      )

      expect(summaryDoubled.analyticsDailyCostUsd).toBeCloseTo(
        summaryDefault.analyticsDailyCostUsd * 2,
        2,
      )
    })
  })

  describe('custom fxRate scales totalDailyCostGbp', () => {
    it('doubling fxRate doubles totalDailyCostGbp', () => {
      // entra-id at 1000 users: totalDailyCostUsd = 9.10
      // fxRate=0.79 → totalDailyCostGbp = round2(9.10 * 0.79) = round2(7.189) = 7.19
      // fxRate=1.58 → totalDailyCostGbp = round2(9.10 * 1.58) = round2(14.378) = 14.38
      const baseRate = 0.79
      const doubledRate = baseRate * 2

      const summaryBase = summariseIngestion(
        new Set(['entra-id']),
        defaultUserCount,
        emptyDeviceCounts,
        emptyLogTiers,
        emptyRetentionDays,
        {},
        {},
        {},
        STATIC_PRICING_BUNDLE,
        baseRate,
      )

      const summaryDoubled = summariseIngestion(
        new Set(['entra-id']),
        defaultUserCount,
        emptyDeviceCounts,
        emptyLogTiers,
        emptyRetentionDays,
        {},
        {},
        {},
        STATIC_PRICING_BUNDLE,
        doubledRate,
      )

      expect(summaryDoubled.totalDailyCostGbp).toBeCloseTo(summaryBase.totalDailyCostGbp * 2, 1)
    })
  })
})

// ---------------------------------------------------------------------------
// 8. DEFECT: analytics free-window is hardcoded (90) in ingestion.ts instead
//    of being read from logTiers.ts's tierDef.freeRetentionDays.
//
//    ingestion.ts lines ~130 and ~134 compute:
//      const extraDays = Math.max(0, selectedRetention - 90)
//    for BOTH the 'analytics-extended' and 'data-lake-mirror' strategies on
//    the Analytics tier, while the Data Lake native path (line ~127) instead
//    reads `tierDef.freeRetentionDays`. Today LOG_TIER_DEFINITIONS.analytics
//    .freeRetentionDays is 90, so the two values coincide and nothing looks
//    wrong. But the two calculations are NOT actually linked — if a future
//    edit to src/data/logTiers.ts changes the Analytics free window (e.g. a
//    Microsoft pricing change), retention costs silently go wrong with no
//    compile-time or runtime signal.
//
//    This test proves the lack of coupling by mutating the already-loaded
//    LOG_TIER_DEFINITIONS object in memory (simulating exactly the kind of
//    edit someone would make to logTiers.ts) and showing that
//    summariseIngestion's retention cost does NOT follow it.
// ---------------------------------------------------------------------------

describe('DEFECT: retention free-window hardcoded to 90, decoupled from logTiers.ts', () => {
  it.fails('changing analytics freeRetentionDays in logTiers.ts does not change the retention cost calculated by summariseIngestion', () => {
    const analyticsDef = LOG_TIER_DEFINITIONS.find(d => d.key === 'analytics')!
    const originalFreeRetentionDays = analyticsDef.freeRetentionDays
    expect(originalFreeRetentionDays).toBe(90) // sanity: today's real value

    try {
      // Simulate a future pricing update: Microsoft shortens the Analytics
      // free retention window from 90 to 60 days.
      analyticsDef.freeRetentionDays = 60

      // entra-id at 1000 users, M-size (default 0.5 multiplier):
      // gbPerDay = round2(interpolateRange(0.5, 3.0, 0.5) * 1) = round2(1.75) = 1.75
      const summary = summariseIngestion(
        new Set(['entra-id']),
        1000,
        {},
        {},                          // logTiers → defaults to 'analytics'
        { 'entra-id': 200 },          // force a retention selection of 200 days
        {},                            // retentionStrategies → defaults to 'data-lake-mirror'
        {},
        {},
        STATIC_PRICING_BUNDLE,
        0.79,
      )

      const row = summary.rows.find(r => r.source.id === 'entra-id')!
      expect(row.gbPerDay).toBeCloseTo(1.75, 2)

      // What summariseIngestion ACTUALLY computes (hardcoded 90):
      //   extraDays = 200 - 90 = 110
      //   cost = round2((1.75/6) * 110 * 0.02) = 0.64
      //
      // What it SHOULD compute if it honoured the (now-updated) tier
      // definition, matching the Data Lake native path's own pattern:
      //   extraDays = 200 - tierDef.freeRetentionDays(60) = 140
      //   cost = round2((1.75/6) * 140 * 0.02) = 0.82
      const correctExtraDays = Math.max(0, 200 - analyticsDef.freeRetentionDays)
      const correctRetentionCost =
        Math.round(((row.gbPerDay / 6) * correctExtraDays * 0.02) * 100) / 100

      expect(correctRetentionCost).toBeCloseTo(0.82, 2) // sanity check on our own arithmetic

      // FAILS today: production code returns 0.64 (still using hardcoded 90),
      // not 0.82 (what the now-changed tier definition says it should be).
      expect(row.retentionMonthlyCostUsd).toBeCloseTo(correctRetentionCost, 2)
    } finally {
      // Always restore the shared module singleton, regardless of pass/fail,
      // so this test cannot leak state into any other test in the suite.
      analyticsDef.freeRetentionDays = originalFreeRetentionDays
    }
  })
})

// ---------------------------------------------------------------------------
// 9. DEFECT: no negative/NaN input guarding in the calculation layer.
//
//    SourceRow.tsx clamps user keystrokes with Math.max(0, parsed) and
//    isNaN() checks before calling onManualGbChange/onDeviceCountChange, but
//    the underlying pure functions (estimateSourceGbPerDay,
//    summariseIngestion) apply NO validation of their own. Any caller that
//    is not that one React input handler — a saved/shared URL state, a
//    future preset, a bug elsewhere in the app, or a test/story — can feed
//    negative or NaN volumes straight into the maths, and the totals shown
//    to a customer become negative or NaN with no floor/guard.
// ---------------------------------------------------------------------------

describe('DEFECT: negative and NaN inputs are not rejected by the calculation layer', () => {
  const customAppSource = LOG_SOURCES.find(s => s.id === 'custom-app')!

  it.fails('estimateSourceGbPerDay returns a NEGATIVE gbPerDay for a negative manual GB value (should be rejected/clamped to 0)', () => {
    const gbPerDay = estimateSourceGbPerDay(customAppSource, 1000, undefined, undefined, -50)
    // A negative daily ingestion volume is physically meaningless.
    expect(gbPerDay).toBeGreaterThanOrEqual(0)
  })

  it.fails('summariseIngestion produces a NEGATIVE totalDailyCostUsd when a manual GB value is negative (should floor at 0)', () => {
    const summary = summariseIngestion(
      new Set(['custom-app']),
      1000, {}, {}, {}, {}, {},
      { 'custom-app': -50 },
      STATIC_PRICING_BUNDLE, 0.79,
    )
    // -50 GB/day * $5.20/GB = -$260/day silently ends up subtracted from the
    // customer's total cost. A cost calculator must never show a negative bill.
    expect(summary.totalDailyCostUsd).toBeGreaterThanOrEqual(0)
    expect(summary.totalGbPerDay).toBeGreaterThanOrEqual(0)
  })

  it.fails('summariseIngestion produces NaN totals (not £0/$0) when a manual GB value is NaN', () => {
    const summary = summariseIngestion(
      new Set(['custom-app']),
      1000, {}, {}, {}, {}, {},
      { 'custom-app': NaN },
      STATIC_PRICING_BUNDLE, 0.79,
    )
    // Per the audit brief: "0 GB ingestion should show £0/$0, not NaN or
    // errors." An invalid (NaN) input should degrade to a safe default, not
    // contaminate every downstream aggregate.
    expect(Number.isFinite(summary.totalDailyCostUsd)).toBe(true)
    expect(Number.isFinite(summary.totalGbPerDay)).toBe(true)
  })

  it.fails('estimateSourceGbPerDay returns a NEGATIVE gbPerDay for a negative device count (device-scaled source)', () => {
    const keyVaultSource = LOG_SOURCES.find(s => s.id === 'key-vault')!
    const gbPerDay = estimateSourceGbPerDay(keyVaultSource, 1000, -5)
    expect(gbPerDay).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// 10. DEFECT: the "optimised" monthly total double-counts licence-benefit
//     savings (E5 data grant / Defender for Servers P2 grant).
//
//     This reproduces the composition logic from
//     IngestionEstimator.tsx (paygMonthly / optimisedMonthly), calling only
//     the audited src/utils functions in the exact same order and with the
//     exact same formula the component uses, to prove the defect lives in
//     how the utils are *combined*, not in any single function:
//
//       commitmentOptions = computeTierOptions(licenceBenefits.billableAnalyticsGbPerDay, ...)
//       analyticsCommitmentMonthly = recommendedOption.monthlyCostUsd
//       optimisedMonthly = analyticsCommitmentMonthly + dataLake + retention - totalSavings
//
//     `billableAnalyticsGbPerDay` is ALREADY net of the E5/Defender grant
//     (computeLicenceBenefits subtracts totalGrantGbPerDay before returning
//     it), so `analyticsCommitmentMonthly` — being sized and priced against
//     that netted volume — has ALREADY had the benefit applied once.
//     Subtracting `totalSavings` (the dollar value of that same grant) a
//     second time double-counts it, understating the customer's true
//     optimised cost by the full dollar value of the grant every time a
//     commitment tier is recommended.
// ---------------------------------------------------------------------------

describe('DEFECT: optimisedMonthly double-counts licence benefit savings', () => {
  it.fails('subtracting totalSavedMonthlyUsd from a commitment-tier cost that was already sized on the net (post-grant) volume double-counts the E5 grant', () => {
    const userCount = 5000
    const selectedIds = new Set([
      'entra-id', 'mdca', 'mde', 'mdi', 'mdo', 'entra-id-protection',
      'o365-audit', 'intune', 'key-vault', 'vpn-ztna',
    ])
    const deviceCounts = { 'key-vault': 5 }

    // Step 1: ingestion summary (same as IngestionEstimator.tsx)
    const summary = summariseIngestion(
      selectedIds, userCount, deviceCounts, {}, {}, {}, {}, {}, STATIC_PRICING_BUNDLE, 0.79,
    )

    // Step 2: licence benefits — this NETS the E5 grant out of billableAnalyticsGbPerDay
    const licenceBenefits = computeLicenceBenefits(
      summary.rows, summary.analyticsGbPerDay, 'e5', userCount, false, 0, STATIC_PRICING_BUNDLE,
    )
    expect(licenceBenefits.e5GrantGbPerDay).toBeGreaterThan(0) // sanity: grant is actually active
    expect(licenceBenefits.billableAnalyticsGbPerDay).toBeLessThan(summary.analyticsGbPerDay) // sanity: netting happened

    // Step 3: commitment tier is recommended against the ALREADY-NETTED volume
    const commitmentOptions = computeTierOptions(licenceBenefits.billableAnalyticsGbPerDay, STATIC_PRICING_BUNDLE, 0.79)
    const recommendedOption = commitmentOptions.find(o => o.isRecommended && !o.isPayg)
    expect(recommendedOption).toBeDefined() // sanity: a commitment tier IS recommended at this volume

    const analyticsCommitmentMonthly = recommendedOption!.monthlyCostUsd
    const totalSavings = licenceBenefits.totalSavedMonthlyUsd
    expect(totalSavings).toBeGreaterThan(0) // sanity: there IS a non-zero dollar saving to (potentially) double-count

    // Step 4: production formula, copied verbatim from IngestionEstimator.tsx
    const optimisedMonthlyProduction = Math.max(
      0,
      analyticsCommitmentMonthly
        + summary.dataLakeDailyCostUsd * DAYS_PER_MONTH
        + summary.retentionMonthlyCostUsd
        - totalSavings, // <-- BUG: grant already baked into analyticsCommitmentMonthly via netting
    )

    // Financially correct: the grant was already applied once via the netted
    // volume the tier was sized against, so it must not be subtracted again.
    const optimisedMonthlyCorrect = Math.max(
      0,
      analyticsCommitmentMonthly
        + summary.dataLakeDailyCostUsd * DAYS_PER_MONTH
        + summary.retentionMonthlyCostUsd,
    )

    // The discrepancy is exactly the dollar value of the grant that got
    // subtracted twice.
    expect(optimisedMonthlyCorrect - optimisedMonthlyProduction).toBeCloseTo(totalSavings, 2)

    // FAILS today: production quotes a materially cheaper "optimised" monthly
    // cost than is actually achievable — a real presales risk.
    expect(optimisedMonthlyProduction).toBeCloseTo(optimisedMonthlyCorrect, 2)
  })
})
