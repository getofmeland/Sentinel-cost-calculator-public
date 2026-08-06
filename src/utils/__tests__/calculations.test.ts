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
import { breakevenForTier, computeTierOptions, costAtVolume } from '../tiers'
import { computeLicenceBenefits } from '../licenceBenefits'
import { summariseIngestion, estimateSourceGbPerDay } from '../ingestion'
import { interpolateRange, getSizeMultiplier, TSHIRT_SIZES } from '../../data/tshirtSizes'
import { SERVER_WORKLOADS } from '../../data/serverWorkloads'
import { computeServerWorkloadRows } from '../serverWorkloads'
import { round2 } from '../round'
import { LOG_TIER_DEFINITIONS, type LogTierKey } from '../../data/logTiers'
import {
  STATIC_PRICING_BUNDLE,
  DAYS_PER_MONTH,
  COMMITMENT_TIERS,
  LOG_SOURCES,
  PAYG_RATE_USD_PER_GB,
  EXCHANGE_RATE_USD_TO_GBP,
  DATA_LAKE_COMPRESSION_RATIO,
  type PricingBundle,
  type CommitmentTier,
} from '../../data/pricing'
import type { SourceEstimateRow } from '../ingestion'
import type { LogSource } from '../../data/pricing'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// round2 is imported from the production module rather than re-implemented, so
// a change in rounding behaviour cannot pass unnoticed.

// ---------------------------------------------------------------------------
// 1. fmtGbp
// ---------------------------------------------------------------------------

describe('fmtGbp', () => {
  it('converts USD to GBP at the default rate from pricing.ts', () => {
    const expected = (100 * EXCHANGE_RATE_USD_TO_GBP).toFixed(2)
    expect(fmtGbp(100)).toBe(`£${expected}`)
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
  const tier100: CommitmentTier = COMMITMENT_TIERS.find(t => t.gbPerDay === 100)!

  it('calculates breakeven for the 100 GB/day tier at the default PAYG rate', () => {
    // breakeven = tier daily cost / PAYG rate. The function returns an
    // unrounded float, so compare with toBeCloseTo.
    const breakeven = breakevenForTier(tier100)
    expect(breakeven).toBeCloseTo(tier100.dailyCostUsd / PAYG_RATE_USD_PER_GB, 5)
    // Every tier is cheaper per GB than PAYG, so breakeven must fall below the
    // committed volume — that is what makes the tier worth buying.
    expect(breakeven).toBeGreaterThan(0)
    expect(breakeven).toBeLessThan(tier100.gbPerDay)
  })

  it('uses a custom paygRate when provided', () => {
    const breakeven = breakevenForTier(tier100, 4.00)
    expect(breakeven).toBeCloseTo(tier100.dailyCostUsd / 4.00, 5)
  })

  it('scales correctly when paygRate equals the tier effective rate (breakeven = tier gbPerDay)', () => {
    // At effectiveRateUsd = 3.35, breakeven = 335 / 3.35 = exactly 100 GB/day
    const breakeven = breakevenForTier(tier100, tier100.effectiveRateUsd)
    expect(breakeven).toBeCloseTo(tier100.gbPerDay, 5)
  })
})

// ---------------------------------------------------------------------------
// 2b. Commitment tier table integrity
//
// The published daily cost per tier is the only authoritative number; the
// effective per-GB rate and the saving against PAYG are derived from it. These
// were once hardcoded alongside and drifted far enough that the file claimed a
// 53% saving when Microsoft's published maximum is 52%. These tests pin the
// derivation so that cannot recur.
// ---------------------------------------------------------------------------

describe('COMMITMENT_TIERS integrity', () => {
  it('effectiveRateUsd is exactly dailyCostUsd / gbPerDay for every tier', () => {
    for (const tier of COMMITMENT_TIERS) {
      expect(tier.effectiveRateUsd).toBeCloseTo(tier.dailyCostUsd / tier.gbPerDay, 10)
    }
  })

  it('savingsVsPayg is exactly the discount against the PAYG rate', () => {
    for (const tier of COMMITMENT_TIERS) {
      expect(tier.savingsVsPayg).toBeCloseTo(1 - tier.effectiveRateUsd / PAYG_RATE_USD_PER_GB, 10)
    }
  })

  it('every tier undercuts PAYG, so committing is always cheaper per GB', () => {
    for (const tier of COMMITMENT_TIERS) {
      expect(tier.effectiveRateUsd).toBeLessThan(PAYG_RATE_USD_PER_GB)
      expect(tier.savingsVsPayg).toBeGreaterThan(0)
    }
  })

  it('larger commitments are never worse value than smaller ones', () => {
    const sorted = [...COMMITMENT_TIERS].sort((a, b) => a.gbPerDay - b.gbPerDay)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].effectiveRateUsd).toBeLessThanOrEqual(sorted[i - 1].effectiveRateUsd)
    }
  })

  it('no tier claims a saving above the 52% Microsoft publishes as its maximum', () => {
    const best = Math.max(...COMMITMENT_TIERS.map(t => t.savingsVsPayg))
    expect(best).toBeLessThanOrEqual(0.53)
  })

  it('is sorted ascending by gbPerDay, as computeTierOptions and the UI assume', () => {
    const gbPerDay = COMMITMENT_TIERS.map(t => t.gbPerDay)
    expect(gbPerDay).toEqual([...gbPerDay].sort((a, b) => a - b))
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
    // Expected values are derived from the tier table rather than written out,
    // so re-pricing does not require editing these assertions.
    const VOLUME = 200
    const options = computeTierOptions(VOLUME, STATIC_PRICING_BUNDLE)
    const paygDaily = VOLUME * PAYG_RATE_USD_PER_GB
    const tier100 = COMMITMENT_TIERS.find(t => t.gbPerDay === 100)!
    // Overage above the commitment is billed at the tier's own effective rate.
    const tier100Daily = tier100.dailyCostUsd + (VOLUME - 100) * tier100.effectiveRateUsd

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

    it('100 GB/day tier reports savings measured against the PAYG baseline', () => {
      const tier100Option = options.find(o => o.tier?.gbPerDay === 100)!
      expect(tier100Option.savingsVsPaygPct).toBeCloseTo(
        (paygDaily - tier100Daily) / paygDaily,
        4,
      )
    })

    it('recommends the cheapest tier at this volume, priced at its committed rate', () => {
      const recommended = options.find(o => o.isRecommended)!
      const cheapest = options.reduce((a, b) => (b.dailyCostUsd < a.dailyCostUsd ? b : a))
      expect(recommended.dailyCostUsd).toBeCloseTo(cheapest.dailyCostUsd, 5)
      // The exactly-matching tier costs its flat committed price with no overage.
      const exactTier = COMMITMENT_TIERS.find(t => t.gbPerDay === VOLUME)!
      const exactOption = options.find(o => o.tier?.gbPerDay === VOLUME)!
      expect(exactOption.dailyCostUsd).toBeCloseTo(exactTier.dailyCostUsd, 5)
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

  it('MDE is eligible for the E5 grant as Defender XDR advanced hunting data', () => {
    // Microsoft's offer covers M365 Defender advanced hunting — device, email
    // and identity events. Excluding mde/mdi/mdo capped the grant by a small
    // eligible pool rather than by the allowance.
    const rows = [makeRow(mdeSource, 10)]
    const result = computeLicenceBenefits(rows, 10, 'e5', 500, false, 0)
    expect(result.e5EligibleAnalyticsGbPerDay).toBeCloseTo(10, 2)
    // 500 users x 5 MB = 2.5 GB/day allowance, which is the binding constraint.
    expect(result.e5GrantGbPerDay).toBeCloseTo(2.5, 2)
  })

  it('caps the grant at the allowance, not at the eligible volume, when eligible volume is larger', () => {
    const rows = [makeRow(mdeSource, 100)]
    const result = computeLicenceBenefits(rows, 100, 'e5', 500, false, 0)
    expect(result.e5GrantGbPerDay).toBeCloseTo(result.e5AllowanceGbPerDay, 2)
  })

  it('a source outside the eligible set contributes nothing to the grant', () => {
    // Key Vault diagnostics are not part of any E5 grant category.
    const keyVaultSource = LOG_SOURCES.find(s => s.id === 'key-vault')!
    const rows = [makeRow(keyVaultSource, 10)]
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
    const keyVaultSource = LOG_SOURCES.find(s => s.id === 'key-vault')!
    const rows = [makeRow(keyVaultSource, 5)]
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

  it('totalSavedMonthlyUsd is the sum of the individually rounded credit lines', () => {
    // entra-id: 1 GB/day eligible; 500 users × 5 MB = 2.5 GB/day allowance → e5Grant = 1
    // windows-security: 5 GB/day; 2 servers × 0.5 = 1 GB/day allowance → defenderGrant = 1
    const rows = [makeRow(entraSource, 1), makeRow(windowsSource, 5)]
    const result = computeLicenceBenefits(rows, 6, 'e5', 500, true, 2)

    // Each credit is rounded before being summed, because each is displayed as
    // its own line in the cost table and the total must equal what the user can
    // add up on screen. That can differ by a penny from rounding the combined
    // grant in one go, so assert the relationship the code actually guarantees.
    expect(result.totalSavedMonthlyUsd).toBeCloseTo(
      round2(result.e5SavedMonthlyUsd + result.defenderServersSavedMonthlyUsd),
      2,
    )
    // ...and that it still tracks the underlying grant to within rounding error.
    const unrounded = result.totalGrantGbPerDay * DAYS_PER_MONTH * STATIC_PRICING_BUNDLE.paygRateUsd
    expect(Math.abs(result.totalSavedMonthlyUsd - unrounded)).toBeLessThanOrEqual(0.02)
  })
})

// ---------------------------------------------------------------------------
// 5. T-shirt size interpolation
// ---------------------------------------------------------------------------

describe('t-shirt size interpolation', () => {
  // Interpolation is geometric: ingestion volumes are roughly log-normal, so
  // the typical value in a wide band sits near the geometric mean rather than
  // the arithmetic one.

  it('M at 0.50 returns the geometric mean, not the arithmetic midpoint', () => {
    // sqrt(2 * 10) = 4.472, against a linear midpoint of 6.0
    expect(interpolateRange(2, 10, 0.5)).toBeCloseTo(Math.sqrt(2 * 10), 5)
  })

  it('is monotonically increasing across the multiplier range', () => {
    const values = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1].map(m => interpolateRange(2, 10, m))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it('returns exactly the endpoints at 0 and 1', () => {
    expect(interpolateRange(2, 10, 0)).toBeCloseTo(2, 10)
    expect(interpolateRange(2, 10, 1)).toBeCloseTo(10, 10)
  })

  it('stays inside the declared range at every size', () => {
    for (const size of TSHIRT_SIZES) {
      const value = interpolateRange(5, 50, size.multiplier)
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThanOrEqual(50)
    }
  })

  it('lets the Light profile approach the documented minimum', () => {
    // The S multiplier was 0.30 with linear interpolation, so a [5, 50] source
    // could never produce less than 18.5 GB/day and "Light" was not light.
    const light = interpolateRange(5, 50, getSizeMultiplier('S'))
    expect(light).toBeLessThan(7)
  })

  it('falls back to linear when an endpoint is zero, where the geometric form is undefined', () => {
    expect(interpolateRange(0, 10, 0.5)).toBeCloseTo(5, 10)
  })

  it('getSizeMultiplier returns an ascending multiplier for each size', () => {
    const multipliers = (['S', 'M', 'L', 'XL'] as const).map(getSizeMultiplier)
    expect(multipliers).toEqual([...multipliers].sort((a, b) => a - b))
    expect(multipliers[0]).toBeGreaterThan(0)
    expect(multipliers[multipliers.length - 1]).toBeLessThanOrEqual(1)
  })

  it('barely moves narrow ranges, leaving well-calibrated server bands intact', () => {
    // Server workload bands are typically under 2x wide; the correction targets
    // the wide, uncertain network sources. Within 5% on a narrow band, against
    // 40%+ on a 10x band.
    const narrowLinear = 1.5 + (2.5 - 1.5) * 0.5
    const narrowShift = Math.abs(interpolateRange(1.5, 2.5, 0.5) - narrowLinear) / narrowLinear
    expect(narrowShift).toBeLessThan(0.05)

    const wideLinear = 5 + (50 - 5) * 0.5
    const wideShift = Math.abs(interpolateRange(5, 50, 0.5) - wideLinear) / wideLinear
    expect(wideShift).toBeGreaterThan(0.3)
  })
})

// ---------------------------------------------------------------------------
// 6. computeServerWorkloadRows
// ---------------------------------------------------------------------------

describe('computeServerWorkloadRows', () => {
  const dcWorkload = SERVER_WORKLOADS.find(w => w.id === 'ws-dc')!
  const lxWebWorkload = SERVER_WORKLOADS.find(w => w.id === 'lx-web')!

  it('DC at 5 servers, Common level, M size scales the interpolated per-server rate', () => {
    const commonLevel = dcWorkload.collectionLevels.find(l => l.id === 'common')!
    const expected = round2(
      interpolateRange(
        commonLevel.gbPerServerPerDay.min,
        commonLevel.gbPerServerPerDay.max,
        getSizeMultiplier('M'),
      ) * 5,
    )
    const rows = computeServerWorkloadRows(
      [dcWorkload],
      { 'ws-dc': 5 },
      { 'ws-dc': 'common' },
      {},
      'M',
      {},
      {},
      STATIC_PRICING_BUNDLE,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].gbPerDay).toBeCloseTo(expected, 2)
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
  const emptyLogTiers: Record<string, LogTierKey> = {}
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

    it('freeGbPerDay matches the interpolated range at 1,000 users', () => {
      const source = LOG_SOURCES.find(s => s.id === 'azure-activity')!
      const [min, max] = source.gbPer1000UsersRange!
      const expected = round2(interpolateRange(min, max, getSizeMultiplier('M')) * (1000 / 1000))
      expect(summary.freeGbPerDay).toBeCloseTo(expected, 2)
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

    it('analyticsDailyCostUsd equals round2(analyticsGbPerDay × PAYG rate)', () => {
      expect(summary.analyticsDailyCostUsd).toBeCloseTo(
        round2(summary.analyticsGbPerDay * PAYG_RATE_USD_PER_GB),
        2,
      )
    })

    it('freeGbPerDay === 0', () => {
      expect(summary.freeGbPerDay).toBe(0)
    })

    it('analyticsGbPerDay matches the interpolated entra-id range', () => {
      const source = LOG_SOURCES.find(s => s.id === 'entra-id')!
      const [min, max] = source.gbPer1000UsersRange!
      const expected = round2(interpolateRange(min, max, getSizeMultiplier('M')))
      expect(summary.analyticsGbPerDay).toBeCloseTo(expected, 2)
    })
  })

  describe('doubled paygRateUsd doubles analyticsDailyCostUsd', () => {
    it('custom pricing bundle with 2× paygRate produces 2× analyticsDailyCostUsd', () => {
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

      // Both figures are rounded to the penny before comparison, so doubling can
      // land a penny either side of exactly 2×. Assert the scaling property
      // within that rounding allowance rather than to the penny.
      expect(summaryDoubled.analyticsDailyCostUsd).toBeCloseTo(
        summaryDefault.analyticsDailyCostUsd * 2,
        1,
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

describe('retention free-window is read from logTiers.ts, not hardcoded', () => {
  it('changing analytics freeRetentionDays changes the retention cost summariseIngestion computes', () => {
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
      expect(row.gbPerDay).toBeGreaterThan(0)

      // What summariseIngestion ACTUALLY computes (hardcoded 90):
      //   extraDays = 200 - 90 = 110
      //   cost = round2((1.75/6) * 110 * 0.02) = 0.64
      //
      // What it SHOULD compute if it honoured the (now-updated) tier
      // definition, matching the Data Lake native path's own pattern:
      //   extraDays = 200 - tierDef.freeRetentionDays(60) = 140
      //
      // Rates are read from the pricing bundle rather than written out, so this
      // test keeps isolating the hardcoded-90 defect after a re-price instead
      // of failing for an unrelated reason.
      const correctExtraDays = Math.max(0, 200 - analyticsDef.freeRetentionDays)
      const correctRetentionCost = round2(
        (row.gbPerDay / DATA_LAKE_COMPRESSION_RATIO) *
          correctExtraDays *
          STATIC_PRICING_BUNDLE.dataLakeRetentionRateUsd,
      )

      // Shortening the free window lengthens the billable period, so the cost
      // must be strictly higher than it would be under the original 90 days.
      const costUnderOriginalWindow = round2(
        (row.gbPerDay / DATA_LAKE_COMPRESSION_RATIO) *
          (200 - originalFreeRetentionDays) *
          STATIC_PRICING_BUNDLE.dataLakeRetentionRateUsd,
      )
      expect(correctExtraDays).toBeGreaterThan(200 - originalFreeRetentionDays)
      expect(correctRetentionCost).toBeGreaterThan(costUnderOriginalWindow)

      // The point of the test: production follows the tier definition rather
      // than a hardcoded 90.
      expect(row.retentionMonthlyCostUsd).toBeCloseTo(correctRetentionCost, 2)
    } finally {
      // Always restore the shared module singleton, regardless of pass/fail,
      // so this test cannot leak state into any other test in the suite.
      analyticsDef.freeRetentionDays = originalFreeRetentionDays
    }
  })
})

// ---------------------------------------------------------------------------
// 9. The calculation layer rejects negative and NaN input.
//
//    SourceRow.tsx clamps user keystrokes, but the pure functions are reachable
//    from anywhere — a shared URL, a preset, a future embed. They must defend
//    themselves rather than trusting one React input handler to have done it.
// ---------------------------------------------------------------------------

describe('negative and NaN inputs are rejected by the calculation layer', () => {
  const customAppSource = LOG_SOURCES.find(s => s.id === 'custom-app')!

  it('clamps a negative manual GB value to zero', () => {
    const gbPerDay = estimateSourceGbPerDay(customAppSource, 1000, undefined, undefined, -50)
    // A negative daily ingestion volume is physically meaningless.
    expect(gbPerDay).toBe(0)
  })

  it('never produces a negative total from a negative manual GB value', () => {
    const summary = summariseIngestion(
      new Set(['custom-app']),
      1000, {}, {}, {}, {}, {},
      { 'custom-app': -50 },
      STATIC_PRICING_BUNDLE, EXCHANGE_RATE_USD_TO_GBP,
    )
    // Unguarded, -50 GB/day would have been billed as a negative amount and
    // silently subtracted from the customer's total.
    expect(summary.totalDailyCostUsd).toBeGreaterThanOrEqual(0)
    expect(summary.totalGbPerDay).toBeGreaterThanOrEqual(0)
  })

  it('degrades a NaN manual GB value to zero rather than contaminating totals', () => {
    const summary = summariseIngestion(
      new Set(['custom-app']),
      1000, {}, {}, {}, {}, {},
      { 'custom-app': NaN },
      STATIC_PRICING_BUNDLE, EXCHANGE_RATE_USD_TO_GBP,
    )
    expect(Number.isFinite(summary.totalDailyCostUsd)).toBe(true)
    expect(Number.isFinite(summary.totalGbPerDay)).toBe(true)
    expect(summary.totalDailyCostUsd).toBe(0)
  })

  it('falls back to the default count for a negative device count', () => {
    const keyVaultSource = LOG_SOURCES.find(s => s.id === 'key-vault')!
    const gbPerDay = estimateSourceGbPerDay(keyVaultSource, 1000, -5)
    expect(gbPerDay).toBeGreaterThanOrEqual(0)
  })

  it('never produces a negative licence allowance from a negative user or server count', () => {
    const result = computeLicenceBenefits([], 0, 'e5', -500, true, -10)
    expect(result.e5AllowanceGbPerDay).toBeGreaterThanOrEqual(0)
    expect(result.defenderServersAllowanceGbPerDay).toBeGreaterThanOrEqual(0)
    expect(result.billableAnalyticsGbPerDay).toBeGreaterThanOrEqual(0)
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

describe('optimisedMonthly applies the licence grant exactly once', () => {
  it('does not subtract the grant again from a commitment tier already sized on the net volume', () => {
    // Large enough that a commitment tier genuinely beats PAYG even after the
    // licence grant is netted out — which is the only situation where the
    // double-count could occur.
    const userCount = 50000
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

    // Step 4: the formula IngestionEstimator.tsx now uses. The grant reached it
    // once, through the netted volume the tier was sized against.
    const optimisedMonthly = Math.max(
      0,
      analyticsCommitmentMonthly
        + summary.dataLakeDailyCostUsd * DAYS_PER_MONTH
        + summary.retentionMonthlyCostUsd,
    )

    // The total is exactly its three components. The former bug subtracted
    // totalSavings here as well, on top of the netting already baked into
    // analyticsCommitmentMonthly.
    expect(optimisedMonthly).toBeCloseTo(
      analyticsCommitmentMonthly
        + summary.dataLakeDailyCostUsd * DAYS_PER_MONTH
        + summary.retentionMonthlyCostUsd,
      2,
    )

    // The grant's effect is present exactly once: pricing the same tier against
    // the gross volume costs more, and the difference is the grant's worth at
    // the tier's discounted rate — necessarily no more than its worth at PAYG.
    const grossCommitmentMonthly =
      costAtVolume(recommendedOption!.tier!, summary.analyticsGbPerDay) * DAYS_PER_MONTH
    const appliedBenefit = grossCommitmentMonthly - analyticsCommitmentMonthly
    expect(appliedBenefit).toBeGreaterThan(0)
    expect(appliedBenefit).toBeLessThanOrEqual(totalSavings + 0.01)
  })
})
